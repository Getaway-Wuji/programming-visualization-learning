import type { Page } from '@playwright/test';
import type { ObservedWorker, VerticalObservation } from './vertical-observation';

export interface CaseSetWorkerTiming {
  postMessageAt: number | null;
  responseAt: number | null;
  terminatedAt: number | null;
  requestGetterCalls: number;
  responseGetterCalls: number;
  requestFirstArrayAt: number | null;
  responseFirstArrayAt: number | null;
  requestFirstArrayMs: number | null;
  responseFirstArrayMs: number | null;
  requestCopyMs: number | null;
  responseCopyMs: number | null;
}

export interface CaseSetWorkerTechnical {
  wholeWasmCallMs: number;
  rust: number[];
  wasmPages: number;
}

interface EncodedCapture {
  captureEncoded: () => { requestBase64: string | null; responseBase64: string | null };
  timing?: CaseSetWorkerTiming;
  technical?: CaseSetWorkerTechnical | null;
}

/** Snapshot public developer bytes without allocating a boxed byte array in
 * front of production's receive handler. Extraction happens only on demand
 * after the production consumer has settled the real execution. */
export async function observeCaseSetExecution(page: Page) {
  await page.addInitScript(() => {
    const base64 = (buffer: ArrayBuffer | null) => {
      if (!buffer) return null;
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      return btoa(binary);
    };
    const observation: VerticalObservation = { workers: [] };
    window.__verticalObservation = observation;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private readonly record: ObservedWorker & { technical: CaseSetWorkerTechnical | null };
      private requestCopy: ArrayBuffer | null = null;
      private responseCopy: ArrayBuffer | null = null;
      private readonly timing: CaseSetWorkerTiming = {
        postMessageAt: null,
        responseAt: null,
        terminatedAt: null,
        requestGetterCalls: 0,
        responseGetterCalls: 0,
        requestFirstArrayAt: null,
        responseFirstArrayAt: null,
        requestFirstArrayMs: null,
        responseFirstArrayMs: null,
        requestCopyMs: null,
        responseCopyMs: null,
      };

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const requestBytes = () => {
          this.timing.requestGetterCalls++;
          if (!this.requestCopy) return null;
          const first = this.timing.requestFirstArrayAt === null;
          const startedAt = first ? performance.now() : 0;
          if (first) this.timing.requestFirstArrayAt = startedAt;
          const bytes = Array.from(new Uint8Array(this.requestCopy));
          if (first) this.timing.requestFirstArrayMs = performance.now() - startedAt;
          return bytes;
        };
        const responseBytes = () => {
          this.timing.responseGetterCalls++;
          if (!this.responseCopy) return null;
          const first = this.timing.responseFirstArrayAt === null;
          const startedAt = first ? performance.now() : 0;
          if (first) this.timing.responseFirstArrayAt = startedAt;
          const bytes = Array.from(new Uint8Array(this.responseCopy));
          if (first) this.timing.responseFirstArrayMs = performance.now() - startedAt;
          return bytes;
        };
        this.record = {
          id: observation.workers.length + 1,
          url: String(url),
          kind: '',
          operationId: null,
          catalogJson: null,
          // Object-literal getters are enumerable and keep the established
          // number[] capture schema when Playwright later serializes a record.
          get requestBytes() {
            return requestBytes();
          },
          get responseBytes() {
            return responseBytes();
          },
          responseOperationId: null,
          responseOk: null,
          moduleSeen: false,
          terminated: false,
          technical: null,
        };
        // Technical timing only; preserve the established capture interface.
        Object.assign(this.record, { timing: this.timing });
        Object.defineProperty(this.record, 'captureEncoded', {
          enumerable: false,
          value: () => ({
            requestBase64: base64(this.requestCopy),
            responseBase64: base64(this.responseCopy),
          }),
        });
        observation.workers.push(this.record);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          this.timing.responseAt = performance.now();
          const data = event.data as Record<string, unknown>;
          if (!data || typeof data !== 'object') return;
          this.record.responseOperationId =
            typeof data.operationId === 'string' ? data.operationId : null;
          this.record.responseOk = typeof data.ok === 'boolean' ? data.ok : null;
          const technical = data.technical as Partial<CaseSetWorkerTechnical> | undefined;
          if (
            technical &&
            typeof technical.wholeWasmCallMs === 'number' &&
            Number.isFinite(technical.wholeWasmCallMs) &&
            Array.isArray(technical.rust) &&
            technical.rust.length === 27 &&
            technical.rust.every(Number.isFinite) &&
            typeof technical.wasmPages === 'number' &&
            Number.isFinite(technical.wasmPages)
          )
            // The message already owns this tiny numeric observation. Retain
            // its reference; metadata extraction happens after the real run.
            this.record.technical = technical as CaseSetWorkerTechnical;
          if (data.buffer instanceof ArrayBuffer) {
            const startedAt = performance.now();
            this.responseCopy = data.buffer.slice(0);
            this.timing.responseCopyMs = performance.now() - startedAt;
          }
        });
      }

      postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        this.timing.postMessageAt = performance.now();
        const data = message as Record<string, unknown>;
        if (data && typeof data === 'object') {
          this.record.kind = typeof data.kind === 'string' ? data.kind : '';
          this.record.operationId = typeof data.operationId === 'string' ? data.operationId : null;
          this.record.catalogJson = typeof data.catalogJson === 'string' ? data.catalogJson : null;
          this.record.moduleSeen = data.module instanceof WebAssembly.Module;
          // Production transfers the request. Preserve its exact bytes before
          // native detachment; all conversion/serialization happens afterwards.
          if (data.buffer instanceof ArrayBuffer) {
            const startedAt = performance.now();
            this.requestCopy = data.buffer.slice(0);
            this.timing.requestCopyMs = performance.now() - startedAt;
          }
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }

      terminate() {
        this.timing.terminatedAt = performance.now();
        this.record.terminated = true;
        super.terminate();
      }
    };
  });
}

/** Call after the UI has accepted or rejected the real result. Return the same
 * byte-array interface without sending millions of JSON number tokens through
 * browser automation. Explicit metadata access never invokes legacy getters. */
export async function observedCaseSetExecute(page: Page): Promise<
  ObservedWorker & {
    timing?: CaseSetWorkerTiming;
    technical?: CaseSetWorkerTechnical | null;
  }
> {
  const captured = await page.evaluate(() => {
    const worker = window.__verticalObservation.workers.findLast(
      (record) => record.kind === 'execute',
    ) as (ObservedWorker & EncodedCapture) | undefined;
    if (!worker?.captureEncoded) throw new Error('A real case-set execute capture is required.');
    const encoded = worker.captureEncoded();
    return {
      id: worker.id,
      url: worker.url,
      kind: worker.kind,
      operationId: worker.operationId,
      catalogJson: worker.catalogJson,
      responseOperationId: worker.responseOperationId,
      responseOk: worker.responseOk,
      moduleSeen: worker.moduleSeen,
      terminated: worker.terminated,
      timing: worker.timing,
      technical: worker.technical,
      requestBase64: encoded.requestBase64,
      responseBase64: encoded.responseBase64,
    };
  });
  const { requestBase64, responseBase64, ...worker } = captured;
  if (!requestBase64 || !responseBase64 || !worker.catalogJson)
    throw new Error('A real production execute request and response are required.');
  return {
    ...worker,
    requestBytes: Array.from(Buffer.from(requestBase64, 'base64')),
    responseBytes: Array.from(Buffer.from(responseBase64, 'base64')),
  };
}
