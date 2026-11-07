import wasmUrl from '../generated/cpp-course/c_viz_cpp_course_bg.wasm?url';
import { cppCourseBuild } from '../generated/cpp-course/engine-build';
import { claimEngineSlot, ModuleStore } from './module';
import {
  cppCourseProtocol as protocol,
  cppRequest,
  decodeCppResponse,
  type CppCourseRequest,
  type CppCourseResponse,
  type CppInput,
  type CppOperation,
} from './cpp-course-protocol';

const store = new ModuleStore(
  {},
  { url: wasmUrl, bytes: cppCourseBuild.wasmBytes, sha256: cppCourseBuild.wasmSha256 },
);
const receipts = new WeakMap<
  CppCourseResponse,
  { request: CppCourseRequest; wasmPages: number; current: () => boolean }
>();
export function currentCppExecution(result: CppCourseResponse) {
  const receipt = receipts.get(result);
  return receipt?.current()
    ? { request: structuredClone(receipt.request), wasmPages: receipt.wasmPages }
    : null;
}

interface CppWorkerMessage {
  id: string;
  code?: string;
  buffer?: ArrayBuffer;
  wasmPages?: number;
}

export class CppCourseClient {
  private stop?: (code: string) => void;
  private generation = 0;

  run(source: string, input: CppInput, revision?: string) {
    return this.execute(
      source,
      { operation: 'execute', input: structuredClone(input) },
      input,
      revision,
    );
  }
  analyze(source: string, revision?: string) {
    return this.execute(
      source,
      { operation: 'analyze' },
      { kind: 'integers', values: [] },
      revision,
    );
  }
  judge(source: string, profile: string, reviewCase: number, input: CppInput, revision?: string) {
    return this.execute(source, { operation: 'judge', profile, reviewCase }, input, revision);
  }
  invalidate() {
    this.generation++;
    this.stop?.('E_CANCELLED');
  }

  private execute(
    source: string,
    operation: CppOperation,
    input: CppInput,
    revision: string = crypto.randomUUID(),
  ): Promise<CppCourseResponse> {
    const start = performance.now();
    this.invalidate();
    const generation = this.generation;
    const replayInput = structuredClone(input);
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      let worker: Worker | undefined;
      const dispose = () => {
        this.stop = undefined;
        clearTimeout(timer);
        release();
        controller.abort();
        worker?.terminate();
      };
      const stop = (code: string) => {
        if (this.stop !== stop) return;
        dispose();
        reject(new Error(code));
      };
      const guard = () => {
        if (this.stop !== stop) throw new Error('E_CANCELLED');
        if (performance.now() - start >= protocol.deadlineMs) throw new Error('E_DEADLINE');
      };
      this.stop = stop;
      const timer = setTimeout(() => stop('E_DEADLINE'), protocol.deadlineMs);
      const release = claimEngineSlot(() => stop('E_CANCELLED'));
      const fail = (error: unknown) => {
        if (this.stop !== stop) return;
        dispose();
        reject(
          error instanceof Error && /^E_[A-Z_]+$/.test(error.message)
            ? error
            : new Error('E_PROTOCOL_INVALID', { cause: error }),
        );
      };
      void (async () => {
        const { request, bytes } = cppRequest(source, operation, revision);
        const module = await store.load(controller.signal, guard);
        guard();
        worker = new Worker(new URL('./cpp-course-worker.ts', import.meta.url), { type: 'module' });
        worker.onerror = (event) => {
          event.preventDefault();
          stop('E_WORKER_FAILURE');
        };
        worker.onmessageerror = () => stop('E_PROTOCOL_INVALID');
        worker.onmessage = ({ data }: MessageEvent<CppWorkerMessage>) => {
          if (this.stop !== stop) return;
          worker!.onmessage = null;
          if (!data || data.id !== request.runId) return stop('E_PROTOCOL_INVALID');
          if (
            Object.keys(data).length === 2 &&
            typeof data.code === 'string' &&
            /^E_[A-Z_]+$/.test(data.code)
          )
            return stop(data.code);
          const { buffer, wasmPages } = data;
          if (
            Object.keys(data).length !== 3 ||
            !(buffer instanceof ArrayBuffer) ||
            typeof wasmPages !== 'number' ||
            !Number.isInteger(wasmPages) ||
            wasmPages < 1 ||
            wasmPages > protocol.wasmPages
          )
            return stop('E_PROTOCOL_INVALID');
          void (async () => {
            guard();
            const result = await decodeCppResponse(
              buffer,
              request,
              cppCourseBuild.wasmSha256,
              replayInput,
              guard,
            );
            const pending: unknown[] = [result];
            for (let count = 0; pending.length; count++) {
              if (count % 1024 === 0) guard();
              const item = pending.pop();
              if (!item || typeof item !== 'object') continue;
              Object.freeze(item);
              for (const value of Object.values(item)) pending.push(value);
            }
            guard();
            receipts.set(result, {
              request,
              wasmPages,
              current: () => this.generation === generation,
            });
            dispose();
            resolve(result);
          })().catch(fail);
        };
        const remaining = Math.floor(protocol.deadlineMs - (performance.now() - start));
        if (remaining < 1) throw new Error('E_DEADLINE');
        worker.postMessage({ id: request.runId, module, buffer: bytes.buffer, remaining }, [
          bytes.buffer,
        ]);
      })().catch(fail);
    });
  }
}
