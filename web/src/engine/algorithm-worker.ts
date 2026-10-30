import init, { execute_algorithm } from '../generated/algorithm/c_viz_algorithm';

interface Message {
  operationId: string;
  module: WebAssembly.Module;
  buffer: ArrayBuffer;
  buildId: string;
  remainingMs: number;
}
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Message>) => void) | null;
  postMessage: (value: unknown, transfer?: Transferable[]) => void;
};
let consumed = false;
scope.onmessage = async ({ data }) => {
  if (consumed) return;
  consumed = true;
  const operationId = data?.operationId;
  try {
    if (
      !data ||
      typeof operationId !== 'string' ||
      !(data.module instanceof WebAssembly.Module) ||
      !(data.buffer instanceof ArrayBuffer) ||
      !data.buffer.byteLength ||
      data.buffer.byteLength > 65536 ||
      typeof data.buildId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.buildId) ||
      !Number.isInteger(data.remainingMs) ||
      data.remainingMs < 1 ||
      data.remainingMs > 1000
    )
      throw new Error('E_PROTOCOL_INVALID');
    const start = performance.now();
    const wasm = await init({ module_or_path: data.module });
    const remaining = Math.floor(data.remainingMs - (performance.now() - start));
    if (remaining < 1) throw new Error('E_DEADLINE');
    const bytes = execute_algorithm(new Uint8Array(data.buffer), data.buildId, remaining);
    if (!bytes.byteLength || bytes.byteLength > 16777216) throw new Error('E_ENCODING_FAILURE');
    const buffer = bytes.slice().buffer;
    scope.postMessage(
      { ok: true, operationId, buffer, wasmPages: wasm.memory.buffer.byteLength / 65536 },
      [buffer],
    );
  } catch (error) {
    const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
    const code =
      error instanceof WebAssembly.RuntimeError
        ? 'E_WASM_TRAP'
        : /^E_[A-Z_]+$/.test(message)
          ? message
          : 'E_WORKER_FAILURE';
    scope.postMessage({ ok: false, operationId, code });
  }
};
