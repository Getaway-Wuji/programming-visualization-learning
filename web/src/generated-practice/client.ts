import { engineBuild } from '../generated/practice/engine-build';
import { claimEngineSlot, type ModuleDependencies, type ModuleStore } from '../engine/module';
import { practiceModuleStore, createPracticeModuleStore } from './module';
import {
  encodePracticeRequest,
  decodePracticeResponse,
  practiceAssert,
  type PracticeRequest,
  type PracticeResponse,
  type GeneratedProblem,
} from './protocol';
export interface PracticeDependencies extends ModuleDependencies {
  now?: () => number;
  createWorker?: () => Worker;
  decode?: typeof decodePracticeResponse;
}
interface Operation {
  id: string;
  start: number;
  controller: AbortController;
  worker?: Worker;
  timer?: ReturnType<typeof setTimeout>;
  releaseSlot?: () => void;
  responded: boolean;
  reject: (e: Error) => void;
}
export class PracticeClient {
  private active?: Operation;
  private state = 'idle';
  private readonly store: ModuleStore;
  private readonly now: () => number;
  private readonly createWorker: () => Worker;
  constructor(private readonly dependencies: PracticeDependencies = {}) {
    this.store = Object.keys(dependencies).length
      ? createPracticeModuleStore(dependencies)
      : practiceModuleStore;
    this.now = dependencies.now ?? (() => performance.now());
    this.createWorker =
      dependencies.createWorker ??
      (() => new Worker(new URL('./practice-worker.ts', import.meta.url), { type: 'module' }));
  }
  inspect() {
    return {
      state: this.state,
      activeWorkers: this.active?.worker ? 1 : 0,
      cachedModules: this.store.module ? 1 : 0,
    };
  }
  private release(op: Operation) {
    if (this.active !== op) return;
    this.active = undefined;
    op.releaseSlot?.();
    clearTimeout(op.timer);
    op.controller.abort();
    if (op.worker) {
      op.worker.onmessage = null;
      op.worker.onerror = null;
      op.worker.onmessageerror = null;
      op.worker.terminate();
    }
  }
  private fail(op: Operation, code: string) {
    if (this.active !== op) return;
    this.state =
      code === 'E_CANCELLED' ? 'cancelled' : code === 'E_DEADLINE' ? 'expired' : 'failed';
    this.release(op);
    op.reject(new Error(code));
  }
  cancel() {
    if (this.active) this.fail(this.active, 'E_CANCELLED');
  }
  invalidate() {
    this.cancel();
    this.state = 'invalidated';
  }
  private guard(op: Operation) {
    if (this.active !== op) throw new Error('E_CANCELLED');
    if (this.now() - op.start >= 1000) {
      this.fail(op, 'E_DEADLINE');
      throw new Error('E_DEADLINE');
    }
  }
  run(request: PracticeRequest, problem?: GeneratedProblem): Promise<PracticeResponse> {
    this.cancel();
    const start = this.now(),
      snapshot = structuredClone(request);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = encodePracticeRequest(snapshot);
    } catch (e) {
      return Promise.reject(e);
    }
    this.state = 'loading';
    return new Promise((resolve, reject) => {
      const op: Operation = {
        id: crypto.randomUUID(),
        start,
        controller: new AbortController(),
        responded: false,
        reject,
      };
      this.active = op;
      op.releaseSlot = claimEngineSlot(() => this.fail(op, 'E_CANCELLED'));
      op.timer = setTimeout(
        () => this.fail(op, 'E_DEADLINE'),
        Math.max(0, 1000 - (this.now() - start)),
      );
      const guard = () => this.guard(op);
      void (async () => {
        try {
          const module = await this.store.load(op.controller.signal, guard);
          guard();
          const worker = this.createWorker();
          op.worker = worker;
          worker.onerror = (event) => {
            event.preventDefault();
            this.fail(op, 'E_WORKER_FAILURE');
          };
          worker.onmessageerror = () => this.fail(op, 'E_PROTOCOL_INVALID');
          worker.onmessage = (event) => {
            if (this.active !== op || op.worker !== worker || op.responded) return;
            op.responded = true;
            void (async () => {
              try {
                guard();
                const data = event.data as Record<string, unknown>;
                practiceAssert(data && data.operationId === op.id);
                if (data.ok === false) {
                  practiceAssert(
                    Object.keys(data).length === 3 &&
                      ['ok', 'operationId', 'code'].every((k) => k in data),
                  );
                  const allowed = [
                    'E_PROTOCOL_INVALID',
                    'E_UNSUPPORTED_VERSION',
                    'E_REQUEST_LIMIT',
                    'E_SOURCE_LIMIT',
                    'E_RESULT_LIMIT',
                    'E_FUEL_LIMIT',
                    'E_STEP_LIMIT',
                    'E_OUTPUT_LIMIT',
                    'E_DEADLINE',
                    'E_CANCELLED',
                    'E_ENCODING_FAILURE',
                    'E_GEN_SEED',
                    'E_GEN_DIFFICULTY',
                    'E_GEN_KNOWLEDGE',
                    'E_GEN_IDENTITY',
                    'E_GEN_INPUT',
                    'E_GENERATED_REFERENCE',
                    'E_WORKER_FAILURE',
                    'E_WASM_TRAP',
                  ];
                  throw new Error(
                    typeof data.code === 'string' && allowed.includes(data.code)
                      ? data.code
                      : 'E_WORKER_FAILURE',
                  );
                }
                practiceAssert(
                  data.ok === true &&
                    Object.keys(data).length === 4 &&
                    ['ok', 'operationId', 'buffer', 'wasmPages'].every((k) => k in data) &&
                    data.buffer instanceof ArrayBuffer &&
                    data.buffer.byteLength > 0 &&
                    data.buffer.byteLength <= 16777216 &&
                    typeof data.wasmPages === 'number' &&
                    Number.isInteger(data.wasmPages) &&
                    data.wasmPages > 0 &&
                    data.wasmPages <= 2048,
                );
                this.state = 'validating';
                const result = await (this.dependencies.decode ?? decodePracticeResponse)(
                  data.buffer,
                  snapshot,
                  engineBuild.wasmSha256,
                  guard,
                  problem,
                );
                guard();
                this.state = 'accepted';
                this.release(op);
                resolve(result);
              } catch (e) {
                this.fail(
                  op,
                  e instanceof Error && /^E_[A-Z_]+$/.test(e.message)
                    ? e.message
                    : 'E_PROTOCOL_INVALID',
                );
              }
            })();
          };
          guard();
          this.state = 'running';
          worker.postMessage(
            {
              operationId: op.id,
              module,
              buffer: bytes.buffer,
              buildId: engineBuild.wasmSha256,
              remainingMs: Math.floor(1000 - (this.now() - start)),
            },
            [bytes.buffer],
          );
        } catch (e) {
          this.fail(
            op,
            e instanceof Error && /^E_[A-Z_]+$/.test(e.message) ? e.message : 'E_MODULE_LOAD',
          );
        }
      })();
    });
  }
}
