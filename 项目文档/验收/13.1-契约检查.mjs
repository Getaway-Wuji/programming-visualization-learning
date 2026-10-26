/** Offline design/schema checks. This is not a reverse converter or a C parser. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.argv[2] ?? '.artifacts/13.1/contract-check.json';
const contractDir = '项目文档/契约/';
const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8').replace(/^\uFEFF/, ''));
const hash = (path) =>
  createHash('sha256')
    .update(readFileSync(resolve(root, path)))
    .digest('hex');
const schema = json(`${contractDir}13.1-双向编辑.schema.json`);
const oldSchema = json(`${contractDir}02.2-执行与轨迹.schema.json`);
const fixtures = json(`${contractDir}13.1-结构与状态样例.json`);
const sources = json(`${contractDir}13.1-源码样例.json`);
const change = json(`${contractDir}13.1-变更登记.json`);
const shapeRequests = new Map();
const shapeKey = (target, body) => `${target}:${JSON.stringify(body)}`;
const requestShape = (target, body) =>
  shapeRequests.set(shapeKey(target, body), { key: shapeKey(target, body), target, body });
for (const item of fixtures.schemaCases) requestShape(item.target, item.body);
for (const item of fixtures.stateCases) {
  requestShape('editDocument', item.document);
  if (item.document.lastSynced) {
    requestShape('projection', item.document.lastSynced);
    requestShape('blockProgram', item.document.lastSynced.program);
  }
}
for (const item of fixtures.relationCases) {
  const target =
    item.kind === 'program'
      ? 'blockProgram'
      : item.kind === 'projection'
        ? 'projection'
        : 'validResult';
  requestShape(target, item.body);
  if (item.kind === 'projection') requestShape('blockProgram', item.body.program);
}
requestShape('oldExecution', fixtures.schemaCases.find((c) => c.id === 'analysisRequest').body);
const schemaRun = spawnSync(
  'pwsh',
  ['-NoProfile', '-File', resolve(root, '项目文档/验收/13.1-Schema验证.ps1')],
  {
    cwd: root,
    input: JSON.stringify([...shapeRequests.values()]),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  },
);
assert.equal(schemaRun.status, 0, schemaRun.stderr || schemaRun.error?.message);
const shapeResults = new Map(
  JSON.parse(schemaRun.stdout.replace(/^\uFEFF/, '')).map((r) => [r.key, r.valid]),
);
function structure(target, body) {
  const key = shapeKey(target, body);
  assert(shapeResults.has(key), `missing schema invocation ${target}`);
  return shapeResults.get(key);
}
function exactSchema(target, body) {
  assert(structure(target, body), `shape mismatch for ${target}`);
}
let checks = 0;
const check = (label, action) => {
  try {
    action();
    checks++;
  } catch (error) {
    throw new Error(`${label}: ${error.message}`, { cause: error });
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = (text) => Buffer.byteLength(text, 'utf8');
const idKeys = ['contextId', 'contextRevision', 'documentRevision', 'editId', 'operationId'];
const refKeys = ['packageRef', 'programRef', 'subsetRef'];
const accepts = (row) =>
  idKeys.every((key) => row.current[key] === row.incoming[key]) &&
  refKeys.every(
    (key) =>
      row.currentRefs[key].id === row.incomingRefs[key].id &&
      row.currentRefs[key].version === row.incomingRefs[key].version,
  );
const runnable = (doc) =>
  doc.syncStatus === 'synced' &&
  !doc.analysisPending &&
  doc.analysisError === null &&
  doc.validatedDocumentRevision === doc.identity.documentRevision &&
  doc.lastSynced !== null &&
  doc.lastSynced.documentRevision === doc.identity.documentRevision &&
  doc.diagnostics.length === 0 &&
  doc.issues.length === 0;
function range(range, source) {
  const data = Buffer.from(source, 'utf8');
  assert(Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end));
  assert(range.start >= 0 && range.end > range.start && range.end <= data.length);
  for (const endpoint of [range.start, range.end])
    assert(endpoint === data.length || (data[endpoint] & 0xc0) !== 0x80, 'not a UTF-8 boundary');
}
function blockNodes(program) {
  exactSchema('blockProgram', program);
  const ids = new Map();
  const stack = [{ value: program, depth: 0 }];
  while (stack.length) {
    const { value, depth } = stack.pop();
    assert(depth <= 64);
    assert(!ids.has(value.id), 'duplicate IR id');
    ids.set(value.id, value);
    assert(ids.size <= 32768);
    if (value.kind === 'integer') assert(BigInt(value.value) <= 2147483647n);
    if (value.kind === 'array_declare') {
      assert(BigInt(value.length) <= 2147483647n);
      if (value.values !== null) {
        assert(BigInt(value.values.length) <= BigInt(value.length));
        for (const item of value.values)
          assert(BigInt(item) >= -2147483647n && BigInt(item) <= 2147483647n);
      }
    }
    for (const field of Object.values(value)) {
      const children = Array.isArray(field) ? field : [field];
      for (const child of children)
        if (child && typeof child === 'object' && Object.hasOwn(child, 'kind'))
          stack.push({ value: child, depth: depth + 1 });
    }
  }
  return ids;
}
function projection(body) {
  exactSchema('projection', body);
  assert(bytes(body.sourceText) <= 32768);
  assert(body.documentRevision === body.provenance.documentRevision);
  const ids = blockNodes(body.program);
  const mapped = new Set();
  for (const item of body.blockMap) {
    assert(ids.has(item.blockId), 'mapping unknown block');
    assert(!mapped.has(item.blockId), 'duplicate mapping');
    mapped.add(item.blockId);
    range(item.byteRange, body.sourceText);
  }
  assert.equal(mapped.size, ids.size, 'all IR nodes need primary ranges');
  const bindings = new Set();
  for (const item of body.bindingMap) {
    assert(!bindings.has(item.bindingKey));
    bindings.add(item.bindingKey);
    range(item.byteRange, body.sourceText);
  }
  for (const item of [...body.provenance.trivia, ...body.provenance.syntheticSegments])
    range(item.byteRange, body.sourceText);
}
function astChildren(node) {
  switch (node.kind) {
    case 'function':
    case 'while':
      return node.kind === 'function' ? [node.body] : [node.condition, node.body];
    case 'block':
      return node.statements;
    case 'declaration':
      return node.initializer.kind === 'none'
        ? []
        : node.initializer.kind === 'scalar'
          ? [node.initializer.expression]
          : node.initializer.elements;
    case 'assignment':
      return [node.target, node.value];
    case 'if':
      return [node.condition, node.thenBlock, node.elseBlock].filter((x) => x !== null);
    case 'for':
      return [node.init, node.condition, node.update, node.body].filter((x) => x !== null);
    case 'condition':
      return [node.expression];
    case 'output':
      return node.arguments;
    case 'return':
      return [node.value];
    case 'index':
      return [node.array, node.index];
    case 'unary':
      return [node.operand];
    case 'binary':
      return [node.left, node.right];
    default:
      return [];
  }
}
function analysis(body, source) {
  exactSchema('validResult', body);
  assert(bytes(source) <= 32768);
  const nodes = body.checkedAst.nodes;
  const lookup = new Map(nodes.map((node) => [node.nodeId, node]));
  assert.equal(lookup.size, nodes.length);
  assert.equal(nodes[0].nodeId, body.checkedAst.rootId);
  assert.equal(nodes[0].kind, 'function');
  assert.equal(nodes[0].parentId, null);
  const visited = new Set();
  const preorder = [];
  const stack = [nodes[0]];
  while (stack.length) {
    const node = stack.pop();
    assert(!visited.has(node.nodeId), 'cycle or shared child');
    visited.add(node.nodeId);
    preorder.push(node.nodeId);
    range(node.byteRange, source);
    const children = astChildren(node).map((id) => {
      const child = lookup.get(id);
      assert(child, 'dangling AST child');
      assert.equal(child.parentId, node.nodeId);
      assert(
        child.byteRange.start >= node.byteRange.start && child.byteRange.end <= node.byteRange.end,
      );
      return child;
    });
    stack.push(...children.reverse());
    if (node.kind === 'name') {
      const declaration = lookup.get(node.resolvedDeclarationId);
      assert(declaration?.kind === 'declaration' && declaration.name === node.name);
    }
  }
  assert.equal(visited.size, nodes.length, 'unreachable AST nodes');
  assert.deepEqual(
    preorder,
    nodes.map((node) => node.nodeId),
  );
  const expressions = new Set(['integer', 'name', 'index', 'unary', 'binary']);
  const expectedMap = nodes.map((node) => ({
    nodeId: node.nodeId,
    kind: expressions.has(node.kind) ? 'expression' : node.kind,
    parentId: node.parentId,
    byteRange: node.byteRange,
  }));
  assert.deepEqual(body.nodeMap, expectedMap);
  for (const item of [...body.blockMap, ...body.bindingMap, ...body.trivia])
    range(item.byteRange, source);
  for (const item of body.blockMap)
    assert(
      nodes.some((node) => same(node.byteRange, item.byteRange)),
      'candidate must match AST range exactly',
    );
}
check('fixture-purpose', () => {
  assert.equal(fixtures.purpose, 'design-fixture');
  assert.equal(sources.purpose, 'design-fixture');
  assert.equal(fixtures.fixtureVersion, '1.0.0');
  assert.equal(sources.fixtureVersion, '1.0.0');
});
for (const item of fixtures.schemaCases)
  check(`schema:${item.id}`, () =>
    assert.equal(Boolean(structure(item.target, item.body)), item.expectedValid),
  );
for (const item of fixtures.stateCases)
  check(`state:${item.id}`, () => {
    exactSchema('editDocument', item.document);
    const doc = item.document;
    assert.equal(runnable(doc), item.expectedRunnable);
    if (doc.analysisPending)
      assert(
        doc.validatedDocumentRevision === null ||
          doc.validatedDocumentRevision < doc.identity.documentRevision,
      );
    if (doc.authoritativeDraft.kind === 'code')
      assert.equal(doc.authoritativeDraft.text, doc.codeDraft);
    else
      assert.equal(doc.authoritativeDraft.workspaceSnapshotId, doc.blockDraft.workspaceSnapshotId);
    if (doc.lastSynced) projection(doc.lastSynced);
  });
for (const item of fixtures.identityCases)
  check(`identity:${item.id}`, () => assert.equal(accepts(item), item.expectedAccept));
const logicalEdits = new Set([
  'code-bytes',
  'code-comment',
  'code-whitespace',
  'block-create',
  'block-delete',
  'block-field',
  'block-reconnect',
  'input-change',
  'answer-mode-change',
  'execution-context-change',
  'explicit-restore',
]);
for (const item of fixtures.revisionCases)
  check(`revision:${item.event}`, () => {
    const delta = logicalEdits.has(item.event) ? 1 : 0;
    assert.equal(delta, item.expectedDocumentDelta);
    assert.equal(delta === 1 || item.event === 'cancel', item.expectedInvalidate);
  });
for (const item of fixtures.relationCases)
  check(`relation:${item.id}`, () => {
    let valid = true;
    try {
      if (item.kind === 'program') blockNodes(item.body);
      else if (item.kind === 'projection') projection(item.body);
      else analysis(item.body, item.sourceText);
    } catch {
      valid = false;
    }
    assert.equal(valid, item.expectedValid);
  });
const blockTypes = [
  ...readFileSync(resolve(root, 'web/src/blocks/definitions.ts'), 'utf8').matchAll(
    /^ {2}'([a-z_]+)',$/gm,
  ),
]
  .map((match) => match[1])
  .slice(0, 20);
check('twenty-existing-kinds', () => {
  assert.equal(new Set(blockTypes).size, 20);
  const blockCases = fixtures.schemaCases
    .filter((c) => c.id.startsWith('block-') && c.expectedValid)
    .map((c) => c.body.kind);
  for (const kind of blockTypes) assert(blockCases.includes(kind));
  assert.equal(fixtures.schemaCases.filter((c) => c.id.startsWith('ast-')).length, 18);
});
const sourceIds = new Set();
const coverage = new Set();
for (const item of sources.cases)
  check(`source:${item.id}`, () => {
    assert(!sourceIds.has(item.id));
    sourceIds.add(item.id);
    assert(bytes(item.sourceText) <= 32768);
    assert(['valid', 'invalid'].includes(item.expectedStatic));
    assert(['synced', 'invalid', 'unmapped'].includes(item.expectedSync));
    if (item.expectedStatic === 'invalid') assert.equal(item.expectedSync, 'invalid');
    if (item.execute)
      assert(item.expectedStatic === 'valid' && typeof item.expectedOutput === 'string');
    else assert.equal(item.expectedOutput, null);
    for (const kind of item.covers) {
      assert(blockTypes.includes(kind));
      if (item.expectedSync === 'synced') coverage.add(kind);
    }
  });
check('source-kind-coverage', () => assert.deepEqual([...coverage].sort(), [...blockTypes].sort()));
check('change-impact-full-union', () => {
  const rules = json(`${contractDir}02.4-变更登记样例.json`).impactRules.filter((r) =>
    change.impactGroups.includes(r.group),
  );
  assert.equal(rules.length, change.impactGroups.length);
  assert.deepEqual(
    [...new Set(rules.flatMap((r) => r.tasks))].sort(),
    [...change.affectedTasks].sort(),
  );
  const roles = [...new Set(rules.flatMap((r) => r.ownerRoles))].sort();
  assert.deepEqual(roles, [...change.requiredOwnerRoles].sort());
  for (const role of roles) assert.equal(change.owners[role], 'root');
  assert.equal(change.status, 'accepted-document');
});
check('additive-fixture-index', () => {
  const index = json(`${contractDir}${change.fixtureIndex}`);
  assert.equal(index.fixtureContractVersion, '1.0.0');
  assert.equal(new Set(index.entries.map((entry) => entry.id)).size, index.entries.length);
  assert.deepEqual(
    index.entries.map((entry) => entry.id),
    change.fixtureIds,
  );
  for (const entry of index.entries) {
    const file = `${contractDir}${entry.resource}`;
    assert.equal(hash(file), entry.sha256);
    let target = json(file);
    for (const segment of entry.jsonPointer.split('/').slice(1)) target = target[segment];
    assert(target);
  }
});
check('old-consumer-rejects-new-message', () => {
  assert.equal(
    structure('oldExecution', fixtures.schemaCases.find((c) => c.id === 'analysisRequest').body),
    false,
  );
});
check('copied-exec-definitions-unchanged', () => {
  for (const [name, value] of Object.entries(schema.$defs))
    if (name.startsWith('exec_')) {
      const originalRefs = JSON.parse(
        JSON.stringify(value).replaceAll('#/$defs/exec_', '#/$defs/'),
      );
      assert.deepEqual(originalRefs, oldSchema.$defs[name.slice(5)]);
    }
});
let preserved = null;
const baselinePath = '.artifacts/13.1/baseline.json';
if (existsSync(resolve(root, baselinePath))) {
  const allowed = new Set([
    'README.md',
    '项目守则.md',
    '项目文档/需求覆盖与范围裁决.md',
    '项目文档/任务进度与交接.md',
    '项目文档/任务包/P0.5-体验改进与基础教学补强.md',
    '项目文档/任务包/第13步-完善积木双向联动与学习约束.md',
  ]);
  const baseline = json(baselinePath);
  preserved = 0;
  for (const item of baseline)
    if (!allowed.has(item.path))
      check(`preserve:${item.path}`, () => {
        assert(existsSync(resolve(root, item.path)), 'removed baseline file');
        assert.equal(hash(item.path), item.sha256);
        preserved++;
      });
}
const files = [
  `${contractDir}13.1-双向映射与编辑规则.md`,
  `${contractDir}13.1-双向编辑.schema.json`,
  `${contractDir}13.1-源码样例.json`,
  `${contractDir}13.1-结构与状态样例.json`,
  `${contractDir}13.1-变更登记.json`,
  `${contractDir}13.1-共享样例索引.json`,
  '项目文档/架构决策/13.1-双向表达范围冻结.md',
  '项目文档/验收/13.1-双向契约验收.md',
  '项目文档/交接/13.1-交接.md',
  '项目文档/验收/13.1-契约检查.mjs',
  '项目文档/验收/13.1-Schema验证.ps1',
];
let localLinks = 0;
for (const file of files.filter((file) => file.endsWith('.md')))
  check(`links:${file}`, () => {
    const text = readFileSync(resolve(root, file), 'utf8');
    assert.equal((text.match(/^```/gm) ?? []).length % 2, 0, 'unclosed fence');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].replace(/^<|>$/g, '').split('#')[0];
      if (/^(?:https?:|urn:|codex:)/.test(target) || !target) continue;
      target = decodeURIComponent(target);
      const resolved = resolve(dirname(resolve(root, file)), target);
      assert(resolved === resolve(root, output) || existsSync(resolved), `missing link ${target}`);
      localLinks++;
    }
  });
const rustPath = '.artifacts/13.1/rust-samples-result-final.json';
const rust = existsSync(resolve(root, rustPath)) ? json(rustPath) : null;
if (rust)
  check('existing-rust-samples', () => {
    assert(rust.allPassed);
    assert.equal(rust.cases, sources.cases.length);
    assert.equal(rust.results.length, sources.cases.length);
    assert.deepEqual(
      rust.results.map((r) => r.id),
      sources.cases.map((r) => r.id),
    );
    assert.equal(rust.executions, sources.cases.filter((r) => r.execute).length);
  });
const report = {
  task: '13.1',
  evidenceLevel: 'design-schema-and-finite-policy-model',
  allPassed: true,
  checks,
  schemaCases: fixtures.schemaCases.length,
  stateCases: fixtures.stateCases.length,
  identityCases: fixtures.identityCases.length,
  revisionCases: fixtures.revisionCases.length,
  relationCases: fixtures.relationCases.length,
  sourceCases: sources.cases.length,
  mappedKinds: coverage.size,
  astKinds: 18,
  affectedTasks: change.affectedTasks.length,
  localLinks,
  protectedBaselineFiles: preserved,
  existingRust: rust
    ? {
        staticMatches: rust.staticMatched,
        staticCases: rust.cases,
        executions: rust.executions,
        executionMatches: rust.executionMatched,
      }
    : 'not-run-in-this-invocation',
  limitations: [
    'No new analysis API, reverse converter, browser, full product regression, persistence, performance or learning acceptance.',
    'Schema permits shapes; C legality remains exclusively Rust. Design expectedSync and input profiles are specifications, not implemented mapping evidence.',
  ],
  files: [
    ...files,
    'README.md',
    '项目守则.md',
    '项目文档/需求覆盖与范围裁决.md',
    '项目文档/任务进度与交接.md',
    '项目文档/任务包/P0.5-体验改进与基础教学补强.md',
    '项目文档/任务包/第13步-完善积木双向联动与学习约束.md',
  ].map((path) => ({ path, sha256: hash(path) })),
};
assert(!existsSync(resolve(root, output)), 'Use a new output path; preserve earlier reports.');
writeFileSync(resolve(root, output), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
