import wasmUrl from '../generated/c_viz_wasm_bg.wasm?url';
import { engineBuild } from '../generated/engine-build';
import { claimEngineSlot, sharedModuleStore } from './module';
import {
  EngineFailure,
  type BuildCheckReport,
  type EngineFailureCode,
  type EngineState,
} from './types';

export interface EngineDependencies {
  fetcher?: typeof fetch;
  createWorker?: () => Worker;
  compile?: typeof WebAssembly.compile;
  digest?: (bytes: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>;
  now?: () => number;
  deadlineMs?: number;
}

interface Operation {
  id: string;
  nonce: number;
  start: number;
  mode: 'cold' | 'warm';
  controller: AbortController;
  worker?: Worker;
  timer?: ReturnType<typeof setTimeout>;
  resolve: (value: BuildCheckReport) => void;
  reject: (reason: EngineFailure) => void;
  releaseSlot?: () => void;
}

export class EngineClient {
  private module: WebAssembly.Module | undefined;
  private active: Operation | undefined;
  private state: EngineState = 'idle';
  private readonly fetcher: typeof fetch;
  private readonly createWorker: () => Worker;
  private readonly compile: typeof WebAssembly.compile;
  private readonly digest: (bytes: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>;
  private readonly now: () => number;
  private readonly deadlineMs: number;
  private readonly shareModule: boolean;

  constructor(dependencies: EngineDependencies = {}) {
    this.shareModule = Object.keys(dependencies).length === 0;
    this.fetcher = dependencies.fetcher ?? ((...args) => fetch(...args));
    this.createWorker =
      dependencies.createWorker ??
      (() => new Worker(new URL('./probe.worker.ts', import.meta.url), { type: 'module' }));
    this.compile = dependencies.compile ?? ((bytes) => WebAssembly.compile(bytes));
    this.digest = dependencies.digest ?? ((bytes) => crypto.subtle.digest('SHA-256', bytes));
    this.now = dependencies.now ?? (() => performance.now());
    this.deadlineMs = dependencies.deadlineMs ?? 1000;
  }

  inspect() {
    return {
      state: this.state,
      checkId: this.active?.id ?? null,
      activeWorkers: this.active?.worker ? 1 : 0,
      cachedModules: this.module || (this.shareModule && sharedModuleStore.module) ? 1 : 0,
    };
  }

  check(): Promise<BuildCheckReport> {
    this.cancel('superseded');
    this.state = 'loading';
    const promise = new Promise<BuildCheckReport>((resolve, reject) => {
      const operation: Operation = {
        id: crypto.randomUUID(),
        nonce: crypto.getRandomValues(new Uint32Array(1))[0]!,
        start: this.now(),
        mode: this.module || (this.shareModule && sharedModuleStore.module) ? 'warm' : 'cold',
        controller: new AbortController(),
        resolve,
        reject,
      };
      this.active = operation;
      operation.releaseSlot = claimEngineSlot(() => this.fail(operation, 'CHECK_CANCELLED'));
      operation.timer = setTimeout(() => this.fail(operation, 'CHECK_TIMEOUT'), this.deadlineMs);
      void this.start(operation);
    });
    return promise;
  }

  cancel(_reason = 'cancelled', checkId?: string) {
    void _reason;
    if (this.active && (!checkId || this.active.id === checkId))
      this.fail(this.active, 'CHECK_CANCELLED');
  }

  private current(operation: Operation) {
    if (this.active !== operation) return false;
    if (this.now() - operation.start >= this.deadlineMs) {
      this.fail(operation, 'CHECK_TIMEOUT');
      return false;
    }
    return true;
  }

  private release(operation: Operation) {
    // Invalidate before aborting work: queued messages can no longer be accepted.
    this.active = undefined;
    operation.releaseSlot?.();
    clearTimeout(operation.timer);
    operation.controller.abort();
    if (operation.worker) {
      operation.worker.onmessage = null;
      operation.worker.onerror = null;
      operation.worker.onmessageerror = null;
      operation.worker.terminate();
    }
  }

  private fail(operation: Operation, code: EngineFailureCode) {
    if (this.active !== operation) return;
    this.state =
      code === 'CHECK_CANCELLED' ? 'cancelled' : code === 'CHECK_TIMEOUT' ? 'timed-out' : 'failed';
    this.release(operation);
    operation.reject(new EngineFailure(code));
  }

  private async load(operation: Operation) {
    if (this.shareModule) {
      try {
        const module = await sharedModuleStore.load(operation.controller.signal, () => {
          if (!this.current(operation)) throw new EngineFailure('CHECK_CANCELLED');
        });
        this.module = module;
        return module;
      } catch (error) {
        throw error instanceof EngineFailure ? error : new EngineFailure('MODULE_LOAD_FAILED');
      }
    }
    if (this.module) return this.module;
    let response: Response;
    try {
      response = await this.fetcher(wasmUrl, {
        signal: operation.controller.signal,
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      throw new EngineFailure('MODULE_LOAD_FAILED');
    }
    if (!this.current(operation)) return;
    if (!response.ok) throw new EngineFailure('MODULE_LOAD_FAILED');
    if (
      response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/wasm' ||
      !response.body
    )
      throw new EngineFailure('MODULE_INVALID');
    const reader = response.body.getReader();
    const bytes = new Uint8Array(engineBuild.wasmBytes);
    let offset = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (!this.current(operation)) {
          await reader.cancel();
          return;
        }
        if (done) break;
        if (offset + value.byteLength > bytes.length) throw new EngineFailure('MODULE_INVALID');
        bytes.set(value, offset);
        offset += value.byteLength;
      }
    } catch (error) {
      throw error instanceof EngineFailure ? error : new EngineFailure('MODULE_LOAD_FAILED');
    } finally {
      reader.releaseLock();
    }
    if (offset !== bytes.length) throw new EngineFailure('MODULE_INVALID');
    let digest: ArrayBuffer;
    try {
      digest = await this.digest(bytes);
    } catch {
      throw new EngineFailure('MODULE_INVALID');
    }
    const hash = Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, '0'),
    ).join('');
    if (!this.current(operation)) return;
    if (hash !== engineBuild.wasmSha256) throw new EngineFailure('MODULE_INVALID');
    let compiled: WebAssembly.Module;
    try {
      compiled = await this.compile(bytes);
    } catch {
      throw new EngineFailure('MODULE_INVALID');
    }
    if (!this.current(operation)) return;
    this.module = compiled;
    return compiled;
  }

