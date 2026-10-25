import init, {
  execute_request,
  last_execution_timings,
  prepare_input,
} from '../generated/c_viz_wasm';

interface Request {
  kind: 'prepare-case' | 'execute';
  operationId: string;
  module: WebAssembly.Module;
  catalogJson: string;
  buildId: string;
  buffer?: ArrayBuffer;
  remainingMs: number;
}
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (value: unknown, transfer?: Transferable[]) => void;
};
let consumed = false;
scope.onmessage = async ({ data }) => {
  if (consumed) return;
  consumed = true;
  if (
    !data ||
    !['prepare-case', 'execute'].includes(data.kind) ||
    typeof data.operationId !== 'string'
  )
    return;
  try {
    if (
      !(data.module instanceof WebAssembly.Module) ||
      typeof data.catalogJson !== 'string' ||
      new TextEncoder().encode(data.catalogJson).byteLength > 65536
    )
      throw new Error('E_PROTOCOL_INVALID');
    const start = performance.now();
    const wasm = await init({ module_or_path: data.module });
    if (performance.now() - start >= data.remainingMs) throw new Error('E_DEADLINE');
    let bytes: Uint8Array;
    let technical: { wholeWasmCallMs: number; rust: number[]; wasmPages: number } | undefined;
    if (data.kind === 'prepare-case') {
      if (!(data.buffer instanceof ArrayBuffer) || data.buffer.byteLength > 65536)
        throw new Error('E_INPUT_INVALID');
      bytes = prepare_input(
        data.catalogJson,
        new Uint8Array(data.buffer),
        Math.max(0, Math.floor(data.remainingMs - (performance.now() - start))),
      );
    } else {
      if (!(data.buffer instanceof ArrayBuffer) || data.buffer.byteLength > 65536)
        throw new Error('E_PROTOCOL_INVALID');
      const callStart = performance.now();
      bytes = execute_request(
        new Uint8Array(data.buffer),
        data.catalogJson,
        data.buildId,
        Math.max(0, Math.floor(data.remainingMs - (performance.now() - start))),
      );
      const wholeWasmCallMs = performance.now() - callStart;
      const observed = Array.from(last_execution_timings());
      // Private bounded numeric diagnostics. Never used for execution,
      // acceptance, judging or learning records; EXEC bytes stay unchanged.
      if (observed.length === 27 && observed.every(Number.isFinite))
        technical = {
          wholeWasmCallMs,
          rust: observed,
          wasmPages: wasm.memory.buffer.byteLength / 65536,
        };
    }
    const limit = data.kind === 'execute' ? 16777216 : 65536;
    if (!bytes.byteLength || bytes.byteLength > limit) throw new Error('E_ENCODING_FAILURE');
    // wasm-bindgen owns the returned copy. Transfer only its bounded buffer.
    const buffer = bytes.slice().buffer;
    scope.postMessage({ ok: true, operationId: data.operationId, buffer, technical }, [buffer]);
  } catch (error) {
    const code =
      error instanceof WebAssembly.RuntimeError
        ? 'E_WASM_TRAP'
        : typeof error === 'string' && /^E_[A-Z_]+$/.test(error)
          ? error
          : error instanceof Error && /^E_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'E_WORKER_FAILURE';
    scope.postMessage({ ok: false, operationId: data.operationId, code });
  }
};
