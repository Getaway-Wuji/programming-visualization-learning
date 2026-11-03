import wasmUrl from '../generated/c6-teaching/c_viz_c6_bg.wasm?url';
import { engineBuild } from '../generated/c6-teaching/engine-build';
import { ModuleStore, type ModuleDependencies } from './module';

export const c6Asset = {
  url: wasmUrl,
  bytes: engineBuild.wasmBytes,
  sha256: engineBuild.wasmSha256,
};
export const c6ModuleStore = new ModuleStore({}, c6Asset);
export function createC6ModuleStore(dependencies: ModuleDependencies) {
  return new ModuleStore(dependencies, c6Asset);
}
