import type { Page } from '@playwright/test';

export interface ExceptionWorkerMetadata {
  id: number;
  kind: string;
  operationId: string | null;
  moduleId: number | null;
  createdAt: number;
  postedAt: number | null;
  responseAt: number | null;
  responseBytes: number | null;
  terminatedAt: number | null;
  messagesAfterTermination: number;
}

interface ExceptionAudit {
  workers: ExceptionWorkerMetadata[];
  maximumActive: number;
  compileCalls: number;
  moduleCount: number;
  nextExecute: (() => void) | null;
}

declare global {
  interface Window {
    __performanceExceptionAudit: ExceptionAudit;
  }
}

/** Observe native lifecycle metadata only. No Worker, Module, request, response
 * buffer or parsed trajectory is retained by these observations. */
export async function observeExceptionMetadata(page: Page) {
  await page.addInitScript(() => {
    const modules = new WeakMap<WebAssembly.Module, number>();
    const audit: ExceptionAudit = {
      workers: [],
      maximumActive: 0,
      compileCalls: 0,
      moduleCount: 0,
      nextExecute: null,
    };
    window.__performanceExceptionAudit = audit;
    const compile = WebAssembly.compile.bind(WebAssembly);
    WebAssembly.compile = async (bytes) => {
      audit.compileCalls++;
      return compile(bytes);
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private readonly metadata: ExceptionWorkerMetadata;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const metadata: ExceptionWorkerMetadata = {
          id: audit.workers.length + 1,
          kind: '',
          operationId: null,
          moduleId: null,
          createdAt: performance.now(),
          postedAt: null,
          responseAt: null,
          responseBytes: null,
          terminatedAt: null,
          messagesAfterTermination: 0,
        };
        this.metadata = metadata;
        audit.workers.push(metadata);
        audit.maximumActive = Math.max(
          audit.maximumActive,
          audit.workers.filter((entry) => entry.terminatedAt === null).length,
        );
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          metadata.responseAt = performance.now();
          if (metadata.terminatedAt !== null) metadata.messagesAfterTermination++;
          const data = event.data as Record<string, unknown> | null;
          if (data?.buffer instanceof ArrayBuffer) metadata.responseBytes = data.buffer.byteLength;
        });
      }
      postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        const data = message as Record<string, unknown> | null;
        if (data && typeof data === 'object') {
          this.metadata.kind = typeof data.kind === 'string' ? data.kind : '';
          this.metadata.operationId =
            typeof data.operationId === 'string' ? data.operationId : null;
          this.metadata.postedAt = performance.now();
          if (data.module instanceof WebAssembly.Module) {
            let moduleId = modules.get(data.module);
            if (moduleId === undefined) {
              moduleId = ++audit.moduleCount;
              modules.set(data.module, moduleId);
            }
            this.metadata.moduleId = moduleId;
          }
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
        if (this.metadata.kind === 'execute' && audit.nextExecute) {
          const ready = audit.nextExecute;
          audit.nextExecute = null;
          ready();
        }
      }
      terminate() {
        this.metadata.terminatedAt ??= performance.now();
        super.terminate();
      }
    };
  });
}
