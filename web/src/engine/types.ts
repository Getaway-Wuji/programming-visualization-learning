export type EngineState = 'idle' | 'loading' | 'ready' | 'cancelled' | 'failed' | 'timed-out';

export type EngineFailureCode =
  | 'MODULE_LOAD_FAILED'
  | 'MODULE_INVALID'
  | 'WORKER_FAILED'
  | 'RESPONSE_INVALID'
  | 'CHECK_CANCELLED'
  | 'CHECK_TIMEOUT';

export class EngineFailure extends Error {
  constructor(public readonly code: EngineFailureCode) {
    super(code);
    this.name = 'EngineFailure';
  }
}

export interface BuildCheckReport {
  checkId: string;
  moduleMode: 'cold' | 'warm';
  nonce: number;
  build: {
    kind: 'build-probe';
    probeVersion: '1.0.0';
    nonce: number;
    engineVersion: '0.1.0';
    interpreterReady: false;
  };
  workerInstanceId: string;
  bytes: number;
  totalMs: number;
  maximumPages: 2048;
}

export interface ProbeRequest {
  kind: 'build-check';
  checkId: string;
  nonce: number;
  module: WebAssembly.Module;
}
