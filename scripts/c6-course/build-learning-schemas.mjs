// The new storage/event formats are separate schemas. Existing SAVE9/LEARN1 stay exact.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const read = (name) => JSON.parse(readFileSync(name, 'utf8').replace(/^\uFEFF/u, ''));
const index = read('content/c/primer6-learning/index-1.0.0.json');
const manifest = read('content/c/primer6-teaching/manifest-2.0.0.json');
const previous = read('shared/contracts/19.1-存档结构9.0.0.schema.json');
const execution = read('shared/contracts/21.2-C6执行与判题.schema.json');
const copy = (value) => structuredClone(value);
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const object = (properties) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const literal = (value) => ({ const: value });
const nullable = (value) => ({ anyOf: [value, { type: 'null' }] });
const array = (items, maxItems) => ({ type: 'array', maxItems, items });
const publicRef = (ids, version = '2.0.0') =>
  object({ id: { enum: ids }, version: literal(version) });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$(?![\\s\\S])' };
const opaque = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$(?![\\s\\S])' };
const lessonRef = publicRef(index.lessons.map((l) => l[0]));
const exerciseRef = publicRef(index.exercises.map((e) => e[0]));
const definitions = copy(previous.$defs);
definitions.meta = object({
  schemaVersion: literal('10.0.0'),
  dbVersion: literal(10),
  generation: ref('uuid'),
  revision: ref('safeUint'),
  timeZone: { type: 'string', minLength: 1 },
  createdAt: ref('utcTime'),
  activePackageRef: publicRef(['content.c.primer6']),
  activeCatalogSetRef: publicRef(['catalog-set.c.primer6']),
});
definitions.c6Attempt = object({
  eventId: ref('uuid'),
  at: ref('utcTime'),
  sourceRevision: opaque,
  sourceSha256: hash,
  requestSha256: hash,
  resultSha256: hash,
  engineBuildSha256: literal(index.engineBuildSha256),
  profileRef: publicRef(
    index.exercises.map((e) => e[3]),
    '1.0.0',
  ),
  status: { enum: ['passed', 'failed', 'incomplete'] },
  caseKeys: {
    type: 'array',
    maxItems: 4,
    prefixItems: [1, 2, 3, 4].map((n) => literal(`case-${n}`)),
    items: false,
  },
  failedCaseKey: nullable({ enum: ['case-1', 'case-2', 'case-3', 'case-4'] }),
  failure: nullable({ enum: ['wrong-answer', 'teaching-goal-unmet', 'program-error'] }),
});
definitions.c6Attempt.allOf = [
  {
    if: { properties: { status: literal('passed') } },
    then: {
      properties: {
        caseKeys: { minItems: 4 },
        failedCaseKey: { type: 'null' },
        failure: { type: 'null' },
      },
    },
  },
];
const activity = {
  activityVersion: literal('2.0.0'),
  generation: ref('uuid'),
  revision: ref('safePositiveInt'),
  lastEventId: ref('uuid'),
  firstAt: ref('utcTime'),
  lastAt: ref('utcTime'),
};
definitions.c6Activity = {
  oneOf: [
    object({
      ...activity,
      kind: literal('lesson'),
      subjectRef: lessonRef,
      startedAt: ref('utcTime'),
      readAt: ref('nullableUtcTime'),
      completedAt: ref('nullableUtcTime'),
    }),
    object({
      ...activity,
      kind: literal('exercise'),
      subjectRef: exerciseRef,
      firstPass: nullable(ref('c6Attempt')),
      latestAttempt: ref('c6Attempt'),
    }),
  ],
};
definitions.c6Draft = object({
  draftVersion: literal('2.0.0'),
  generation: ref('uuid'),
  documentId: opaque,
  nodeRef: publicRef(manifest.nodes.map((n) => `node.${n.id}`)),
  exerciseRef: nullable(exerciseRef),
  sourceRevision: opaque,
  source: { type: 'string', maxLength: 32768 },
  input: { type: 'string', maxLength: 256, pattern: '^[\\u0000-\\u007f]*$(?![\\s\\S])' },
  revision: ref('safePositiveInt'),
  updatedAt: ref('utcTime'),
});
definitions.coreSnapshot = { ...object(copy(previous.properties)), allOf: copy(previous.allOf) };
const storage = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:c-viz:save:10.0.0',
  title: 'SAVE10 current core and C6 course transaction projection',
  $comment:
    'DB10 has 19 stores. This projection contains 11 core stores plus courseActivities/courseDrafts; existing six specialized stores retain their separate contracts. UTF-8 byte quotas, generation, CAS, ownership, proofs, keys and cross-row relations are enforced at the transaction boundary, not by this structural schema.',
  ...object({
    snapshot: ref('coreSnapshot'),
    rows: object({ activities: array(ref('c6Activity'), 871), drafts: array(ref('c6Draft'), 64) }),
  }),
  $defs: definitions,
};
const receipt = copy(previous.$defs.legacyReceipt);
assert(receipt.type === 'object' && receipt.required.includes('committedRevision'));
receipt.required = receipt.required.filter((name) => name !== 'committedRevision');
delete receipt.properties.committedRevision;
receipt.properties.eventType = {
  enum: [
    'lesson.started',
    'lesson.study-confirmed',
    'exercise.passed',
    'exercise.attempt-evaluated',
  ],
};
receipt.properties.subjectRef = { oneOf: [lessonRef, exerciseRef] };
receipt.properties.packageRef = publicRef(['content.c.primer6']);
receipt.properties.learningRevision = literal(1);
const learning = {
  $schema: storage.$schema,
  $id: 'urn:c-viz:learn:2.0.0',
  title: 'LEARN2 explicit new C course command',
  $comment:
    'Only the private current-session fact issuer may submit a judge event. A structurally valid DTO never proves execution. SAVE9/LEARN1 are unchanged. A/B, containers and optional guides have no learning identity.',
  ...object({
    learnVersion: literal('2.0.0'),
    generation: ref('uuid'),
    receipt: ref('c6LearningReceipt'),
  }),
  $defs: { ...copy(previous.$defs), c6LearningReceipt: receipt },
};
const pair = object({
  start: { type: 'integer', minimum: 0, maximum: 32768 },
  end: { type: 'integer', minimum: 0, maximum: 32768 },
});
const point = object({
  line: { type: 'integer', minimum: 1, maximum: 32769 },
  column: { type: 'integer', minimum: 1, maximum: 32769 },
});
const range = object({ byteRange: pair, utf16Range: pair, start: point, end: point });
const protocol = execution.$defs.result.properties;
const engine = copy(protocol.engine);
engine.properties.buildId = literal(index.engineBuildSha256);
const snapshot = {
  $schema: storage.$schema,
  $id: 'urn:c-viz:current-snapshot:2.0.0',
  title: 'SNAPSHOT2 complete current C6 state',
  $comment:
    'A read-only observation, never learning-pass authority or an executable import. Capture requires the private accepted production C6 response, current source/session and exact STEP cursor. JSON2MiB; PNG8MiB/layout4MiB/1440x8192/5s/512objects/64frames/2048live slots remain unchanged. Cross-field source hash, coordinates, cursor/step/state, type relations and judge input are checked at capture.',
  ...object({
    formatId: literal('urn:c-viz:current-snapshot:2.0.0'),
    formatVersion: literal('2.0.0'),
    snapshotId: ref('uuid'),
    capturedAt: ref('utcTime'),
    origin: object({
      kind: literal('c6-course'),
      title: { type: 'string', minLength: 1, maxLength: 500 },
      documentRef: publicRef([
        ...manifest.chunks.flatMap((c) => c.entityIds.programs),
        ...index.exercises.map((e) => e[0]),
      ]),
      nodeRef: publicRef(manifest.nodes.map((n) => `node.${n.id}`)),
      exerciseRef: nullable(exerciseRef),
      packageRef: publicRef(['content.c.primer6']),
    }),
    source: object({
      text: { type: 'string', maxLength: 32768 },
      encoding: literal('UTF-8'),
      sourceRevision: opaque,
      sha256: hash,
      nodeMap: copy(protocol.nodeMap),
    }),
    input: object({
      kind: literal('stdin-ascii'),
      text: copy(execution.$defs.request.properties.input.properties.text),
      profileRef: nullable(
        publicRef(
          index.exercises.map((e) => e[3]),
          '1.0.0',
        ),
      ),
      caseKey: nullable({ enum: ['case-1', 'case-2', 'case-3', 'case-4'] }),
    }),
    runtime: object({
      domain: literal('c6'),
      engine,
      identity: copy(protocol.identity),
      versions: object({
        execution: literal('1.5.0'),
        step: literal('1.4.0'),
        diagnostic: literal('1.4.0'),
        integerEncoding: literal('1.0.0'),
        judge: nullable(literal('2.0.0')),
      }),
      requestSha256: hash,
      resultSha256: hash,
    }),
    position: object({
      cursor: { type: 'integer', minimum: 0, maximum: 20000 },
      length: { type: 'integer', minimum: 0, maximum: 20000 },
      paused: literal(true),
      completeness: { enum: ['complete', 'prefix'] },
      executedRange: nullable(range),
      terminalRange: nullable(range),
    }),
    virtualAddresses: literal('educational-not-host-addresses'),
    presentation: object({
      scope: literal('complete-current-state'),
      image: literal('reflowed-state-picture'),
      selectionAndPaginationExcluded: literal(true),
    }),
    types: copy(protocol.types),
    currentState: ref('state'),
    currentStep: nullable(copy(execution.$defs.trace.properties.steps.items)),
    executionOutcome: copy(protocol.terminal),
    terminalAtCursor: nullable(copy(protocol.terminal)),
  }),
  $defs: {
    uuid: copy(previous.$defs.uuid),
    utcTime: copy(previous.$defs.utcTime),
    state: copy(execution.$defs.state),
    scalarValue: copy(execution.$defs.scalarValue),
  },
};
// Snapshot1 remains a separate typed observation. No old parser or importer is widened.
const oldExecution = read('shared/contracts/P0.5-09-执行与判题-1.1.0.schema.json');
const oldMemory = read('shared/contracts/17.2-进阶执行.schema.json');
function namespaced(value, prefix) {
  if (Array.isArray(value)) return value.map((v) => namespaced(v, prefix));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        key === '$ref' && typeof v === 'string' && v.startsWith('#/$defs/')
          ? v.replace('#/$defs/', `#/$defs/${prefix}`)
          : namespaced(v, prefix),
      ]),
    );
  return value;
}
const legacyDefs = Object.fromEntries([
  ...Object.entries(oldExecution.$defs).map(([key, v]) => [`p0_${key}`, namespaced(v, 'p0_')]),
  ...Object.entries(oldMemory.$defs).map(([key, v]) => [`memory_${key}`, namespaced(v, 'memory_')]),
]);
const p0 = namespaced(oldExecution.$defs.result.properties, 'p0_');
const memory = namespaced(oldMemory.$defs.result.properties, 'memory_');
const any = (...items) => ({ anyOf: items });
const legacySnapshot = object({
  formatId: literal('urn:c-viz:current-snapshot:1.0.0'),
  formatVersion: literal('1.0.0'),
  snapshotId: ref('uuid'),
  capturedAt: ref('utcTime'),
  origin: object({
    kind: { enum: ['case', 'memory-observation'] },
    id: { type: 'string' },
    title: { type: 'string' },
    caseRef: p0.subjectRef,
    programRef: p0.programRef,
    packageRef: nullable(p0.packageRef),
    definitionVersion: any(
      object({ scheme: literal('content-ref'), value: { type: 'string' } }),
      object({ scheme: literal('source-sha256'), value: hash }),
    ),
  }),
  source: object({
    text: { type: 'string', maxLength: 32768 },
    encoding: literal('UTF-8'),
    sourceRevision: any({ type: 'string' }, { type: 'integer', minimum: 0 }),
    sha256: hash,
    nodeMap: any(p0.nodeMap, memory.nodeMap),
    blockMap: namespaced(oldExecution.$defs.source.properties.blockMap, 'p0_'),
    bindingMap: namespaced(oldExecution.$defs.source.properties.bindingMap, 'p0_'),
    resolvedBindings: p0.resolvedBindings,
  }),
  input: any(ref('p0_input'), { type: 'array', items: ref('p0_int32') }),
  position: object({
    cursor: { type: 'integer', minimum: 0 },
    length: { type: 'integer', minimum: 0 },
    stepKind: nullable({ type: 'string' }),
    paused: literal(true),
    atTerminal: { type: 'boolean' },
    executed: object({
      raw: any(ref('p0_location'), pair, { type: 'null' }),
      range: nullable(range),
      description: { type: 'string' },
    }),
    highlighted: object({ reason: { type: 'string' }, range: nullable(range) }),
    terminalRange: nullable(range),
  }),
  presentation: object({
    mode: { enum: ['basic', 'memory', 'stack'] },
    scope: literal('complete-current-state'),
    image: literal('reflowed-state-picture'),
    selectionAndPaginationExcluded: literal(true),
  }),
  virtualAddresses: literal('educational-not-host-addresses'),
  runtime: any(
    object({
      domain: literal('p0-c'),
      language: p0.languageRef,
      subset: p0.subsetRef,
      engine: p0.engineRef,
      identity: p0.identity,
      versions: object({
        execution: { type: 'string' },
        step: { type: 'string' },
        diagnostic: { type: 'string' },
        integerEncoding: { type: 'string' },
        judge: { type: 'string' },
      }),
    }),
    object({
      domain: literal('p1-memory'),
      language: memory.language,
      subset: { type: 'null' },
      engine: object({
        id: literal('engine.rust.memory'),
        version: literal('0.1.0'),
        buildId: hash,
      }),
      identity: memory.identity,
      versions: object({
        execution: { type: 'string' },
        step: { type: 'string' },
        diagnostic: { type: 'string' },
        integerEncoding: { type: 'string' },
        judge: { type: 'null' },
      }),
    }),
  ),
  currentState: any(ref('p0_state'), ref('memory_state')),
  currentStep: any(
    ref('p0_step'),
    namespaced(oldMemory.$defs.trace.properties.steps.items, 'memory_'),
    { type: 'null' },
  ),
  types: nullable(memory.types),
  executionOutcome: any(p0.terminal, memory.terminal),
  terminalAtCursor: any(p0.terminal, memory.terminal, { type: 'null' }),
});
const noteFilter = object({
  chapterId: {
    enum: ['', 'unlinked', ...index.knowledge.filter((k) => k[2] === 'chapter').map((k) => k[1])],
  },
  from: any(literal(''), { type: 'string', format: 'date' }),
  to: any(literal(''), { type: 'string', format: 'date' }),
  types: {
    ...array({ enum: ['learning', 'mistake', 'analysis', 'snapshot'] }, 4),
    uniqueItems: true,
  },
});
const noteEntry = object({
  id: { type: 'string', minLength: 1, maxLength: 512 },
  kind: { enum: ['learning', 'mistake', 'analysis', 'snapshot'] },
  title: { type: 'string', maxLength: 500 },
  occurredAt: ref('utcTime'),
  date: { type: 'string', format: 'date' },
  chapterIds: {
    ...array({ enum: index.knowledge.filter((k) => k[2] === 'chapter').map((k) => k[1]) }, 17),
    uniqueItems: true,
  },
  language: { enum: ['c', 'cpp', null] },
  origin: object({
    packageRef: nullable(ref('publicRef')),
    subjectRef: nullable(ref('publicRef')),
    learningRevision: nullable({ type: 'integer', minimum: 1 }),
  }),
  reference: nullable(
    object({
      nodeRef: publicRef(manifest.nodes.map((n) => `node.${n.id}`)),
      sourceSha256: literal(index.sourceSha256),
      document: literal('C Primer Plus 第6版'),
      physicalPage: { type: 'integer', minimum: 1, maximum: 1635 },
    }),
  ),
  href: nullable({ type: 'string', pattern: '^/' }),
  text: { type: 'string' },
  source: nullable(
    object({
      kind: literal('saved-draft'),
      text: { type: 'string', maxLength: 32768 },
      sourceRevision: opaque,
      input: { type: 'string', maxLength: 256 },
    }),
  ),
  snapshot: any({ $ref: snapshot.$id }, ref('legacySnapshot1'), { type: 'null' }),
});
const noteDefinitions = {
  uuid: copy(previous.$defs.uuid),
  utcTime: copy(previous.$defs.utcTime),
  entityId: copy(previous.$defs.entityId),
  version: copy(previous.$defs.version),
  publicRef: copy(previous.$defs.publicRef ?? previous.$defs.ref),
  ...legacyDefs,
  legacySnapshot1: legacySnapshot,
  noteEntry,
};
assert(noteDefinitions.publicRef);
const notes = {
  $schema: storage.$schema,
  $id: 'urn:c-viz:study-notes:2.0.0',
  title: 'Notes2 explicit current-generation selection',
  $comment:
    'An internal preview envelope, not a learning fact or import format. Source byte and package/snapshot quotas and current saved revision remain authoritative at runtime. Snapshot1 and Snapshot2 keep separate typed forms.',
  ...object({
    formatId: literal('urn:c-viz:study-notes:2.0.0'),
    formatVersion: literal('2.0.0'),
    createdAt: ref('utcTime'),
    lease: ref('uuid'),
    timeZone: { type: 'string', minLength: 1 },
    filter: noteFilter,
    entries: { ...array(ref('noteEntry'), 200), minItems: 1 },
  }),
  $defs: noteDefinitions,
};
const download = {
  $schema: storage.$schema,
  $id: 'urn:c-viz:study-notes-download:2.0.0',
  title: 'Notes download2 ZIP metadata, without internal lease',
  ...object({
    formatId: literal('urn:c-viz:study-notes-download:2.0.0'),
    formatVersion: literal('2.0.0'),
    title: { type: 'string', minLength: 1, maxLength: 500 },
    exportedAt: ref('utcTime'),
    previewedAt: ref('utcTime'),
    timeZone: { type: 'string', minLength: 1 },
    filter: noteFilter,
    entries: { ...array(ref('noteEntry'), 200), minItems: 1 },
    assets: array(
      object({
        entryId: { type: 'string' },
        image: { type: 'string', pattern: '^assets/snapshot-0[1-8]\\.png$(?![\\s\\S])' },
        state: { type: 'string', pattern: '^snapshots/snapshot-0[1-8]\\.json$(?![\\s\\S])' },
      }),
      8,
    ),
  }),
  $defs: noteDefinitions,
};
const badgeCatalog = read('content/achievements/catalog-2.0.0.json');
const achievements = {
  $schema: storage.$schema,
  $id: 'urn:c-viz:achievement:2.0.0',
  title: 'Current-generation achievements2, exact new catalog',
  $comment:
    'Three badges, unchanged quotas, no points or course completion. Old achievement1 remains separate. Runtime validates evidence uniqueness, current generation, exact saved receipts and full completion.',
  oneOf: badgeCatalog.badges.map((badge) =>
    object({
      achievementVersion: literal('2.0.0'),
      generation: ref('uuid'),
      revision: { type: 'integer', minimum: 1 },
      catalogRef: literal(badgeCatalog.ref),
      badgeRef: literal({ id: badge.id, version: badge.version }),
      packageRef: literal(badgeCatalog.packageRef),
      unlockedAt: nullable(ref('utcTime')),
      evidence: {
        ...array(
          {
            oneOf: badge.requirements.map((q) =>
              object({
                kind: literal(q.kind),
                eventId: ref('uuid'),
                subjectRef: literal({ id: q.id, version: q.version }),
                learningRevision: literal(1),
                occurredAt: ref('utcTime'),
              }),
            ),
          },
          badge.requirements.length,
        ),
        minItems: 1,
        uniqueItems: true,
      },
    }),
  ),
  $defs: { uuid: copy(previous.$defs.uuid), utcTime: copy(previous.$defs.utcTime) },
};
for (const [path, value] of [
  ['shared/contracts/21.5-存档结构10.0.0.schema.json', storage],
  ['shared/contracts/21.5-学习事件2.0.0.schema.json', learning],
  ['shared/contracts/21.5-C6当前快照2.0.0.schema.json', snapshot],
  ['shared/contracts/21.5-笔记选择2.0.0.schema.json', notes],
  ['shared/contracts/21.5-笔记下载2.0.0.schema.json', download],
  ['shared/contracts/21.5-成就记录2.0.0.schema.json', achievements],
]) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.argv.includes('--write')) writeFileSync(path, text);
  else assert.equal(readFileSync(path, 'utf8'), text);
  console.log(`${path} ${Buffer.byteLength(text)} bytes`);
}
