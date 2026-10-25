export interface BuildProbe {
  kind: 'build-probe';
  probeVersion: '1.0.0';
  nonce: number;
  engineVersion: '0.1.0';
  interpreterReady: false;
}

export interface ProbeRequest {
  nonce: number;
  warm?: boolean;
  missing?: boolean;
}

export interface ProbeWorkerRequest {
  nonce: number;
  module: WebAssembly.Module;
}

export interface ProbeMemory {
  currentPages: number;
  maximumPages: 2048;
  growBeyondMaximumRejected: true;
}

export interface WorkerSuccess {
  ok: true;
  buffer: ArrayBuffer;
  workerInstanceId: string;
  memory: ProbeMemory;
  timings: {
    initMs: number;
    rustProbeMs: number;
    encodeMs: number;
  };
}

export interface WorkerFailure {
  ok: false;
  error: string;
}

export type ProbeWorkerResponse = WorkerSuccess | WorkerFailure;

export interface ProbeResult {
  probe: BuildProbe;
  moduleMode: 'cold' | 'warm';
  workerId: number;
  workerInstanceId: string;
  terminated: true;
  bufferBytes: number;
  timings: {
    fetchMs: number;
    compileMs: number;
    modulePrepareMs: number;
    workerMs: number;
    initMs: number;
    rustProbeMs: number;
    encodeMs: number;
    transferDecodeMs: number;
    totalMs: number;
  };
  memory: ProbeMemory;
  imports: WebAssembly.ModuleImportDescriptor[];
  exports: WebAssembly.ModuleExportDescriptor[];
  wasmUrl: string;
  mimeType: string;
}

declare global {
  interface Window {
    runBuildProbe: (request: ProbeRequest) => Promise<ProbeResult>;
  }
}
