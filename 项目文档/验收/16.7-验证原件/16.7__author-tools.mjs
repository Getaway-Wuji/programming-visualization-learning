import {readFileSync as read,writeFileSync as write}from'node:fs';
let p='scripts/build-p05-course.mjs',s=read(p,'utf8');
s=s.replace("import { validateBucketSort } from './bucket-sort-content.mjs';","import { validateBucketSort } from './bucket-sort-content.mjs';\nimport { structuresPaths } from './structures-release-inputs.mjs';\nimport { validateStructures } from './structures-content.mjs';");
s=s.replace("const releaseVersion = existsSync('content/c/p0/blockly-release-1.0.41.json')","validateStructures();\nconst releaseVersion = existsSync('content/c/p0/blockly-release-1.0.42.json') ? '1.0.42' : existsSync('content/c/p0/blockly-release-1.0.41.json')");
s=s.replace("releaseVersion === '1.0.41'\n      ? bucketSortPaths","releaseVersion === '1.0.42' ? structuresPaths : releaseVersion === '1.0.41'\n      ? bucketSortPaths");
s=s.replace("      '1.0.41',","      '1.0.41',\n      '1.0.42',");s=s.replace("['1.0.39', '1.0.40', '1.0.41']","['1.0.39', '1.0.40', '1.0.41', '1.0.42']");write(p,s);
p='scripts/restore-release-evidence.mjs';s=read(p,'utf8').replace("  '1.0.41',","  '1.0.41',\n  '1.0.42',").replace("release === '1.0.41'","release === '1.0.42' ? '16.7' : release === '1.0.41'");write(p,s);
write('scripts/structures-browser.mjs',read('scripts/bucket-sort-browser.mjs','utf8').replaceAll('r166-','r167-').replaceAll('16.6','16.7'),{flag:'wx'});
write('.artifacts/16.7/visual.mjs',read('.artifacts/16.6/visual.mjs','utf8').replaceAll('16.6','16.7').replaceAll('inspect-bucket','inspect-structures').replace('algorithms/case.cpp.bucket-sort','structures/case.cpp.array-stack'),{flag:'wx'});
let inspector=read('.artifacts/16.6/inspect-bucket.mjs','utf8');
const a=inspector.indexOf('async function prepare'),b=inspector.indexOf('//',a);
// Replace only observed DOM setup; keep the original Inspector probes/rules intact.
inspector=inspector.replaceAll('运行C++案例','运行C++操作').replaceAll('sort-workspace','structure-workspace').replaceAll('C++排序执行步骤','结构执行步骤').replaceAll('sort-input','structure-input');
write('.artifacts/16.7/inspect-structures.mjs',inspector,{flag:'wx'});
console.log({buildAdapted:true,sourceCount:(await import('../../scripts/structures-release-inputs.mjs')).structuresPaths.length,inspectorSetupStart:a,unusedBoundary:b});
