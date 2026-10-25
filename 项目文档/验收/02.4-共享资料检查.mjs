import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Document evidence only: no C parser/execution, IndexedDB or browser tests.
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../契约');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (ok, code = 'FIXTURE_INVALID') => { if (!ok) fail(code); };
const clone = structuredClone;
const equal = (a, b) => { try { assert.deepEqual(a, b); return true; } catch { return false; } };
const keys = (value, allowed) => check(value && equal(Object.keys(value).sort(), allowed.slice().sort()));
const unique = list => check(new Set(list).size === list.length);
function validUnicode(s) {
  for (let i = 0; i < s.length; i++) {
    const n = s.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) { const next = s.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (n >= 0xdc00 && n <= 0xdfff) return false;
  }
  return true;
}
function strictJson(text) {
  let at = 0;
  const space = () => { while (at < text.length && /[ \t\r\n]/.test(text[at])) at++; };
  function string() {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '"') { let value; try { value = JSON.parse(text.slice(start, at)); } catch { fail('CONTENT_JSON_INVALID'); } check(validUnicode(value), 'CONTENT_JSON_INVALID'); return value; }
      if (c === '\\') at++;
      else check(c.charCodeAt(0) >= 32, 'CONTENT_JSON_INVALID');
    }
    fail('CONTENT_JSON_INVALID');
  }
  function value(depth = 0) {
    check(depth < 128, 'CONTENT_JSON_INVALID'); space();
    if (text[at] === '"') return string();
    if (text[at] === '{' || text[at] === '[') {
      const object = text[at++] === '{', end = object ? '}' : ']', seen = new Set(); space();
      if (text[at] === end) { at++; return; }
      while (at < text.length) {
        space();
        if (object) { check(text[at] === '"', 'CONTENT_JSON_INVALID'); const name = string(); check(!seen.has(name), 'CONTENT_JSON_DUPLICATE_KEY'); seen.add(name); space(); check(text[at++] === ':', 'CONTENT_JSON_INVALID'); }
        value(depth + 1); space(); if (text[at] === end) { at++; return; } check(text[at++] === ',', 'CONTENT_JSON_INVALID');
      }
      fail('CONTENT_JSON_INVALID');
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at));
    check(token, 'CONTENT_JSON_INVALID'); at += token[0].length;
  }
  value(); space(); check(at === text.length, 'CONTENT_JSON_INVALID');
  try { return JSON.parse(text); } catch { fail('CONTENT_JSON_INVALID'); }
}
function read(name) { const bytes = fs.readFileSync(path.join(dir, name)); return strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
const registry = read('02.4-共享样例索引.json');
const semantics = read('02.4-语义与输入样例.json');
const budget = read('02.4-预算边界样例.json');
const changes = read('02.4-变更登记样例.json');
const content = read('02.1-内容样例.json');
const badContent = read('02.1-非法配置样例.json');
const tasks = new Set([...fs.readFileSync(path.join(dir, '../任务进度与交接.md'), 'utf8').matchAll(/^\| (\d{2}\.\d+) \|/gm)].map(m => m[1]));
const pointers = (root, pointer) => {
  if (pointer === '') return root;
  check(pointer.startsWith('/'));
  return pointer.slice(1).split('/').reduce((value, raw) => { const k = raw.replace(/~1/g, '/').replace(/~0/g, '~'); check(value !== null && value !== undefined && Object.hasOwn(value, k)); return value[k]; }, root);
};
function inputValid(spec, input) {
  if (!input || !equal(Object.keys(input).sort(), spec.fields.map(f => f.key).sort())) return false;
  for (const f of spec.fields) {
    const value = input[f.key], within = n => Number.isInteger(n) && n >= f.min && n <= f.max;
    if (f.kind === 'integer' ? !within(value) : !Array.isArray(value) || value.length < f.minItems || value.length > f.maxItems || !value.every(within)) return false;
  }
  for (const r of spec.relations) {
    if (r.kind === 'index-in' && !(input[r.field] >= 0 && input[r.field] < input[r.target].length)) return false;
    if (r.kind === 'nondecreasing' && input[r.field].some((n, i, a) => i > 0 && n < a[i - 1])) return false;
  }
  return true;
}
const collectionNames = ['languages','subsets','chapters','lessons','knowledgePoints','inputSpecs','programs','judgeProfiles','exercises','cases','blocks','rewardSources'];
const expectedConnections = ['program','int-expression','statement','int-expression','statement','int-expression','int-expression','int-expression','int-expression','statement','statement','statement','statement','statement','statement','int-expression','statement','statement','statement','statement'];
function contentCheck(c) {
  check(c.contractVersion === '1.0.0', 'CONTENT_CONTRACT_UNSUPPORTED');
  const rows = collectionNames.flatMap(name => c[name]);
  for (const r of rows) check(/^[a-z][a-z0-9]*(\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/.test(r.id), 'CONTENT_ID_INVALID');
  check(new Set(rows.map(r => r.id)).size === rows.length, 'CONTENT_ID_DUPLICATE');
  const by = new Map(rows.map(r => [r.id, r]));
  for (const l of c.lessons) {
    check(l.requiredExerciseRefs.length > 0, 'CONTENT_REQUIRED_EMPTY');
    check(!Object.hasOwn(l, 'autoComplete'), 'CONTENT_SCHEMA_INVALID');
    for (const list of [l.requiredExerciseRefs,l.optionalExerciseRefs,l.caseRefs,l.blockRefs]) check(new Set(list.map(r => `${r.id}@${r.version}`)).size === list.length, 'CONTENT_LIST_DUPLICATE');
  }
  let refs = 0;
  function visit(v, field = '') {
    if (!v || typeof v !== 'object') return;
    if (!Array.isArray(v) && Object.keys(v).length === 2 && 'id' in v && 'version' in v) {
      refs++; const target = by.get(v.id); check(target, 'CONTENT_REF_MISSING');
      const expected = { languageRef: 'lang.', subsetRef: 'subset.', chapterRef: 'chapter.', lessonRef: 'lesson.', lessonRefs: 'lesson.', requiredExerciseRefs: 'exercise.', optionalExerciseRefs: 'exercise.', caseRefs: 'case.', relatedLessonRefs: 'lesson.', blockRefs: 'block.', knowledgeRefs: 'knowledge.', prerequisiteRefs: 'knowledge.', programRef: 'program.', exampleProgramRefs: 'program.', inputRef: 'input.', judgeRef: 'judge.', rewardRef: 'reward.' }[field];
      if (expected) check(v.id.startsWith(expected), 'CONTENT_REF_TYPE');
      check(target.version === v.version, 'CONTENT_REF_VERSION'); return;
    }
    if (Array.isArray(v)) v.forEach(x => visit(x, field)); else for (const [k,x] of Object.entries(v)) visit(x, k);
  }
  visit(c);
  for (const p of c.programs) check(by.get(p.languageRef.id).execution !== 'reserved', 'CONTENT_LANGUAGE_RESERVED');
  for (const e of c.exercises) check(c.lessons.some(l => l.id === e.lessonRef.id && [...l.requiredExerciseRefs,...l.optionalExerciseRefs].some(r => r.id === e.id)), 'CONTENT_RELATION_INVALID');
  const active = new Set(), seen = new Set();
  function dfs(id) { check(!active.has(id), 'CONTENT_PREREQUISITE_CYCLE'); if (seen.has(id)) return; active.add(id); for (const r of by.get(id).prerequisiteRefs) dfs(r.id); active.delete(id); seen.add(id); }
  c.knowledgePoints.forEach(k => dfs(k.id));
  for (const r of [...c.lessons,...c.exercises,...c.cases]) check(!r.acceptedPriorVersions.includes(r.version), 'CONTENT_LEARNING_COMPATIBILITY_INVALID');
  for (const p of c.programs) {
    check(inputValid(by.get(p.inputRef.id), p.exampleInput), 'CONTENT_INPUT_INVALID');
    check(equal(p.bindings, content.programs.find(x => x.id === p.id).bindings), 'CONTENT_BINDING_INVALID');
  }
  for (const e of c.exercises) for (const t of e.tests) check(inputValid(by.get(by.get(e.programRef.id).inputRef.id), t.input), 'CONTENT_INPUT_INVALID');
  for (const l of c.lessons) for (const r of [...l.requiredExerciseRefs,...l.optionalExerciseRefs]) {
    const program = by.get(by.get(r.id).programRef.id); check(program.blockRefs.every(b => l.blockRefs.some(x => x.id === b.id && x.version === b.version)), 'CONTENT_BLOCK_MAPPING_INVALID');
  }
  c.blocks.forEach((b,i) => check(b.connectionType === expectedConnections[i], 'CONTENT_BLOCK_MAPPING_INVALID'));
  for (const e of c.exercises) {
    const base = content.exercises.find(x => x.id === e.id);
    check(equal(e.judgeRef, base.judgeRef) && equal(e.tests.map(t => t.caseKey), base.tests.map(t => t.caseKey)), 'CONTENT_JUDGE_INVALID');
    check(by.get(e.rewardRef.id).eventType === 'exercise.passed', 'CONTENT_REWARD_INVALID');
  }
  for (const cse of c.cases) check(cse.resultRule === content.cases.find(x => x.id === cse.id).resultRule, 'CONTENT_CASE_INVALID');
  check(rows.length === 82 && c.exercises.reduce((n,x) => n+x.tests.length,0) === 24, 'CONTENT_P0_COVERAGE');
  return { entities: rows.length, refs };
}
const contentCounts = contentCheck(content); assert.equal(contentCounts.refs, 405);
function mutate(base, operations) {
  const value = clone(base);
  for (const op of operations) {
    if (op.op === 'append') pointers(value, op.path).push(clone(op.value));
    else { const bits = op.path.split('/'); const last = bits.pop(), parent = pointers(value, bits.join('/')); if (op.op === 'remove') Array.isArray(parent) ? parent.splice(Number(last),1) : delete parent[last]; else parent[last] = clone(op.value); }
  }
  return value;
}
for (const v of badContent.scenarios) assert.throws(() => contentCheck(mutate(content,v.operations)), error => error.code === v.expectedCode, v.id);
for (const v of badContent.rawJsonScenarios) assert.throws(() => strictJson(v.rawJson), error => error.code === v.expectedCode, v.id);

keys(registry, ['fixtureContractVersion','purpose','evidenceLevel','contracts','decisions','resources','entries','futureEvidence']);
check(registry.fixtureContractVersion === '1.0.0' && registry.purpose === 'contract-fixture' && registry.evidenceLevel === 'document-model');
unique(registry.resources.map(r => r.id)); unique(registry.contracts.map(c => c.id)); unique(registry.entries.map(e => e.id));
const resources = new Map();
for (const r of registry.resources) {
  keys(r,['id','path','sha256']);
  const file = path.resolve(dir,r.path); check(file.startsWith(path.resolve(dir,'..')+path.sep), 'FIXTURE_PATH_INVALID');
  const bytes = fs.readFileSync(file); if (r.sha256 !== null) check(crypto.createHash('sha256').update(bytes).digest('hex') === r.sha256, 'FIXTURE_BASELINE_DRIFT');
  resources.set(r.id, { file, value: file.endsWith('.json') ? strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) : null });
}
for (const c of registry.contracts) { keys(c,['id','version','documentResource','schemaResource','ownerRole']); check(c.version === '1.0.0' && resources.has(c.documentResource) && (c.schemaResource === null || resources.has(c.schemaResource))); }
for (const d of registry.decisions) { keys(d,['id','version','documentResource']); check(d.version === 'V1.0' && resources.has(d.documentResource)); }
for (const e of registry.entries) {
  keys(e,['id','group','sourceId','resourceId','pointer','contracts','consumers','ownerTasks','evidenceLevel']);
  check(/^[a-z0-9.-]+$/.test(e.id)); check(resources.has(e.resourceId)); pointers(resources.get(e.resourceId).value,e.pointer);
  check(e.contracts.every(id => registry.contracts.some(c => c.id === id)));
  check(e.consumers.length > 0 && e.consumers.every(x => ['rust','frontend','storage'].includes(x)));
  check(e.ownerTasks.length > 0 && e.ownerTasks.every(id => tasks.has(id)));
  check(['declared-expectation','synthetic-protocol','finite-model','policy-and-recipe'].includes(e.evidenceLevel));
  if (e.group.startsWith('save')) check(!e.consumers.includes('rust'), 'SAVE_MUST_NOT_ENTER_RUST');
}
const expectedPointers = [];
for (const [file, collectionList] of Object.entries(registry.futureEvidence.indexedCollections)) for (const name of collectionList) {
  const resource = resources.get(file); check(resource);
  const collection = pointers(resource.value, `/${name}`); check(Array.isArray(collection));
  collection.forEach((_,i) => expectedPointers.push(`${file}:/${name}/${i}`));
}
for (const token of expectedPointers) check(registry.entries.some(e => `${e.resourceId}:${e.pointer}` === token), 'FIXTURE_INDEX_GAP');
const indexedPairs = registry.entries.map(e => `${e.resourceId}:${e.pointer}`); unique(indexedPairs);
for (let i=0;i<content.exercises.length;i++) for(let j=0;j<content.exercises[i].tests.length;j++) check(indexedPairs.includes(`data.content:/exercises/${i}/tests/${j}`));

keys(semantics,['fixtureContractVersion','purpose','evidenceLevel','limitations','cases']);
check(semantics.fixtureContractVersion === '1.0.0' && semantics.purpose === 'contract-fixture' && semantics.evidenceLevel === 'declared-expectation');
const origins = new Set(semantics.cases.map(c => c.origin));
for (const [prefix,count] of [['REF',10],['POS',22],['NEG',46],['SORT',8],['SEARCH',10],['INPUT',7],['WRONG',3]]) for(let i=1;i<=count;i++) check(origins.has(`${prefix}-${String(i).padStart(2,'0')}`), 'SEMANTIC_ORIGIN_MISSING');
assert.equal(origins.size,106); unique(semantics.cases.map(c => c.id));
for (const c of semantics.cases) {
  keys(c,['id','origin','category','topics','source','programRef','subjectRef','input','setup','expected','ownerTasks']);
  keys(c.expected,['terminalStatus','allowedStages','allowedCodes','stdout','exitCode','judgeStatus','note']);
  check(c.ownerTasks.length > 0 && c.ownerTasks.every(t => tasks.has(t)) && c.topics.length > 0 && c.expected.note.length > 0);
  check(['reference','positive','negative','sort','search','input','wrong-answer'].includes(c.category));
  check(c.setup === null || ['binding-deleted','binding-renamed','binding-duplicate','binding-n-mismatch'].includes(c.setup));
  check(c.expected.allowedStages.every(stage => ['preflight','load','lex','parse','semantic','execute','encode','receive','judge'].includes(stage)));
  check(c.source === null ? c.category === 'input' : typeof c.source === 'string' && Buffer.byteLength(c.source,'utf8') <= 32768);
  for(const r of [c.programRef,c.subjectRef]) if(r!==null) check(collectionNames.flatMap(n=>content[n]).some(x=>x.id===r.id&&x.version===r.version));
  check(c.expected.allowedCodes.every(code=>/^(E_|J_|CONTENT_)/.test(code)));
  check(['completed','program-error','rejected'].includes(c.expected.terminalStatus));
  if (c.category === 'wrong-answer') check(c.expected.terminalStatus === 'completed' && c.expected.judgeStatus === 'unmet');
  if (c.expected.terminalStatus === 'completed') check(typeof c.expected.stdout === 'string' && Number.isInteger(c.expected.exitCode));
  if (c.category === 'input' && c.setup === null) {
    const p=content.programs.find(p=>p.id===c.programRef.id), spec=content.inputSpecs.find(s=>s.id===p.inputRef.id);
    check(!inputValid(spec,c.input), 'INVALID_INPUT_WAS_ACCEPTED_BY_MODEL');
  }
}
for(let i=0;i<10;i++){const r=semantics.cases.find(c=>c.origin===`REF-${String(i+1).padStart(2,'0')}`);assert.equal(r.source,content.programs[i].sourceExample);}
const newlineVariants=semantics.cases.filter(c=>c.origin==='POS-22'); check(newlineVariants.some(c=>c.source.includes('\r\n'))&&newlineVariants.some(c=>!c.source.includes('\r')));

keys(budget,['fixtureContractVersion','purpose','evidenceLevel','limitations','boundaries','futureBoundaries','recipes']);
check(budget.fixtureContractVersion==='1.0.0' && budget.purpose==='contract-fixture' && budget.evidenceLevel==='policy-and-recipe');
unique(budget.boundaries.map(b=>b.id)); unique(budget.recipes.map(r=>r.id));
for(const r of budget.recipes){keys(r,['id','description','parameters','source']);check(r.description.length>0 && (r.source===null||typeof r.source==='string') && r.parameters && typeof r.parameters==='object'&&!Array.isArray(r.parameters));}
const coveredBudgets=new Set(budget.boundaries.flatMap(b=>b.budgetIds)); for(let i=1;i<=17;i++)check(coveredBudgets.has(`RB-${String(i).padStart(2,'0')}`));
for(const b of [...budget.boundaries,...budget.futureBoundaries]){
  const fields=['id','budgetIds','dimension','unit','limit','at','over','rule','errorCode','recipe','ownerTasks'];
  if(budget.futureBoundaries.includes(b)){fields.push('phase');check(b.phase==='P1');}
  keys(b,fields);
  check(budget.recipes.some(r=>r.id===b.recipe)&&b.ownerTasks.every(t=>tasks.has(t)));
  assert.equal(b.at,b.limit);
  if(b.rule==='minimum-inclusive') assert.equal(b.over,b.limit-1);
  else if(b.id==='boundary.live-bytes-reachable') assert.equal(b.over,b.limit+4);
  else assert.equal(BigInt(b.over),BigInt(b.limit)+1n);
  const admits=n=>b.rule==='strict-deadline'?n<b.limit:b.rule==='minimum-inclusive'?n>=b.limit:n<=b.limit;
  assert.equal(admits(b.at),b.rule!=='strict-deadline'); assert.equal(admits(b.over),false);
}
const sourceAt='int main(void){return 0;}/*'+'.'.repeat(32768-Buffer.byteLength('int main(void){return 0;}/**/'))+'*/';
assert.equal(Buffer.byteLength(sourceAt),32768); assert.equal(Buffer.byteLength(sourceAt.replace('*/','.*/')),32769);
const sourceMulti=sourceAt.replace('...','中'); assert.equal(Buffer.byteLength(sourceMulti),32768);
const stepAt=`int main(void){${';'.repeat(19998)}return 0;}`, stepOver=`int main(void){${';'.repeat(19999)}return 0;}`;
assert.equal((stepAt.match(/;/g)||[]).length+1,20000); assert.equal((stepOver.match(/;/g)||[]).length+1,20001);
check(Buffer.byteLength(stepOver)<32768);
const outputAt='#include <stdio.h>\nint main(void){printf("'+ 'x'.repeat(16384)+'");return 0;}';
check(Buffer.byteLength(outputAt)<32768); assert.equal('x'.repeat(16384).length,16384); assert.equal('x'.repeat(16385).length,16385);
const syntaxAt=`int main(void){${'{'.repeat(63)}${'}'.repeat(63)}return 0;}`; assert.equal((syntaxAt.match(/{/g)||[]).length,64);

keys(changes,['changeContractVersion','purpose','limitations','impactRules','registrations','proposals','compatibilityCases','learningBridgeCases']);
check(changes.changeContractVersion==='1.0.0'&&changes.purpose==='contract-fixture');
for(const r of changes.impactRules){keys(r,['group','ownerRoles','tasks']);check(r.tasks.every(t=>tasks.has(t)));unique(r.tasks);unique(r.ownerRoles);}
const groupRequirements={'CONTENT-01':['content'],'LEARN-EVENT-01':['learning-save'],'EXEC-01':['execution'],'STEP-01':['execution','learning-save'],'DIAG-01':['execution'],'JUDGE-OBS-01':['judge','content','execution','learning-save'],'JSON-INT-01':['execution'],'SAVE-01':['learning-save'],'SAVE-TX-01':['learning-save'],'SAVE-MIGRATE-01':['learning-save','content'],'BUDGET-P0':['budget-semantics']};
function proposalCheck(p){
  keys(p,['id','status','purpose','fromVersion','toVersion','compatibility','changedFields','impactGroups','fixtureIds','learningEffect','migrationPlan','rollbackPlan','requiredEvidence','approvals','actualEvidence','affectedTasks','requiredOwnerRoles']);
  check(p.status==='proposed'&&p.purpose==='proposal-fixture'&&p.actualEvidence.length===0&&p.approvals.length===0);
  check(p.compatibility==='breaking'&&p.fromVersion==='1.0.0'&&p.toVersion==='2.0.0');
  const rules=p.impactGroups.map(g=>changes.impactRules.find(r=>r.group===g));check(rules.every(Boolean));
  const neededTasks=[...new Set(rules.flatMap(r=>r.tasks))], neededOwners=[...new Set(rules.flatMap(r=>r.ownerRoles))];
  check(equal(neededTasks.slice().sort(),p.affectedTasks.slice().sort())&&equal(neededOwners.slice().sort(),p.requiredOwnerRoles.slice().sort()),'CHANGE_IMPACT_GAP');
  for(const f of p.changedFields){keys(f,['contractId','path']);check(groupRequirements[f.contractId]?.every(g=>p.impactGroups.includes(g)),'CHANGE_IMPACT_GAP');check(f.contractId==='BUDGET-P0'?/^RB-\d{2}$/.test(f.path):f.path.startsWith('/'));}
  check(p.fixtureIds.every(id=>registry.entries.some(e=>e.id===id)),'CHANGE_FIXTURE_MISSING');
  check(p.learningEffect.length>0&&p.migrationPlan.length>0&&p.rollbackPlan.length>0&&p.requiredEvidence.includes('document-model'));
}
changes.proposals.forEach(proposalCheck);
const gap=clone(changes.proposals[0]);gap.affectedTasks.pop();assert.throws(()=>proposalCheck(gap),e=>e.code==='CHANGE_IMPACT_GAP');
const ownerGap=clone(changes.proposals[0]);ownerGap.requiredOwnerRoles.pop();assert.throws(()=>proposalCheck(ownerGap),e=>e.code==='CHANGE_IMPACT_GAP');
const contentOnly=clone(changes.proposals[0]);contentOnly.changedFields=[{contractId:'CONTENT-01',path:'/blocks'}];contentOnly.impactGroups=['content'];
const contentRule=changes.impactRules.find(r=>r.group==='content');contentOnly.affectedTasks=clone(contentRule.tasks);contentOnly.requiredOwnerRoles=clone(contentRule.ownerRoles);proposalCheck(contentOnly);
for(const task of ['06.2','07.1','10.1']){const bad=clone(contentOnly);bad.affectedTasks=bad.affectedTasks.filter(t=>t!==task);assert.throws(()=>proposalCheck(bad),e=>e.code==='CHANGE_IMPACT_GAP');}
for(const r of changes.registrations){keys(r,['id','status','taskId','contracts','version','runtimeEvidence']);check(tasks.has(r.taskId)&&r.status==='accepted-document'&&r.runtimeEvidence===false&&r.version==='1.0.0');}
for(const c of changes.compatibilityCases){
  keys(c,['id','kind','current','candidate','expected','code']);
  const accepts=c.kind==='exact-version'?c.current===c.candidate:c.kind==='known-kind'?c.current===c.candidate:c.kind==='producer'?c.candidate==='rust':Number.isSafeInteger(c.candidate);
  assert.equal(accepts,c.expected==='accept',c.id);
}
for(const c of changes.learningBridgeCases){
  keys(c,c.kind==='exercise'?['id','kind','exerciseId','allTests','current','normalZero','checksMet','targetsMet','expectedEvent']:['id','kind','normalZero','current','allStepsSeen','confirmed','mode','resultsMatch','expectedEvent']);
  const event=c.kind==='exercise'?(c.allTests&&c.current&&c.normalZero&&c.checksMet&&c.targetsMet?'exercise.passed':null):(c.normalZero&&c.current&&c.allStepsSeen&&c.confirmed&&c.resultsMatch&&c.mode==='case'?'case.view-confirmed':null);
  if(c.exerciseId)check(content.exercises.some(e=>e.id===c.exerciseId));
  assert.equal(event,c.expectedEvent,c.id);
}
const childReports={};
for(const filename of ['02.2-契约夹具检查.mjs','02.3-契约模型检查.mjs']){
  const out=spawnSync(process.execPath,[path.join(dir,'../验收',filename)],{encoding:'utf8',maxBuffer:1024*1024});
  check(!out.error&&out.status===0,`BASELINE_CHECK_FAILED:${filename}`);childReports[filename]=JSON.parse(out.stdout);
}
console.log(JSON.stringify({ registryEntries:registry.entries.length, resources:registry.resources.length, contractVersions:registry.contracts.length, content:contentCounts, publicExerciseTests:24, invalidContent:badContent.scenarios.length, rawContent:badContent.rawJsonScenarios.length, semanticCases:semantics.cases.length, semanticOrigins:origins.size, budgetBoundaries:budget.boundaries.length, futureBudgetBoundaries:budget.futureBoundaries.length, allBudgets:coveredBudgets.size, recipes:budget.recipes.length, compatibilityCases:changes.compatibilityCases.length, learningGuards:changes.learningBridgeCases.length, changeProposals:changes.proposals.length, changeGapNegatives:5, generatedRecipeChecks:4, priorReports:childReports, limitation:'Document registry, declared expectations, numeric recipes and finite synthetic models only. No Rust/browser/IDB/performance proof.' },null,2));
