import type { Page } from '@playwright/test';

export interface ObservedWorker {
  id: number;
  url: string;
  kind: string;
  operationId: string | null;
  catalogJson: string | null;
  requestBytes: number[] | null;
  responseBytes: number[] | null;
  responseOperationId: string | null;
  responseOk: boolean | null;
  moduleSeen: boolean;
  terminated: boolean;
}
export interface VerticalObservation {
  workers: ObservedWorker[];
}
declare global {
  interface Window {
    __verticalObservation: VerticalObservation;
  }
}

/** Copies public developer evidence without delaying, mutating or replacing any message. */
export async function observeVerticalExecution(page: Page) {
  await page.addInitScript(() => {
    const observation: VerticalObservation = { workers: [] };
    window.__verticalObservation = observation;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private readonly record: ObservedWorker;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.record = {
          id: observation.workers.length + 1,
          url: String(url),
          kind: '',
          operationId: null,
          catalogJson: null,
          requestBytes: null,
          responseBytes: null,
          responseOperationId: null,
          responseOk: null,
          moduleSeen: false,
          terminated: false,
        };
        observation.workers.push(this.record);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          const data = event.data as Record<string, unknown>;
          if (!data || typeof data !== 'object') return;
          this.record.responseOperationId =
            typeof data.operationId === 'string' ? data.operationId : null;
          this.record.responseOk = typeof data.ok === 'boolean' ? data.ok : null;
          if (data.buffer instanceof ArrayBuffer)
            this.record.responseBytes = Array.from(new Uint8Array(data.buffer));
        });
      }
      postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        const data = message as Record<string, unknown>;
        if (data && typeof data === 'object') {
          this.record.kind = typeof data.kind === 'string' ? data.kind : '';
          this.record.operationId = typeof data.operationId === 'string' ? data.operationId : null;
          this.record.catalogJson = typeof data.catalogJson === 'string' ? data.catalogJson : null;
          this.record.moduleSeen = data.module instanceof WebAssembly.Module;
          // The real production call transfers this buffer; copy before native detachment.
          if (data.buffer instanceof ArrayBuffer)
            this.record.requestBytes = Array.from(new Uint8Array(data.buffer));
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
      terminate() {
        this.record.terminated = true;
        super.terminate();
      }
    };
  });
}

export async function observedExecute(page: Page): Promise<ObservedWorker> {
  const worker = await page.evaluate(() =>
    window.__verticalObservation.workers.findLast((worker) => worker.kind === 'execute'),
  );
  if (!worker?.requestBytes || !worker.responseBytes || !worker.catalogJson)
    throw new Error('A real production execute request and response are required.');
  return worker;
}
