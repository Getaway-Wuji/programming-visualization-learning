import{readFileSync as read,appendFileSync as append}from'node:fs';
const old=read('tests/browser/bucket-sort.spec.ts','utf8');
let part=old.slice(old.indexOf('async function holdReply'),old.indexOf("test('catalog exposes"));
part=part.replaceAll('sortReplyHold','structureReplyHold').replaceAll('sort-error','structure-error').replaceAll('sort-output','structure-output').replaceAll('sort-input','structure-input').replaceAll('sortCases','specs').replaceAll('运行C++案例','运行C++操作').replaceAll('C++排序播放速度','结构播放速度').replaceAll('排序执行观察','数据结构执行观察').replace("fill('4 1')","fill('入 4\\n出')").replace('run(p, [2, 1])',"run(p, '入 2\\n出')").replace('toEqual([2, 1])','toEqual([1, 2, 2])').replace('run(p, [1, -1])',"run(p, '入 1\\n入 -1')").replace('run(p, [3, 1, 2])',"run(p, '入 3\\n入 1\\n出')").replace('sameState(p, result, 2, 3)','sameState(p, result, 2, specs[0])');
append('tests/browser/structures.spec.ts','\n'+part);
