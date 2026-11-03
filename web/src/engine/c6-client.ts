import { engineBuild } from '../generated/c6-teaching/engine-build';
import { c6DiagnosticCodes } from '../generated/c6/diagnostic-codes';
import { c6ModuleStore, createC6ModuleStore } from './c6-module';
import { claimEngineSlot, type ModuleDependencies, type ModuleStore } from './module';
import {
  c6Assert,
  c6SourceHash,
  type C6RunRequest,
  decodeC6Response,
  encodeC6Request,
  type C6Request,
  type C6Response,
} from './c6-protocol';

export interface C6Dependencies extends ModuleDependencies {
  now?: () => number;
  createWorker?: () => Worker;
  decode?: typeof decodeC6Response;
  encode?: typeof encodeC6Request;
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
const acceptedRequests = new WeakMap<C6Response, C6Request>();
export interface C6AcceptedProof {
  requestSha256: string;
  resultSha256: string;
  engineBuildSha256: string;
  judge: null | {
    status: 'passed' | 'failed' | 'incomplete';
    profileId: string;
    caseKeys: string[];
    failedCaseKey: string | null;
    failure: 'wrong-answer' | 'teaching-goal-unmet' | 'program-error' | null;
  };
}
const acceptedProofs = new WeakMap<C6Response, C6AcceptedProof>();
export function acceptedC6Proof(result: C6Response): C6AcceptedProof | null {
  const proof = acceptedProofs.get(result);
  return proof ? structuredClone(proof) : null;
}
async function packetHash(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
function freezeAccepted(value: unknown, guard: () => void): void {
  const pending: unknown[] = [value];
  let count = 0;
  while (pending.length) {
    if (++count % 1024 === 0) guard();
    const item = pending.pop();
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      pending.push(...Object.values(item));
      Object.freeze(item);
    }
  }
}
/** In-c6 receipt from the final production acceptance boundary; injected clients cannot mint it. */
export function acceptedC6Request(result: C6Response): C6Request | null {
  const request = acceptedRequests.get(result);
  return request ? structuredClone(request) : null;
}
export async function c6RunRequest(
  source: string,
  inputText = '',
  sourceRevision: string = crypto.randomUUID(),
): Promise<C6RunRequest> {
  return {
    execVersion: '1.5.0',
    dslVersion: '1.4.0',
    diagnosticVersion: '1.4.0',
    integerEncoding: '1.0.0',
    language: 'c',
    engineId: 'engine.rust.c6',
    engineVersion: '0.1.0',
    runId: crypto.randomUUID(),
    sourceRevision,
    sourceSha256: await c6SourceHash(source),
    source,
    input: { kind: 'stdin-ascii', text: inputText },
  };
}

/** Internal c6 execution adapter; it never persists data or grants rewards.
 * Call invalidate synchronously for source/input/language changes or unmount. */
export class C6ExecutionClient {
  private active?: Operation;
  private state = 'idle';
  private readonly store: ModuleStore;
  private readonly now: () => number;
  private readonly createWorker: () => Worker;
  constructor(private readonly dependencies: C6Dependencies = {}) {
    this.store = Object.keys(dependencies).length
      ? createC6ModuleStore(dependencies)
      : c6ModuleStore;
    this.now = dependencies.now ?? (() => performance.now());
    this.createWorker =
      dependencies.createWorker ??
      (() => new Worker(new URL('./c6-worker.ts', import.meta.url), { type: 'module' }));
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
  execute(request: C6Request, options: { started?: number } = {}): Promise<C6Response> {
    this.cancel();
    const snapshot = structuredClone(request);
    const start = options.started ?? this.now();
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      if (!Number.isFinite(start) || start > this.now()) throw new Error('E_PROTOCOL_INVALID');
      bytes = (this.dependencies.encode ?? encodeC6Request)(snapshot);
      if (this.now() - start >= 1000) throw new Error('E_DEADLINE');
    } catch (error) {
      this.state = 'failed';
      return Promise.reject(error);
    }
    this.state = 'loading';
    return new Promise<C6Response>((resolve, reject) => {
      const operation: Operation = {
        id: crypto.randomUUID(),
        start,
        controller: new AbortController(),
        responded: false,
        reject,
      };
      this.active = operation;
      operation.releaseSlot = claimEngineSlot(() => this.fail(operation, 'E_CANCELLED'));
      operation.timer = setTimeout(
        () => this.fail(operation, 'E_DEADLINE'),
        Math.max(0, 1000 - (this.now() - start)),
      );
      const guard = () => this.guard(operation);
      void (async () => {
        try {
          const production = Object.keys(this.dependencies).length === 0;
          const [module, requestSha256] = await Promise.all([
            this.store.load(operation.controller.signal, guard),
            production ? packetHash(bytes.buffer) : Promise.resolve(''),
          ]);
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
                c6Assert(data && data.operationId === operation.id);
                if (data.ok === false) {
                  c6Assert(
                    Object.keys(data).length === 3 &&
                      ['ok', 'operationId', 'code'].every((key) => key in data),
                  );
                  const allowed: readonly string[] = [
                    ...c6DiagnosticCodes,
                    'E_WORKER_FAILURE',
                    'E_WASM_TRAP',
                  ];
                  throw new Error(
                    typeof data.code === 'string' && allowed.includes(data.code)
                      ? data.code
                      : 'E_WORKER_FAILURE',
                  );
                }
                c6Assert(
                  data.ok === true &&
                    Object.keys(data).length === 4 &&
                    ['ok', 'operationId', 'buffer', 'wasmPages'].every((key) => key in data) &&
                    data.buffer instanceof ArrayBuffer &&
                    data.buffer.byteLength > 0 &&
                    data.buffer.byteLength <= 16777216 &&
                    typeof data.wasmPages === 'number' &&
                    Number.isInteger(data.wasmPages) &&
                    data.wasmPages > 0 &&
                    data.wasmPages <= 2048,
                );
                this.state = 'validating';
                const value = await (this.dependencies.decode ?? decodeC6Response)(
                  data.buffer,
                  snapshot,
                  engineBuild.wasmSha256,
                  guard,
                );
                if ('aggregate' in value)
                  c6Assert(value.aggregate.wasmPeakBytes === data.wasmPages * 65536);
                const resultSha256 = production ? await packetHash(data.buffer) : '';
                if (production) freezeAccepted(value, guard);
                guard();
                if (production) {
                  const failed =
                    'cases' in value
                      ? value.cases.find(
                          (c) => !c.stdoutMatches || !c.returnMatches || !c.observationMatches,
                        )
                      : undefined;
                  acceptedRequests.set(value, snapshot);
                  acceptedProofs.set(value, {
                    requestSha256,
                    resultSha256,
                    engineBuildSha256: engineBuild.wasmSha256,
                    judge:
                      'cases' in value
                        ? {
                            status: value.status,
                            profileId: value.profileRef.id,
                            caseKeys: value.cases.map((c) => c.caseKey),
                            failedCaseKey: failed?.caseKey ?? null,
                            failure: !failed
                              ? null
                              : !failed.returnMatches
                                ? 'program-error'
                                : !failed.stdoutMatches
                                  ? 'wrong-answer'
                                  : 'teaching-goal-unmet',
                          }
                        : null,
                  });
                }
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
