import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:'.artifacts/16.10/clean-workspace',env:{...process.env,VITE_P05_CANDIDATE:'0',VITE_P05_HIDE_CONTENT:'0'},stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
