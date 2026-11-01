import init, { practice_job } from '../generated/practice/c_viz_practice';
interface Message {
  operationId: string;
  module: WebAssembly.Module;
  buffer: ArrayBuffer;
  buildId: string;
  remainingMs: number;
}
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Message>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
let consumed = false;
scope.onmessage = async ({ data }) => {
  if (consumed) return;
  consumed = true;
  const operationId = data?.operationId;
  try {
    if (
      !data ||
      Object.keys(data).length !== 5 ||
      !['operationId', 'module', 'buffer', 'buildId', 'remainingMs'].every((k) => k in data) ||
      typeof operationId !== 'string' ||
      !(data.module instanceof WebAssembly.Module) ||
      !(data.buffer instanceof ArrayBuffer) ||
      !data.buffer.byteLength ||
      data.buffer.byteLength > 65536 ||
      !/^[a-f0-9]{64}$/.test(data.buildId) ||
      !Number.isInteger(data.remainingMs) ||
      data.remainingMs < 1 ||
      data.remainingMs > 1000
    )
      throw new Error('E_PROTOCOL_INVALID');
    const start = performance.now(),
      wasm = await init({ module_or_path: data.module }),
      remaining = Math.floor(data.remainingMs - (performance.now() - start));
    if (remaining < 1) throw new Error('E_DEADLINE');
    const bytes = practice_job(new Uint8Array(data.buffer), data.buildId, remaining);
    if (!bytes.byteLength || bytes.byteLength > 16777216) throw new Error('E_RESULT_LIMIT');
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
