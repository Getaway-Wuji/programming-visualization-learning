import wasmUrl from '../generated/advanced/c_viz_advanced_bg.wasm?url';
import { engineBuild } from '../generated/advanced/engine-build';
import { ModuleStore, type ModuleDependencies } from './module';

export const advancedAsset = {
  url: wasmUrl,
  bytes: engineBuild.wasmBytes,
  sha256: engineBuild.wasmSha256,
};
export const advancedModuleStore = new ModuleStore({}, advancedAsset);
export function createAdvancedModuleStore(dependencies: ModuleDependencies) {
  return new ModuleStore(dependencies, advancedAsset);
}
