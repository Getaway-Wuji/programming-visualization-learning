export function inspectWasm(buffer: Uint8Array | ArrayBuffer): {
  memories: { minimum: number; maximum: number | null; shared: boolean }[];
  features: string[];
  imports: WebAssembly.ModuleImportDescriptor[];
  exports: WebAssembly.ModuleExportDescriptor[];
};
