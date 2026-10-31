import fs from 'node:fs';
let s=fs.readFileSync('web/src/algorithms/controller.ts','utf8').replaceAll('SortController','StructureController').replace("import { prepareSort, type SortCase } from './content';","import { prepareStructure, type StructureCase } from './content';").replace('async execute(spec: SortCase, values: readonly number[])','async execute(spec: StructureCase, draft: string)').replace('prepareSort(spec, values)','prepareStructure(spec, draft)');
fs.writeFileSync('web/src/structures/controller.ts',s,{flag:'wx'});
