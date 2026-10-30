import wasmUrl from '../generated/memory/c_viz_memory_bg.wasm?url';
import { engineBuild } from '../generated/memory/engine-build';
import { ModuleStore, type ModuleDependencies } from './module';

export const memoryAsset = {
  url: wasmUrl,
  bytes: engineBuild.wasmBytes,
  sha256: engineBuild.wasmSha256,
};
export const memoryModuleStore = new ModuleStore({}, memoryAsset);
export function createMemoryModuleStore(dependencies: ModuleDependencies) {
  return new ModuleStore(dependencies, memoryAsset);
}
