export const rust2018Protocol: Readonly<{
  version: '1.0.0';
  language: 'rust';
  edition: '2018';
  deadlineMs: 1000;
  requestBytes: 65536;
  resultBytes: 16777216;
  sourceBytes: 32768;
  inputBytes: 256;
  wasmPages: 2048;
  judgeCases: 4;
}>;
export const rust2018NodeKinds: readonly string[];
export const rust2018Events: readonly string[];
export const rust2018DiagnosticCodes: readonly string[];
export const rust2018RequestSchema: Record<string, unknown>;
export const rust2018ResponseSchema: Record<string, unknown>;
