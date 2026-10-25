import init, { build_probe } from '../generated/c_viz_wasm';
import type { ProbeRequest } from './types';

interface ProbeWorkerScope {
  onmessage: ((event: MessageEvent<ProbeRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}
const workerScope = globalThis as unknown as ProbeWorkerScope;
const workerInstanceId = crypto.randomUUID();
let consumed = false;
workerScope.onmessage = async (event: MessageEvent<ProbeRequest>) => {
  const request = event.data;
  if (consumed) return;
  consumed = true;
  if (
    request.kind !== 'build-check' ||
    typeof request.checkId !== 'string' ||
    !Number.isInteger(request.nonce) ||
    request.nonce < 0 ||
    request.nonce > 0xffffffff ||
    !(request.module instanceof WebAssembly.Module)
  )
    return;
  try {
    const exports = await init({ module_or_path: request.module });
    const memory = exports.memory;
    let bounded = false;
    try {
      memory.grow(2049);
    } catch (error) {
      bounded = error instanceof RangeError;
    }
    if (!bounded || memory.buffer.byteLength > 2048 * 65536) throw new Error('memory');
    const bytes = new TextEncoder().encode(build_probe(request.nonce));
    if (bytes.byteLength > 1024) throw new Error('size');
    workerScope.postMessage(
      {
        ok: true,
        checkId: request.checkId,
        workerInstanceId,
        maximumPages: 2048,
        buffer: bytes.buffer,
      },
      [bytes.buffer],
    );
  } catch {
    workerScope.postMessage({ ok: false, checkId: request.checkId });
  }
};
