import type {
  AnalysisFailureCode,
  AnalysisRequest,
  AnalysisResult,
} from '../blocks/analysis-types';
import type { ExecutionCatalog } from './execution-client';
import { claimEngineSlot, ModuleStore, sharedModuleStore, type ModuleDependencies } from './module';
import { decodeAnalysisResult, encodeAnalysisRequest } from './analysis-protocol';

export interface AnalysisOptions {
  started?: number;
  remainingMs?: number;
  signal?: AbortSignal;
}
export interface AnalysisDependencies extends ModuleDependencies {
  now?: () => number;
  createWorker?: () => Worker;
  decode?: typeof decodeAnalysisResult;
}
interface Operation {
  id: string;
  started: number;
  duration: number;
  controller: AbortController;
  worker?: Worker;
  timer?: ReturnType<typeof setTimeout>;
  releaseSlot?: () => void;
  removeAbort?: () => void;
  responded: boolean;
  reject: (error: Error) => void;
}
function failureCode(error: unknown): AnalysisFailureCode {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'E_CANCELLED') return 'cancelled';
  if (code === 'E_PROTOCOL_VERSION') return 'version';
  if (
    /^E_(?:DEADLINE|FUEL_LIMIT|SOURCE_LIMIT|REQUEST_LIMIT|RESULT_LIMIT|DEPTH_LIMIT|MEMORY_LIMIT)$/.test(
      code,
    )
  )
    return 'budget';
  if (code === 'E_MODULE_LOAD') return 'module';
  if (/^E_(?:WORKER_FAILURE|WASM_TRAP)$/.test(code)) return 'transport';
  return 'response';
}
export class AnalysisClient {
  private active?: Operation;
  private readonly store: ModuleStore;
  private readonly now: () => number;
  private readonly createWorker: () => Worker;
  constructor(private readonly dependencies: AnalysisDependencies = {}) {
    this.store = Object.keys(dependencies).length
      ? new ModuleStore(dependencies)
      : sharedModuleStore;
    this.now = dependencies.now ?? (() => performance.now());
    this.createWorker =
      dependencies.createWorker ??
      (() => new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }));
  }
  inspect() {
    return {
      activeWorkers: this.active?.worker ? 1 : 0,
      cachedModules: this.store.module ? 1 : 0,
      active: Boolean(this.active),
    };
  }
  cancel() {
    if (this.active) this.fail(this.active, 'E_CANCELLED');
  }
  invalidate() {
    this.cancel();
  }
  private release(operation: Operation) {
    if (this.active === operation) this.active = undefined;
    clearTimeout(operation.timer);
    operation.removeAbort?.();
    operation.controller.abort();
    operation.releaseSlot?.();
    if (operation.worker) {
      operation.worker.onmessage = null;
      operation.worker.onerror = null;
      operation.worker.onmessageerror = null;
      operation.worker.terminate();
    }
  }
  private fail(operation: Operation, code: string) {
    if (this.active !== operation) return;
    this.release(operation);
    operation.reject(new Error(code));
  }
  private guard(operation: Operation) {
    if (this.active !== operation) throw new Error('E_CANCELLED');
    if (this.now() - operation.started >= operation.duration) {
      this.fail(operation, 'E_DEADLINE');
      throw new Error('E_DEADLINE');
    }
  }
  async analyze(
    catalog: ExecutionCatalog,
    request: AnalysisRequest,
    options: AnalysisOptions = {},
  ): Promise<AnalysisResult> {
    this.cancel();
    const snapshot = structuredClone(request);
    const selected = structuredClone(catalog);
    const started = options.started ?? this.now();
    const duration = Math.min(1000, options.remainingMs ?? 1000);
    try {
      const buffer = encodeAnalysisRequest(snapshot, selected).buffer;
      if (
        !Number.isFinite(started) ||
        started > this.now() ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        options.signal?.aborted
      )
        throw new Error(options.signal?.aborted ? 'E_CANCELLED' : 'E_DEADLINE');
      return await new Promise<AnalysisResult>((resolve, reject) => {
        const operation: Operation = {
          id: crypto.randomUUID(),
          started,
          duration,
          controller: new AbortController(),
          responded: false,
          reject,
        };
        this.active = operation;
        operation.releaseSlot = claimEngineSlot(() => this.fail(operation, 'E_CANCELLED'));
        operation.timer = setTimeout(
          () => this.fail(operation, 'E_DEADLINE'),
          Math.max(0, duration - (this.now() - started)),
        );
        const abort = () => this.fail(operation, 'E_CANCELLED');
        options.signal?.addEventListener('abort', abort, { once: true });
        operation.removeAbort = () => options.signal?.removeEventListener('abort', abort);
        const guard = () => this.guard(operation);
        void (async () => {
          try {
            guard();
            const module = await this.store.load(operation.controller.signal, guard);
            guard();
            const worker = this.createWorker();
            operation.worker = worker;
            worker.onerror = (event) => {
              event.preventDefault();
              this.fail(operation, 'E_WORKER_FAILURE');
            };
            worker.onmessageerror = () => this.fail(operation, 'E_PROTOCOL_INVALID');
            worker.onmessage = (event: MessageEvent<unknown>) => {
              if (this.active !== operation || operation.worker !== worker || operation.responded)
                return;
              operation.responded = true;
              void (async () => {
                try {
                  guard();
                  const data = event.data;
                  if (!data || typeof data !== 'object' || Array.isArray(data))
                    throw new Error('E_PROTOCOL_INVALID');
                  const packet = data as Record<string, unknown>;
                  if (
                    packet.operationId !== operation.id ||
                    Object.keys(packet).sort().join(',') !==
                      (packet.ok === true ? 'buffer,ok,operationId' : 'code,ok,operationId')
                  )
                    throw new Error('E_PROTOCOL_INVALID');
                  if (packet.ok === false) {
                    const allowed = [
                      'E_MODULE_LOAD',
                      'E_WORKER_FAILURE',
                      'E_WASM_TRAP',
                      'E_ENCODING_FAILURE',
                      'E_PROTOCOL_INVALID',
                      'E_PROTOCOL_VERSION',
                      'E_CONTENT_MISMATCH',
                      'E_DEADLINE',
                      'E_CANCELLED',
                      'E_REQUEST_LIMIT',
                      'E_SOURCE_LIMIT',
                      'E_FUEL_LIMIT',
                      'E_RESULT_LIMIT',
                      'E_DEPTH_LIMIT',
                      'E_MEMORY_LIMIT',
                    ];
                    throw new Error(
                      typeof packet.code === 'string' && allowed.includes(packet.code)
                        ? packet.code
                        : 'E_PROTOCOL_INVALID',
                    );
                  }
                  if (packet.ok !== true || !(packet.buffer instanceof ArrayBuffer))
                    throw new Error('E_PROTOCOL_INVALID');
                  const result = await (this.dependencies.decode ?? decodeAnalysisResult)(
                    packet.buffer,
                    snapshot,
                    selected,
                    guard,
                  );
                  guard();
                  this.release(operation);
                  resolve(result);
                } catch (error) {
                  this.fail(
                    operation,
                    error instanceof Error ? error.message : 'E_PROTOCOL_INVALID',
                  );
                }
              })();
            };
            guard();
            const remainingMs = Math.floor(duration - (this.now() - started));
            if (remainingMs < 1) throw new Error('E_DEADLINE');
            worker.postMessage(
              {
                kind: 'analyze-code',
                operationId: operation.id,
                module,
                exerciseId: selected.subject.id,
                buffer,
                remainingMs,
              },
              [buffer],
            );
          } catch (error) {
            this.fail(
              operation,
              error instanceof Error && /^E_[A-Z_]+$/.test(error.message)
                ? error.message
                : 'E_MODULE_LOAD',
            );
          }
        })();
      });
    } catch (error) {
      return {
        kind: 'analysisFailure',
        analysisVersion: '1.0.0',
        identity: snapshot.identity,
        refs: snapshot.refs,
        error: { code: failureCode(error) },
      };
    }
  }
}
export const analysisClient = new AnalysisClient();
