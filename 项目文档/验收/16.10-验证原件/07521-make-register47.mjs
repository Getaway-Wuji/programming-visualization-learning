import {readFileSync,writeFileSync} from 'node:fs';
let s=readFileSync('scripts/register-phase2-46.mjs','utf8').replaceAll('46','47');
s=s.replace("previous = 'content/c/p0/blockly-release-1.0.45.json'","previous = 'content/c/p0/blockly-release-1.0.46.json'")
.replace('16.10-1.0.45/index.json','16.10-1.0.46/index.json').replace('product45-before','product46-before')
.replace("supersedes: { version: '1.0.45'","supersedes: { version: '1.0.46'")
.replaceAll('r1610-units-ninth','r1610-units-tenth').replaceAll('r1610-cpp-candidate47-third','r1610-cpp-candidate47-first')
.replaceAll('r1610-build-candidate47-third','r1610-build-candidate47-first')
.replaceAll('r1610-type-tenth','r1610-type-thirteenth').replaceAll('r1610-lint-eighth','r1610-lint-tenth').replaceAll('r1610-format-eighth','r1610-format-tenth')
.replaceAll('r1610-perf-pilot-eleventh','r1610-perf-pilot-thirteenth');
s=s.replace("  pilotOnly: true,","  currentDelta: 'MemoryBugPage durable-pass display recovers after an actual quota retry even if unrelated read/history work has cleared the global lastSaved flag. Requires existing validated durable projection, ready status and no pending operations. No facts, storage rules or execution change.',\n  pilotOnly: true,");
writeFileSync('scripts/register-phase2-47.mjs',s,{flag:'wx'});