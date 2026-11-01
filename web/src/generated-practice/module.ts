import wasmUrl from '../generated/practice/c_viz_practice_bg.wasm?url';
import { engineBuild } from '../generated/practice/engine-build';
import { ModuleStore, type ModuleDependencies } from '../engine/module';
export const practiceAsset = {
  url: wasmUrl,
  bytes: engineBuild.wasmBytes,
  sha256: engineBuild.wasmSha256,
};
export const practiceModuleStore = new ModuleStore({}, practiceAsset);
export const createPracticeModuleStore = (dependencies: ModuleDependencies) =>
  new ModuleStore(dependencies, practiceAsset);
