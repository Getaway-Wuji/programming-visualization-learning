import wasmUrl from '../../../web/src/generated/c_viz_wasm_bg.wasm?url';
import type {
  BuildProbe,
  ProbeRequest,
  ProbeResult,
  ProbeWorkerResponse,
  WorkerSuccess,
} from './types';

let cachedModule: WebAssembly.Module | undefined;
let cachedMimeType = '';
let nextWorkerId = 0;
let running = false;
const status = document.querySelector<HTMLParagraphElement>('#probe-status')!;
const result = document.querySelector<HTMLPreElement>('#probe-result')!;

function validateProbe(value: unknown, nonce: number): asserts value is BuildProbe {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    value.kind !== 'build-probe' ||
    !('probeVersion' in value) ||
    value.probeVersion !== '1.0.0' ||
    !('engineVersion' in value) ||
    value.engineVersion !== '0.1.0' ||
    !('interpreterReady' in value) ||
    value.interpreterReady !== false ||
    !('nonce' in value) ||
    value.nonce !== nonce
  ) {
    throw new Error('Rust 构建探针响应校验失败。');
  }
}

window.runBuildProbe = async (request: ProbeRequest): Promise<ProbeResult> => {
  if (!Number.isInteger(request.nonce) || request.nonce < 0 || request.nonce > 0xffffffff) {
    throw new Error('构建探针 nonce 必须是 uint32。');
  }
  if (running) throw new Error('内部检查每次仅允许一个 Worker。');
  running = true;
  const totalStart = performance.now();
  let worker: Worker | undefined;
  let fetchMs = 0;
  let compileMs = 0;
  status.textContent = '检查真实 Rust/WASM 构建连接中。';
  result.textContent = '';

  try {
    const moduleStart = performance.now();
    const moduleMode = request.warm && !request.missing ? 'warm' : 'cold';
    if (moduleMode === 'warm' && !cachedModule) {
      throw new Error('暖检查前须先完成冷 Module 检查。');
    }
    if (moduleMode === 'cold') {
      // The page keeps only one current read-only compiled Module. No mutable
      // WASM instance survives a run, including the first cold run.
      cachedModule = undefined;
      cachedMimeType = '';
      const fetchStart = performance.now();
      const resourceUrl = request.missing
        ? new URL('./missing-engine.wasm', location.href).href
        : wasmUrl;
      const response = await fetch(resourceUrl);
      if (!response.ok) {
        throw new Error(`WASM 资源加载失败（HTTP ${response.status}）。`);
      }
      cachedMimeType = response.headers.get('content-type') ?? '';
      if (!/^application\/wasm(?:;|$)/i.test(cachedMimeType)) {
        throw new Error(`WASM MIME 不正确：${cachedMimeType}`);
      }
      const bytes = await response.arrayBuffer();
      fetchMs = performance.now() - fetchStart;
      const compileStart = performance.now();
      cachedModule = await WebAssembly.compile(bytes);
      compileMs = performance.now() - compileStart;
    }
    const module = cachedModule;
    if (!module) throw new Error('编译 Module 未就绪。');
    const modulePrepareMs = performance.now() - moduleStart;
    const workerId = ++nextWorkerId;
    const workerStart = performance.now();
    worker = new Worker(new URL('./probe.worker.ts', import.meta.url), {
      type: 'module',
    });
    const activeWorker = worker;
    const response = await new Promise<WorkerSuccess>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('构建探针检查超时。')), 10000);
      activeWorker.onmessage = (event: MessageEvent<ProbeWorkerResponse>) => {
        clearTimeout(timeout);
        if (!event.data.ok) reject(new Error(event.data.error));
        else resolve(event.data);
      };
      activeWorker.onerror = (event) => {
        clearTimeout(timeout);
        reject(new Error(`构建 Worker 加载或调用失败：${event.message}`));
      };
      activeWorker.onmessageerror = () => {
        clearTimeout(timeout);
        reject(new Error('构建 Worker 消息解码失败。'));
      };
      activeWorker.postMessage({ nonce: request.nonce, module });
    });
    const workerMs = performance.now() - workerStart;
    const decodeStart = performance.now();
    if (!(response.buffer instanceof ArrayBuffer) || response.buffer.byteLength >= 1024) {
      throw new Error('构建探针编码缓冲无效。');
    }
    const probe: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(response.buffer),
    );
    validateProbe(probe, request.nonce);
    const transferDecodeMs = performance.now() - decodeStart;
    const output: ProbeResult = {
      probe,
      moduleMode,
      workerId,
      workerInstanceId: response.workerInstanceId,
      terminated: true,
      bufferBytes: response.buffer.byteLength,
      timings: {
        fetchMs,
        compileMs,
        modulePrepareMs,
        workerMs,
        ...response.timings,
        transferDecodeMs,
        totalMs: performance.now() - totalStart,
      },
      memory: response.memory,
      imports: WebAssembly.Module.imports(module),
      exports: WebAssembly.Module.exports(module),
      wasmUrl,
      mimeType: cachedMimeType,
    };
    status.textContent = `真实 Rust 构建探针通过（${moduleMode} Module）；构建探针不执行 C。`;
    result.textContent = JSON.stringify(output, null, 2);
    return output;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    worker?.terminate();
    running = false;
  }
};

status.textContent = '内部检查入口已就绪；引擎按需加载。';

import './storage';
import './learning';
import './recovery';
import './execution';
import './input-data';
