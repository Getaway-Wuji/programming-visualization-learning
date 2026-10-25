import init, { build_probe } from '../../../web/src/generated/c_viz_wasm.js';
import type { ProbeWorkerRequest, ProbeWorkerResponse, WorkerSuccess } from './types';

interface ProbeWorkerScope {
  onmessage: ((event: MessageEvent<ProbeWorkerRequest>) => void) | null;
  postMessage: (message: ProbeWorkerResponse, transfer?: Transferable[]) => void;
}

const workerScope = globalThis as unknown as ProbeWorkerScope;

workerScope.onmessage = async (event) => {
  try {
    const initStart = performance.now();
    const wasm = await init({ module_or_path: event.data.module });
    const initMs = performance.now() - initStart;
    const currentPages = wasm.memory.buffer.byteLength / 65536;

    // A delta of 2049 pages necessarily exceeds the declared maximum. A
    // rejected grow proves the limit without allocating a 128 MiB test heap.
    let growBeyondMaximumRejected = false;
    try {
      wasm.memory.grow(2049);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      growBeyondMaximumRejected = true;
    }
    if (!growBeyondMaximumRejected || currentPages > 2048) {
      throw new Error('WASM 线性内存上限检查失败。');
    }

    const rustStart = performance.now();
    const rustJson = build_probe(event.data.nonce);
    const rustProbeMs = performance.now() - rustStart;
    const encodeStart = performance.now();
    const bytes = new TextEncoder().encode(rustJson);
    if (bytes.byteLength >= 1024) {
      throw new Error('构建探针响应必须小于 1 KiB。');
    }
    const response: WorkerSuccess = {
      ok: true,
      buffer: bytes.buffer,
      workerInstanceId: crypto.randomUUID(),
      memory: {
        currentPages: wasm.memory.buffer.byteLength / 65536,
        maximumPages: 2048,
        growBeyondMaximumRejected: true,
      },
      timings: {
        initMs,
        rustProbeMs,
        encodeMs: performance.now() - encodeStart,
      },
    };
    workerScope.postMessage(response, [response.buffer]);
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
