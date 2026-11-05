import init, { analyze_code_draft } from '../generated/c_viz_wasm';
import { loadAnalysisCatalog } from './analysis-catalog';

interface WorkerRequest {
  kind: 'analyze-code';
  operationId: string;
  module: WebAssembly.Module;
  exerciseId: string;
  buffer: ArrayBuffer;
  remainingMs: number;
}
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
let consumed = false;
scope.onmessage = async ({ data }) => {
  if (consumed) return;
  consumed = true;
  if (!data || data.kind !== 'analyze-code' || typeof data.operationId !== 'string') return;
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, Math.min(1000, data.remainingMs)));
  const guard = () => {
    if (controller.signal.aborted || performance.now() - start >= data.remainingMs)
      throw new Error('E_DEADLINE');
  };
  try {
    if (
      Object.keys(data).sort().join(',') !==
        'buffer,exerciseId,kind,module,operationId,remainingMs' ||
      !(data.module instanceof WebAssembly.Module) ||
      !(data.buffer instanceof ArrayBuffer) ||
      data.buffer.byteLength > 65536 ||
      typeof data.exerciseId !== 'string' ||
      !Number.isSafeInteger(data.remainingMs) ||
      data.remainingMs < 1 ||
      data.remainingMs > 1000
    )
      throw new Error('E_PROTOCOL_INVALID');
    // The static exercise package is independently integrity checked here.
    // Caller-selected answer/catalog objects never enter this Worker.
    const catalog = await loadAnalysisCatalog(data.exerciseId, controller.signal).catch((error) => {
      guard();
      if (error instanceof Error && error.message === 'E_CONTENT_MISMATCH') throw error;
      throw new Error('E_MODULE_LOAD');
    });
    guard();
    // Rust's bounded codec checks the request shape, duplicate keys, identities,
    // controlled input and source. Avoid a second JS schema graph in this Worker.
    const requestJson = new TextDecoder('utf-8', { fatal: true }).decode(data.buffer);
    await init({ module_or_path: data.module });
    guard();
    const bytes = analyze_code_draft(
      requestJson,
      JSON.stringify(catalog),
      Math.max(0, Math.floor(data.remainingMs - (performance.now() - start))),
    );
    guard();
    if (!bytes.byteLength || bytes.byteLength > 16777216) throw new Error('E_RESULT_LIMIT');
    const buffer = bytes.slice().buffer;
    scope.postMessage({ ok: true, operationId: data.operationId, buffer }, [buffer]);
  } catch (error) {
    const code = controller.signal.aborted
      ? 'E_DEADLINE'
      : error instanceof WebAssembly.RuntimeError
        ? 'E_WASM_TRAP'
        : typeof error === 'string' && /^E_[A-Z_]+$/.test(error)
          ? error
          : error instanceof Error && /^E_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'E_WORKER_FAILURE';
    scope.postMessage({ ok: false, operationId: data.operationId, code });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
};
