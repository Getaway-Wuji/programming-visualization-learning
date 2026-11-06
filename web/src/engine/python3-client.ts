import wasmUrl from '../generated/python3/c_viz_python3_bg.wasm?url';
import { python3Build } from '../generated/python3/engine-build';
import { claimEngineSlot, ModuleStore } from './module';
import {
  decodePythonResponse,
  encodePythonRequest,
  pythonPackage,
  pythonRequest,
} from './python3-protocol';
import type { PythonOperation, PythonRequest, PythonResponse } from './python3-types';

const store = new ModuleStore(
  {},
  {
    url: wasmUrl,
    bytes: python3Build.wasmBytes,
    sha256: python3Build.wasmSha256,
  },
);
const accepted = new WeakMap<
  PythonResponse,
  {
    request: PythonRequest;
    wasmPages: number;
    current: () => boolean;
  }
>();
export function acceptedPythonExecution(response: PythonResponse) {
  const proof = accepted.get(response);
  return proof ? { request: structuredClone(proof.request), wasmPages: proof.wasmPages } : null;
}
export const currentPythonExecution = (response: PythonResponse) =>
  accepted.get(response)?.current() ? acceptedPythonExecution(response) : null;

interface WorkerMessage {
  id?: string;
  buffer?: ArrayBuffer;
  wasmPages?: number;
  code?: string;
}
interface Operation {
  cancel: (code: string) => void;
}

export class PythonExecutionClient {
  private active?: Operation;
  private revision = 0;

  run(source: string, input = '', revision?: string) {
    return this.execute(
      source,
      { kind: 'run', input: { kind: 'stdin-utf8', text: input } },
      revision,
    );
  }
  judge(source: string, profile: string, revision?: string) {
    return this.execute(
      source,
      {
        kind: 'judge',
        judgeVersion: '2.1.0',
        packageRef: pythonPackage,
        profileRef: { id: profile, version: '1.0.0' },
      },
      revision,
    );
  }
  analyze(source: string, documentId: string, revision?: string) {
    return this.execute(
      source,
      {
        kind: 'edit',
        editVersion: '2.1.0',
        packageRef: pythonPackage,
        documentId,
      },
      revision,
    );
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
    operation: PythonOperation,
    revision?: string,
  ): Promise<PythonResponse> {
    const start = performance.now();
    this.invalidate();
    const revisionToken = this.revision;
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
      const active: Operation = {
        cancel: (code) => {
          if (this.active !== active) return;
          dispose();
          reject(new Error(code));
        },
      };
      const guard = () => {
        if (this.active !== active) throw new Error('E_CANCELLED');
        if (performance.now() - start >= 1000) throw new Error('E_DEADLINE');
      };
      this.active = active;
      release = claimEngineSlot(active.cancel.bind(null, 'E_CANCELLED'));
      const timer = setTimeout(() => active.cancel('E_DEADLINE'), 1000);
      const onFailure = (error: unknown) =>
        active.cancel(error instanceof Error ? error.message : 'E_WORKER_FAILURE');
      void (async () => {
        const request = await pythonRequest(source, operation, revision);
        const bytes = encodePythonRequest(request);
        const module = await store.load(controller.signal, guard);
        guard();
        worker = new Worker(new URL('./python3-worker.ts', import.meta.url), { type: 'module' });
        worker.onerror = () => active.cancel('E_WORKER_FAILURE');
        worker.onmessageerror = () => active.cancel('E_PROTOCOL_INVALID');
        worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
          if (this.active !== active) return;
          worker!.onmessage = null;
          if (!data || data.id !== id) {
            active.cancel('E_PROTOCOL_INVALID');
            return;
          }
          if (typeof data.code === 'string' && /^E_[A-Z_]+$/.test(data.code)) {
            active.cancel(data.code);
            return;
          }
          if (
            !(data.buffer instanceof ArrayBuffer) ||
            !Number.isInteger(data.wasmPages) ||
            data.wasmPages! < 1 ||
            data.wasmPages! > 2048
          ) {
            active.cancel('E_PROTOCOL_INVALID');
            return;
          }
          const pages = data.wasmPages!;
          void (async () => {
            const response = await decodePythonResponse(
              data.buffer!,
              request,
              python3Build.wasmSha256,
              guard,
            );
            const pending: unknown[] = [response];
            for (let count = 0; pending.length; count++) {
              if (count % 1024 === 0) guard();
              const item = pending.pop();
              if (!item || typeof item !== 'object') continue;
              Object.freeze(item);
              for (const value of Object.values(item)) pending.push(value);
            }
            guard();
            accepted.set(response, {
              request,
              wasmPages: pages,
              current: () => revisionToken === this.revision,
            });
            dispose();
            resolve(response);
          })().catch(onFailure);
        };
        const remaining = Math.floor(1000 - (performance.now() - start));
        if (remaining < 1) throw new Error('E_DEADLINE');
        worker.postMessage({ id, module, buffer: bytes.buffer, remaining }, [bytes.buffer]);
      })().catch(onFailure);
    });
  }
}
