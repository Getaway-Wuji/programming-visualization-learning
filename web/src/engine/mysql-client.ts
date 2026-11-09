import wasmUrl from '../generated/mysql/c_viz_mysql_bg.wasm?url';
import { mysqlBuild } from '../generated/mysql/engine-build';
import { mysqlDiagnosticCodes } from '../../../shared/contracts/mysql-execution.mjs';
import { claimEngineSlot, ModuleStore } from './module';
import type { MysqlSession } from './mysql-types';
import {
  decodeMysqlResponse,
  mysqlRequest,
  type MysqlOperation,
  type MysqlRequest,
  type MysqlResponse,
} from './mysql-protocol';

const store = new ModuleStore(
  {},
  { url: wasmUrl, bytes: mysqlBuild.wasmBytes, sha256: mysqlBuild.wasmSha256 },
);
export { store as mysqlModuleStore };
const accepted = new WeakMap<
  MysqlResponse,
  { request: MysqlRequest; wasmPages: number; current: () => boolean }
>();
export function acceptedMysqlExecution(response: MysqlResponse) {
  const proof = accepted.get(response);
  return proof ? { request: structuredClone(proof.request), wasmPages: proof.wasmPages } : null;
}
export const currentMysqlExecution = (response: MysqlResponse) =>
  accepted.get(response)?.current() ? acceptedMysqlExecution(response) : null;
const failureCodes = new Set([
  ...mysqlDiagnosticCodes,
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

export class MysqlClient {
  private active?: ActiveOperation;
  private revision = 0;
  run(source: string, session: MysqlSession, revision?: string) {
    return this.execute(source, { operation: 'execute', session }, revision);
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
    operation: MysqlOperation,
    revision?: string,
  ): Promise<MysqlResponse> {
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
        const { request, bytes } = mysqlRequest(source, operation, revision);
        guard();
        const module = await store.load(controller.signal, guard);
        guard();
        worker = new Worker(new URL('./mysql-worker.ts', import.meta.url), { type: 'module' });
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
            const response = await decodeMysqlResponse(
              data.buffer!,
              request,
              mysqlBuild.wasmSha256,
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
