import { engineBuild } from '../generated/algorithm/engine-build';
import { algorithmModuleStore, createAlgorithmModuleStore } from './algorithm-module';
import { claimEngineSlot, type ModuleDependencies, type ModuleStore } from './module';
import {
  algorithmAssert,
  decodeAlgorithmResult,
  encodeAlgorithmRequest,
  type AlgorithmRequest,
  type AlgorithmResult,
} from './algorithm-protocol';

export interface AlgorithmDependencies extends ModuleDependencies {
  now?: () => number;
  createWorker?: () => Worker;
  decode?: typeof decodeAlgorithmResult;
}
interface Operation {
  id: string;
  start: number;
  controller: AbortController;
  worker?: Worker;
  timer?: ReturnType<typeof setTimeout>;
  releaseSlot?: () => void;
  responded: boolean;
  reject: (reason: Error) => void;
}
export function algorithmRequest(
  source: string,
  language: AlgorithmRequest['language'],
  input: number[] = [],
  sourceRevision = crypto.randomUUID(),
): AlgorithmRequest {
  return {
    execVersion: '1.2.0',
    dslVersion: '1.1.0',
    diagnosticVersion: '1.1.0',
    integerEncoding: '1.0.0',
    language,
    engineId: 'engine.rust.p1',
    runId: crypto.randomUUID(),
    sourceRevision,
    source,
    input: [...input],
  };
}

/** Internal algorithm execution adapter; it never persists data or grants rewards.
 * Call invalidate synchronously for source/input/language changes or unmount. */
export class AlgorithmExecutionClient {
  private active?: Operation;
  private state = 'idle';
  private readonly store: ModuleStore;
  private readonly now: () => number;
  private readonly createWorker: () => Worker;
  constructor(private readonly dependencies: AlgorithmDependencies = {}) {
    this.store = Object.keys(dependencies).length
      ? createAlgorithmModuleStore(dependencies)
      : algorithmModuleStore;
    this.now = dependencies.now ?? (() => performance.now());
    this.createWorker =
      dependencies.createWorker ??
      (() => new Worker(new URL('./algorithm-worker.ts', import.meta.url), { type: 'module' }));
  }
  inspect() {
    return {
      state: this.state,
      activeWorkers: this.active?.worker ? 1 : 0,
      cachedModules: this.store.module ? 1 : 0,
    };
  }
  private release(operation: Operation) {
    if (this.active !== operation) return;
    this.active = undefined;
    operation.releaseSlot?.();
    clearTimeout(operation.timer);
    operation.controller.abort();
    if (operation.worker) {
      operation.worker.onmessage = null;
      operation.worker.onerror = null;
      operation.worker.onmessageerror = null;
      operation.worker.terminate();
    }
  }
  private fail(operation: Operation, code: string) {
    if (this.active !== operation) return;
    this.state =
      code === 'E_CANCELLED' ? 'cancelled' : code === 'E_DEADLINE' ? 'expired' : 'failed';
    this.release(operation);
    operation.reject(new Error(code));
  }
  cancel() {
    if (this.active) this.fail(this.active, 'E_CANCELLED');
  }
  invalidate() {
    this.cancel();
    this.state = 'invalidated';
  }
  private guard(operation: Operation) {
    if (this.active !== operation) throw new Error('E_CANCELLED');
    if (this.now() - operation.start >= 1000) {
      this.fail(operation, 'E_DEADLINE');
      throw new Error('E_DEADLINE');
    }
  }
  checkDeadline() {
    if (this.active) {
      try {
        this.guard(this.active);
      } catch {
        /* The operation is already rejected. */
      }
    }
  }
  execute(request: AlgorithmRequest): Promise<AlgorithmResult> {
    this.cancel();
    const snapshot = structuredClone(request);
    const start = this.now();
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = encodeAlgorithmRequest(snapshot);
    } catch (error) {
      this.state = 'failed';
      return Promise.reject(error);
    }
    this.state = 'loading';
    return new Promise<AlgorithmResult>((resolve, reject) => {
      const operation: Operation = {
        id: crypto.randomUUID(),
        start,
        controller: new AbortController(),
        responded: false,
        reject,
      };
      this.active = operation;
      operation.releaseSlot = claimEngineSlot(() => this.fail(operation, 'E_CANCELLED'));
      operation.timer = setTimeout(() => this.fail(operation, 'E_DEADLINE'), 1000);
      const guard = () => this.guard(operation);
      void (async () => {
        try {
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
                const data = event.data as Record<string, unknown>;
                algorithmAssert(data && data.operationId === operation.id);
                if (data.ok === false) {
                  algorithmAssert(
                    Object.keys(data).length === 3 &&
                      ['ok', 'operationId', 'code'].every((key) => key in data),
                  );
                  const allowed = [
                    'E_PROTOCOL_INVALID',
                    'E_UNSUPPORTED_VERSION',
                    'E_REQUEST_LIMIT',
                    'E_SOURCE_LIMIT',
                    'E_DEADLINE',
                    'E_CANCELLED',
                    'E_ENCODING_FAILURE',
                    'E_FUEL_LIMIT',
                    'E_RESULT_LIMIT',
                    'E_INPUT_INVALID',
                    'E_WORKER_FAILURE',
                    'E_WASM_TRAP',
                  ];
                  throw new Error(
                    typeof data.code === 'string' && allowed.includes(data.code)
                      ? data.code
                      : 'E_WORKER_FAILURE',
                  );
                }
                algorithmAssert(
                  data.ok === true &&
                    Object.keys(data).length === 4 &&
                    ['ok', 'operationId', 'buffer', 'wasmPages'].every((key) => key in data) &&
                    data.buffer instanceof ArrayBuffer &&
                    data.buffer.byteLength <= 16777216 &&
                    typeof data.wasmPages === 'number' &&
                    Number.isInteger(data.wasmPages) &&
                    data.wasmPages <= 2048,
                );
                this.state = 'validating';
                const value = await (this.dependencies.decode ?? decodeAlgorithmResult)(
                  data.buffer,
                  snapshot,
                  engineBuild.wasmSha256,
                  guard,
                );
                guard();
                this.state = 'accepted';
                this.release(operation);
                resolve(value);
              } catch (error) {
                this.fail(
                  operation,
                  error instanceof Error && /^E_[A-Z_]+$/.test(error.message)
                    ? error.message
                    : 'E_PROTOCOL_INVALID',
                );
              }
            })();
          };
          guard();
          this.state = 'running';
          worker.postMessage(
            {
              operationId: operation.id,
              module,
              buffer: bytes.buffer,
              buildId: engineBuild.wasmSha256,
              remainingMs: Math.floor(1000 - (this.now() - start)),
            },
            [bytes.buffer],
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
  }
}
