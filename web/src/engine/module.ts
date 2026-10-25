import wasmUrl from '../generated/c_viz_wasm_bg.wasm?url';
import { engineBuild } from '../generated/engine-build';

export interface ModuleDependencies {
  fetcher?: typeof fetch;
  compile?: typeof WebAssembly.compile;
  digest?: (bytes: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>;
}

// Only immutable compiled code is shared. Instances and running data never are.
export class ModuleStore {
  module: WebAssembly.Module | undefined;
  constructor(private readonly dependencies: ModuleDependencies = {}) {}

  async load(signal: AbortSignal, guard: () => void): Promise<WebAssembly.Module> {
    guard();
    if (this.module) return this.module;
    const fetcher = this.dependencies.fetcher ?? globalThis.fetch;
    const response = await fetcher(wasmUrl, {
      signal,
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    guard();
    if (
      !response.ok ||
      response.redirected ||
      response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/wasm' ||
      !response.body
    )
      throw new Error('E_MODULE_LOAD');
    const reader = response.body.getReader();
    const bytes = new Uint8Array(engineBuild.wasmBytes);
    let offset = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        guard();
        if (done) break;
        if (offset + value.byteLength > bytes.length) throw new Error('E_MODULE_LOAD');
        bytes.set(value, offset);
        offset += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    if (offset !== bytes.length) throw new Error('E_MODULE_LOAD');
    const digest = await (
      this.dependencies.digest ?? ((value) => crypto.subtle.digest('SHA-256', value))
    )(bytes);
    guard();
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    if (hash !== engineBuild.wasmSha256) throw new Error('E_MODULE_LOAD');
    const module = await (this.dependencies.compile ?? WebAssembly.compile)(bytes);
    guard();
    this.module ??= module;
    return this.module;
  }
}

export const sharedModuleStore = new ModuleStore();

let activeCancel: (() => void) | undefined;
export function claimEngineSlot(cancel: () => void): () => void {
  activeCancel?.();
  activeCancel = cancel;
  return () => {
    if (activeCancel === cancel) activeCancel = undefined;
  };
}
