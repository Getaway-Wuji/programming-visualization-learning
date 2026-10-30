import wasmUrl from '../generated/algorithm/c_viz_algorithm_bg.wasm?url';
import { engineBuild } from '../generated/algorithm/engine-build';
import { ModuleStore, type ModuleDependencies } from './module';

export const algorithmAsset = {
  url: wasmUrl,
  bytes: engineBuild.wasmBytes,
  sha256: engineBuild.wasmSha256,
};
export const algorithmModuleStore = new ModuleStore({}, algorithmAsset);
export function createAlgorithmModuleStore(dependencies: ModuleDependencies) {
  return new ModuleStore(dependencies, algorithmAsset);
}
