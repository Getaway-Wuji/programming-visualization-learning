import init, { execute_rust2018 } from '../generated/rust2018/c_viz_rust2018';
import { rust2018Build } from '../generated/rust2018/engine-build';

interface Input {
  id: string;
  module: WebAssembly.Module;
  buffer: ArrayBuffer;
  remaining: number;
}
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Input>) => void) | null;
  postMessage(value: unknown, transfer?: Transferable[]): void;
};
scope.onmessage = async ({ data }) => {
  scope.onmessage = null;
  const started = performance.now();
  try {
    if (
      !data ||
      Object.keys(data).length !== 4 ||
      typeof data.id !== 'string' ||
      !(data.module instanceof WebAssembly.Module) ||
      !(data.buffer instanceof ArrayBuffer) ||
      data.buffer.byteLength === 0 ||
      data.buffer.byteLength > 65536 ||
      !Number.isInteger(data.remaining) ||
      data.remaining < 1 ||
      data.remaining > 1000
    )
      throw new Error('E_PROTOCOL_INVALID');
    const instance = await init({ module_or_path: data.module });
    const remaining = Math.floor(data.remaining - (performance.now() - started));
    if (remaining < 1) throw new Error('E_DEADLINE');
    const output = execute_rust2018(
      new Uint8Array(data.buffer),
      rust2018Build.wasmSha256,
      remaining,
    );
    if (output.byteLength > 16777216) throw new Error('E_RESULT_LIMIT');
    const buffer = output.slice().buffer;
    const wasmPages = instance.memory.buffer.byteLength / 65536;
    if (wasmPages > 2048) throw new Error('E_MEMORY_LIMIT');
    scope.postMessage({ id: data.id, buffer, wasmPages }, [buffer]);
  } catch (error) {
    const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
    const code =
      error instanceof WebAssembly.RuntimeError
        ? 'E_WASM_TRAP'
        : /^E_[A-Z_]+$/.test(message)
          ? message
          : 'E_WORKER_FAILURE';
    scope.postMessage({ id: data?.id, code });
  }
};
