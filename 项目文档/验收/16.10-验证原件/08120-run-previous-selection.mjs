import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const [prior,label]=process.argv.slice(2);
const r=JSON.parse(readFileSync(`.artifacts/16.10/${prior}.json`));
const args=r.config.argv.slice(r.config.argv.indexOf('--output')+2);
const s=spawnSync(process.execPath,['scripts/phase2-browser.mjs',label,...args],{stdio:'inherit',windowsHide:true,env:process.env});
process.exitCode=s.status??1;