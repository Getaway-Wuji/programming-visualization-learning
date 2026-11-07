import wasmUrl from '../generated/rust2018/c_viz_rust2018_bg.wasm?url';
import { rust2018Build } from '../generated/rust2018/engine-build';
import { rust2018DiagnosticCodes } from '../../../shared/contracts/rust2018-execution.mjs';
import { claimEngineSlot, ModuleStore } from './module';
import {
  decodeRustResponse,
  rustRequest,
  type RustOperation,
  type RustRequest,
  type RustResponse,
} from './rust2018-protocol';

const store = new ModuleStore(
  {},
  { url: wasmUrl, bytes: rust2018Build.wasmBytes, sha256: rust2018Build.wasmSha256 },
);
const accepted = new WeakMap<
  RustResponse,
  { request: RustRequest; wasmPages: number; current: () => boolean }
>();
export function acceptedRustExecution(response: RustResponse) {
  const proof = accepted.get(response);
  return proof ? { request: structuredClone(proof.request), wasmPages: proof.wasmPages } : null;
}
export const currentRustExecution = (response: RustResponse) =>
  accepted.get(response)?.current() ? acceptedRustExecution(response) : null;
const failureCodes = new Set([
  ...rust2018DiagnosticCodes,
  'E_WASM_TRAP',
  'E_WORKER_FAILURE',
  'E_PROTOCOL_INVALID',
  'E_MODULE_LOAD',
  'E_CANCELLED',
]);
interface WorkerMessage {
  id?: string;
  buffer?: ArrayBuffer;
  wasmPages?: number;
  code?: string;
}
interface ActiveOperation {
  cancel: (code: string) => void;
}

export class Rust2018Client {
  private active?: ActiveOperation;
  private revision = 0;
  run(source: string, input = '', revision?: string) {
    return this.execute(source, { operation: 'execute', input }, revision);
  }
  analyze(source: string, revision?: string) {
    return this.execute(source, { operation: 'analyze' }, revision);
  }
  judge(source: string, profile: string, reviewCase = 0, revision?: string) {
    return this.execute(source, { operation: 'judge', profile, reviewCase }, revision);
  }
  invalidate() {
    this.revision++;
    this.active?.cancel('E_CANCELLED');
  }
  cancel() {
    this.invalidate();
  }
  private execute(
    source: string,
    operation: RustOperation,
    revision?: string,
  ): Promise<RustResponse> {
    const started = performance.now();
    this.invalidate();
    const ticket = this.revision;
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const controller = new AbortController();
      let worker: Worker | undefined;
      let release = () => {};
      const dispose = () => {
        if (this.active !== active) return;
        this.active = undefined;
        clearTimeout(timer);
        release();
        controller.abort();
        worker?.terminate();
      };
      const active: ActiveOperation = {
        cancel: (code) => {
          if (this.active !== active) return;
          dispose();
          reject(new Error(code));
        },
      };
      const guard = () => {
        if (this.active !== active) throw new Error('E_CANCELLED');
        if (performance.now() - started >= 1000) throw new Error('E_DEADLINE');
      };
      this.active = active;
      release = claimEngineSlot(() => active.cancel('E_CANCELLED'));
      const timer = setTimeout(() => active.cancel('E_DEADLINE'), 1000);
      const fail = (error: unknown) =>
        active.cancel(error instanceof Error ? error.message : 'E_WORKER_FAILURE');
      void (async () => {
        const { request, bytes } = rustRequest(source, operation, revision);
        guard();
        const module = await store.load(controller.signal, guard);
        guard();
        worker = new Worker(new URL('./rust2018-worker.ts', import.meta.url), { type: 'module' });
        worker.onerror = () => active.cancel('E_WORKER_FAILURE');
        worker.onmessageerror = () => active.cancel('E_PROTOCOL_INVALID');
        worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
          if (this.active !== active) return;
          worker!.onmessage = null;
          if (!data || data.id !== id) {
            active.cancel('E_PROTOCOL_INVALID');
            return;
          }
          if (Object.hasOwn(data, 'code')) {
            active.cancel(
              Object.keys(data).length === 2 &&
                typeof data.code === 'string' &&
                failureCodes.has(data.code)
                ? data.code
                : 'E_PROTOCOL_INVALID',
            );
            return;
          }
          if (
            Object.keys(data).length !== 3 ||
            !(data.buffer instanceof ArrayBuffer) ||
            !Number.isInteger(data.wasmPages) ||
            data.wasmPages! < 1 ||
            data.wasmPages! > 2048
          ) {
            active.cancel('E_PROTOCOL_INVALID');
            return;
          }
          const pages = data.wasmPages;
          void (async () => {
            const response = await decodeRustResponse(
              data.buffer!,
              request,
              rust2018Build.wasmSha256,
              guard,
            );
            const pending: unknown[] = [response];
            for (let count = 0; pending.length; count++) {
              if (count % 1024 === 0) guard();
              const value = pending.pop();
              if (value === null || typeof value !== 'object') continue;
              Object.freeze(value);
              pending.push(...Object.values(value));
            }
            guard();
            accepted.set(response, {
              request,
              wasmPages: pages!,
              current: () => ticket === this.revision,
            });
            dispose();
            resolve(response);
          })().catch(fail);
        };
        const remaining = Math.floor(1000 - (performance.now() - started));
        if (remaining < 1) throw new Error('E_DEADLINE');
        worker.postMessage({ id, module, buffer: bytes.buffer, remaining }, [bytes.buffer]);
      })().catch(fail);
    });
  }
}