  private async start(operation: Operation) {
    try {
      const module = await this.load(operation);
      if (!module || !this.current(operation)) return;
      const worker = this.createWorker();
      operation.worker = worker;
      worker.onerror = (event) => {
        event.preventDefault();
        this.fail(operation, 'WORKER_FAILED');
      };
      worker.onmessageerror = () => this.fail(operation, 'RESPONSE_INVALID');
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (operation.worker !== worker || !this.current(operation)) return;
        try {
          const data = event.data as Record<string, unknown>;
          if (!data || data.checkId !== operation.id) throw new EngineFailure('RESPONSE_INVALID');
          if (data.ok === false) throw new EngineFailure('WORKER_FAILED');
          if (
            data.ok !== true ||
            typeof data.workerInstanceId !== 'string' ||
            data.maximumPages !== 2048 ||
            !(data.buffer instanceof ArrayBuffer) ||
            data.buffer.byteLength > 1024
          )
            throw new EngineFailure('RESPONSE_INVALID');
          const build: BuildCheckReport['build'] = {
            kind: 'build-probe',
            probeVersion: '1.0.0',
            nonce: operation.nonce,
            engineVersion: engineBuild.engineVersion,
            interpreterReady: false,
          };
          const body = new TextDecoder('utf-8', { fatal: true }).decode(data.buffer);
          if (body !== JSON.stringify(build)) throw new EngineFailure('RESPONSE_INVALID');
          if (!this.current(operation)) return;
          const report: BuildCheckReport = {
            checkId: operation.id,
            moduleMode: operation.mode,
            nonce: operation.nonce,
            build,
            workerInstanceId: data.workerInstanceId,
            bytes: engineBuild.wasmBytes,
            totalMs: this.now() - operation.start,
            maximumPages: 2048,
          };
          if (!this.current(operation)) return;
          this.state = 'ready';
          this.release(operation);
          operation.resolve(report);
        } catch (error) {
          this.fail(operation, error instanceof EngineFailure ? error.code : 'RESPONSE_INVALID');
        }
      };
      worker.postMessage({
        kind: 'build-check',
        checkId: operation.id,
        nonce: operation.nonce,
        module,
      });
    } catch (error) {
      this.fail(operation, error instanceof EngineFailure ? error.code : 'WORKER_FAILED');
    }
  }
}

export const engineClient = new EngineClient();
