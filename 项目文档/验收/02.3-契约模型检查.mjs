import fs from 'node:fs';
import assert from 'node:assert/strict';

// This finite document model neither opens IndexedDB nor validates C evidence.
const read = name => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
const fixtures = read('../契约/02.3-存档样例.json');
const vectors = read('../契约/02.3-迁移与并发场景.json');
const content = read('../契约/02.1-内容样例.json');
const initial = fixtures.snapshots[0].snapshot;
const populated = fixtures.snapshots[1].snapshot;
const clone = structuredClone;
const same = (a, b) => { try { assert.deepEqual(a, b); return true; } catch { return false; } };
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireRule = (ok, code = 'S_RECORD_INVALID') => { if (!ok) fail(code); };
const ref = id => ({ id, version: '1.0.0' });
const result = { 'lesson.started': 'started', 'lesson.study-confirmed': 'confirmed', 'exercise.passed': 'passed', 'lesson.completed': 'completed', 'exercise.attempt-evaluated': 'failed', 'case.view-confirmed': 'confirmed' };
const sources = { 'exercise.passed': 'reward.exercise.first-pass', 'lesson.completed': 'reward.lesson.first-completion', 'case.view-confirmed': 'reward.case.first-view' };
const categories = ['wrong-answer', 'teaching-goal-unmet', 'program-error', 'cancelled', 'resource-limit', 'infrastructure-failure'];
const uuid = n => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rootKeys = ['meta', 'settings', 'avatar', 'progress', 'dailyFacts', 'goals', 'ledger', 'receipts', 'aliases'];
const key = parts => JSON.stringify(parts);
const exactKeys = (row, fields) => requireRule(row && same(Object.keys(row).sort(), fields.slice().sort()));
const unique = (rows, makeKey) => requireRule(new Set(rows.map(makeKey)).size === rows.length);
const validTime = t => typeof t === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(t) && Number.isFinite(Date.parse(t)) && new Date(t).toISOString() === t;
const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && validTime(`${d}T00:00:00.000Z`);
function localDate(at, zone) {
  requireRule(validTime(at), 'S_DATE_INVALID');
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at));
    const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch { fail('S_DATE_INVALID'); }
}
function validTargets(t) {
  exactKeys(t, ['exercise', 'lesson', 'case']);
  requireRule(Object.values(t).every(n => Number.isInteger(n) && n >= 0 && n <= 100) && Object.values(t).some(n => n > 0));
}
function canonical(s, id) {
  const seen = new Set();
  for (let i = 0; i <= 32; i++) {
    requireRule(!seen.has(id)); seen.add(id);
    const edge = s.aliases.find(a => a.toRef.id === id);
    if (!edge) return id;
    id = edge.fromRef.id;
  }
  fail('S_RECORD_INVALID');
}
function compatible(s, row, entity) {
  if (!entity || row.learningRevision !== entity.learningRevision) return false;
  let mapped = clone(row.subjectRef);
  const seen = new Set();
  for (let i = 0; i <= 32; i++) {
    if (seen.has(mapped.id)) return false; seen.add(mapped.id);
    if (mapped.id === entity.id) return mapped.version === entity.version || entity.acceptedPriorVersions.includes(mapped.version);
    const a = s.aliases.find(x => x.fromRef.id === mapped.id);
    if (!a || a.learningRevision !== row.learningRevision || !(mapped.version === a.fromRef.version || a.fromAcceptedPriorVersions.includes(mapped.version))) return false;
    mapped = clone(a.toRef);
  }
  return false;
}
function validateSnapshot(s) {
  requireRule(s.meta?.schemaVersion === '1.0.0', 'S_VERSION_UNKNOWN');
  exactKeys(s, rootKeys);
  exactKeys(s.meta, ['schemaVersion', 'dbVersion', 'generation', 'revision', 'timeZone', 'createdAt', 'activePackageRef']);
  requireRule(s.meta.dbVersion === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s.meta.generation));
  requireRule(Number.isSafeInteger(s.meta.revision) && s.meta.revision >= 0);
  localDate(s.meta.createdAt, s.meta.timeZone);
  exactKeys(s.settings, ['theme', 'reducedMotion', 'playbackRate', 'goalTemplate']);
  requireRule(['system', 'light', 'dark'].includes(s.settings.theme) && ['system', 'on', 'off'].includes(s.settings.reducedMotion) && [0.25, 0.5, 1, 1.5, 2, 4].includes(s.settings.playbackRate));
  if (s.settings.goalTemplate) { exactKeys(s.settings.goalTemplate, ['revision', 'targets']); validTargets(s.settings.goalTemplate.targets); requireRule(Number.isSafeInteger(s.settings.goalTemplate.revision) && s.settings.goalTemplate.revision > 0); }
  exactKeys(s.avatar, ['presetId', 'accentColor']); requireRule(/^avatar\.[a-z0-9.-]+$/.test(s.avatar.presetId) && /^#[0-9A-F]{6}$/.test(s.avatar.accentColor));
  for (const name of rootKeys.slice(3)) requireRule(Array.isArray(s[name]));
  for (const r of s.progress) {
    const fields = ['eventType', 'result', 'subjectRef', 'packageRef', 'learningRevision', 'firstAt', 'lastAt'];
    if (r.eventType === 'exercise.attempt-evaluated') fields.push('resultCategory', 'failedCaseKey');
    exactKeys(r, fields); requireRule(r.eventType in result && result[r.eventType] === r.result && r.subjectRef.id.startsWith(`${r.eventType.split('.')[0]}.`) && validTime(r.firstAt) && validTime(r.lastAt) && r.firstAt <= r.lastAt);
    requireRule(Number.isSafeInteger(r.learningRevision) && r.learningRevision > 0);
    if (r.eventType === 'exercise.attempt-evaluated') requireRule(categories.includes(r.resultCategory));
  }
  unique(s.progress, r => key([r.eventType, r.subjectRef.id, r.subjectRef.version, r.learningRevision]));
  for (const r of s.dailyFacts) {
    exactKeys(r, ['eventType', 'subjectRef', 'canonicalSubjectId', 'occurredAt', 'localDate']);
    requireRule(r.eventType in sources && canonical(s, r.subjectRef.id) === r.canonicalSubjectId);
    requireRule(validDate(r.localDate) && localDate(r.occurredAt, s.meta.timeZone) === r.localDate, 'S_DATE_INVALID');
  }
  unique(s.dailyFacts, r => key([r.localDate, r.eventType, r.canonicalSubjectId]));
  for (const g of s.goals) {
    exactKeys(g, ['localDate', 'goalVersion', 'targets', 'achievedAt']); requireRule(validDate(g.localDate), 'S_DATE_INVALID');
    requireRule(Number.isSafeInteger(g.goalVersion) && g.goalVersion > 0);
    if (g.targets !== null) validTargets(g.targets);
    if (g.achievedAt !== null) { requireRule(g.targets !== null && goalMet(s, g)); requireRule(localDate(g.achievedAt, s.meta.timeZone) === g.localDate, 'S_DATE_INVALID'); }
  }
  unique(s.goals, g => g.localDate);
  for (const r of s.ledger) {
    exactKeys(r, ['sourceId', 'subjectId', 'localDate', 'occurredAt', 'status', 'points', 'policyRef']);
    requireRule([...Object.values(sources), 'reward.daily-goal.once'].includes(r.sourceId));
    requireRule(localDate(r.occurredAt, s.meta.timeZone) === r.localDate, 'S_DATE_INVALID');
    requireRule(r.status === 'pending' ? r.points === null && r.policyRef === null : r.status === 'posted' && Number.isSafeInteger(r.points) && r.points >= 0 && r.policyRef !== null);
    if (r.sourceId === 'reward.daily-goal.once') requireRule(r.subjectId === `local-goal.${r.localDate}` && s.goals.some(g => g.localDate === r.localDate && g.achievedAt !== null));
  }
  unique(s.ledger, r => key([r.sourceId, r.sourceId === 'reward.daily-goal.once' ? r.localDate : r.subjectId]));
  for (const r of s.receipts) {
    const fields = ['eventId', 'eventType', 'subjectRef', 'packageRef', 'learningRevision', 'result', 'goalVersion', 'occurredAt', 'localDate', 'committedRevision'];
    if (r.eventType === 'exercise.attempt-evaluated') fields.push('resultCategory', 'failedCaseKey');
    exactKeys(r, fields); requireRule(Number.isSafeInteger(r.committedRevision) && r.committedRevision > 0 && r.committedRevision <= s.meta.revision);
    requireRule(localDate(r.occurredAt, s.meta.timeZone) === r.localDate, 'S_DATE_INVALID');
  }
  unique(s.receipts, r => r.eventId);
  unique(s.aliases, a => a.fromRef.id); unique(s.aliases, a => a.toRef.id);
  for (const a of s.aliases) canonical(s, a.toRef.id);
  return s;
}
function goalMet(s, g) {
  if (!g.targets) return false;
  return Object.entries(g.targets).every(([type, n]) => s.dailyFacts.filter(r => r.localDate === g.localDate && r.eventType.startsWith(`${type}.`)).length >= n);
}
function makeEnv() {
  return { entities: clone([...content.lessons, ...content.exercises, ...content.cases]), lessons: clone(content.lessons), policy: null };
}
function openDay(s, day) {
  requireRule(validDate(day), 'S_DATE_INVALID');
  if (s.goals.some(g => g.localDate === day)) return false;
  const t = s.settings.goalTemplate;
  s.goals.push({ localDate: day, goalVersion: t?.revision ?? 1, targets: t ? clone(t.targets) : null, achievedAt: null });
  return true;
}
function receiptSummary(s, a) {
  const at = a.at ?? '2026-10-13T16:00:00.000Z';
  const day = a.localDate ?? localDate(at, s.meta.timeZone);
  const goal = s.goals.find(g => g.localDate === day);
  const r = { eventId: uuid(a.event), eventType: a.type, subjectRef: { id: a.id, version: a.version ?? '1.0.0' }, packageRef: clone(a.packageRef ?? s.meta.activePackageRef), learningRevision: a.learningRevision ?? 1, result: a.result ?? result[a.type], goalVersion: a.goalVersion ?? goal?.goalVersion, occurredAt: at, localDate: day };
  if (a.type === 'exercise.attempt-evaluated') Object.assign(r, { resultCategory: a.category, failedCaseKey: a.failedCaseKey ?? null });
  return r;
}
function postClaims(s, policy) {
  if (!policy) return false;
  let changed = false;
  for (const r of s.ledger) if (r.status === 'pending') {
    requireRule(Number.isSafeInteger(policy.points[r.sourceId]) && policy.points[r.sourceId] >= 0);
    Object.assign(r, { status: 'posted', points: policy.points[r.sourceId], policyRef: clone(policy.ref) }); changed = true;
  }
  return changed;
}
function claim(s, sourceId, subjectId, r) {
  const daily = sourceId === 'reward.daily-goal.once';
  if (!s.ledger.some(x => x.sourceId === sourceId && (daily ? x.localDate === r.localDate : x.subjectId === subjectId))) s.ledger.push({ sourceId, subjectId, localDate: r.localDate, occurredAt: r.occurredAt, status: 'pending', points: null, policyRef: null });
}
function recordFact(s, type, entity, r) {
  const id = canonical(s, entity.id);
  if (!s.dailyFacts.some(x => x.localDate === r.localDate && x.eventType === type && x.canonicalSubjectId === id)) s.dailyFacts.push({ eventType: type, subjectRef: { id: entity.id, version: entity.version }, canonicalSubjectId: id, occurredAt: r.occurredAt, localDate: r.localDate });
  claim(s, sources[type], id, r);
}
function upsertProgress(s, type, entity, r) {
  const k = x => key([x.eventType, x.subjectRef.id, x.subjectRef.version, x.learningRevision]);
  const row = { eventType: type, result: result[type], subjectRef: { id: entity.id, version: entity.version }, packageRef: clone(r.packageRef), learningRevision: entity.learningRevision, firstAt: r.occurredAt, lastAt: r.occurredAt };
  if (type === 'exercise.attempt-evaluated') Object.assign(row, { resultCategory: r.resultCategory, failedCaseKey: r.failedCaseKey });
  const old = s.progress.find(x => k(x) === k(row));
  if (!old) s.progress.push(row);
  else {
    old.firstAt = old.firstAt < r.occurredAt ? old.firstAt : r.occurredAt;
    if (old.lastAt <= r.occurredAt) { old.lastAt = r.occurredAt; if (type === 'exercise.attempt-evaluated') Object.assign(old, { resultCategory: r.resultCategory, failedCaseKey: r.failedCaseKey }); }
  }
}
function transact(state, action, env) {
  const original = clone(state);
  try {
    validateSnapshot(state);
    const commandGeneration = action.generation ?? initial.meta.generation;
    requireRule(commandGeneration === state.meta.generation, 'S_GENERATION_STALE');
    const s = clone(state);
    const injected = phase => { if (action.failAt === phase) fail(action.error ?? 'S_ABORTED'); };
    let changed = true;
    if (action.op === 'read') return { state, code: 'read' };
    if (action.op === 'clear') {
      const fresh = clone(initial); fresh.meta.generation = '22222222-2222-4222-8222-222222222222';
      requireRule(fresh.meta.generation !== state.meta.generation); injected('clear'); return { state: fresh, code: 'saved' };
    }
    if (action.op === 'open') changed = openDay(s, action.day);
    else if (['template', 'settings', 'avatar'].includes(action.op)) {
      requireRule(action.expectedRevision === s.meta.revision, 'S_REVISION_CONFLICT');
      if (action.op === 'template') {
        validTargets(action.targets);
        const counts = { exercise: content.exercises.length, lesson: content.lessons.length, case: content.cases.length };
        requireRule(Object.entries(action.targets).every(([k, n]) => n <= counts[k]));
        s.settings.goalTemplate = { revision: (s.settings.goalTemplate?.revision ?? 0) + 1, targets: clone(action.targets) };
      } else if (action.op === 'settings') s.settings.theme = action.theme;
      else s.avatar.accentColor = action.color;
    } else if (action.op === 'settle') { changed = postClaims(s, fixtures.demoPolicy); injected('ledger'); }
    else if (action.op === 'learn') {
      const r = receiptSummary(s, action);
      const old = s.receipts.find(x => x.eventId === r.eventId);
      if (old) {
        const { committedRevision, ...summary } = old;
        requireRule(same(summary, r), 'S_EVENT_ID_REUSED');
        return { state, code: 'duplicate' };
      }
      requireRule(!['lesson.completed', 'daily-goal.achieved'].includes(action.type));
      const entity = env.entities.find(x => x.id === r.subjectRef.id && x.version === r.subjectRef.version && x.learningRevision === r.learningRevision);
      requireRule(entity, 'S_CONTENT_INCOMPATIBLE');
      requireRule(same(r.packageRef, s.meta.activePackageRef) && r.eventType in result && result[r.eventType] === r.result && entity.id.startsWith(`${r.eventType.split('.')[0]}.`), 'S_CONTENT_INCOMPATIBLE');
      requireRule(localDate(r.occurredAt, s.meta.timeZone) === r.localDate, 'S_DATE_INVALID');
      const goal = s.goals.find(g => g.localDate === r.localDate);
      requireRule(goal && goal.goalVersion === r.goalVersion, 'S_DATE_INVALID');
      if (action.type === 'exercise.attempt-evaluated') requireRule(categories.includes(r.resultCategory) && (r.failedCaseKey === null || entity.tests.some(t => t.caseKey === r.failedCaseKey)));
      upsertProgress(s, action.type, entity, r); injected('progress');
      if (action.type in sources) recordFact(s, action.type, entity, r);
      if (['exercise.passed', 'lesson.study-confirmed'].includes(action.type)) {
        for (const lesson of env.lessons) {
          const related = action.type === 'lesson.study-confirmed' ? lesson.id === entity.id : lesson.requiredExerciseRefs.some(x => x.id === entity.id);
          if (!related) continue;
          const confirmed = s.progress.some(x => x.eventType === 'lesson.study-confirmed' && compatible(s, x, lesson));
          const passed = lesson.requiredExerciseRefs.length > 0 && lesson.requiredExerciseRefs.every(x => {
            const ex = env.entities.find(e => e.id === x.id && e.version === x.version);
            return s.progress.some(p => p.eventType === 'exercise.passed' && compatible(s, p, ex));
          });
          if (confirmed && passed) { upsertProgress(s, 'lesson.completed', lesson, r); recordFact(s, 'lesson.completed', lesson, r); }
        }
      }
      if (goal.achievedAt === null && goalMet(s, goal)) {
        goal.achievedAt = r.occurredAt; claim(s, 'reward.daily-goal.once', `local-goal.${r.localDate}`, r);
      }
      postClaims(s, env.policy); injected('ledger');
      s.receipts.push({ ...r, committedRevision: s.meta.revision + 1 }); injected('receipt');
    } else fail('S_RECORD_INVALID');
    if (changed) s.meta.revision++;
    validateSnapshot(s);
    return { state: s, code: changed ? 'saved' : 'unchanged' };
  } catch (error) { return { state: original, code: error.code ?? 'S_RECORD_INVALID' }; }
}
function sumPoints(s) { return s.ledger.reduce((n, x) => n + (x.status === 'posted' ? BigInt(x.points) : 0n), 0n); }
function metrics(s) {
  const points = sumPoints(s);
  return { progress: s.progress.length, facts: s.dailyFacts.length, claims: s.ledger.length, receipts: s.receipts.length, pending: s.ledger.filter(x => x.status === 'pending').length, points: points <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(points) : points.toString(), checkedIn: s.goals.filter(x => x.achievedAt !== null).length, passed: s.progress.filter(x => x.eventType === 'exercise.passed').length, revision: s.meta.revision, goals: s.goals.length, factDays: [...new Set(s.dailyFacts.map(x => x.localDate))], todayTargets: s.goals.find(x => x.localDate === '2026-10-14')?.targets, tomorrowTargets: s.goals.find(x => x.localDate === '2026-10-15')?.targets, templateTargets: s.settings.goalTemplate?.targets, avatarColor: s.avatar.accentColor, theme: s.settings.theme, achievedAt: s.goals.find(x => x.achievedAt)?.achievedAt };
}
function base(targets = { exercise: 1, lesson: 1, case: 0 }) {
  const s = clone(initial); s.settings.goalTemplate = { revision: 1, targets: clone(targets) }; openDay(s, '2026-10-14'); s.meta.revision = 1; return s;
}
let actions = 0, atomicFailures = 0;
for (const example of fixtures.snapshots) validateSnapshot(example.snapshot);
for (const scenario of vectors.scenarios) {
  let s = base(scenario.targets); const env = makeEnv(), codes = [];
  for (const action of scenario.actions) {
    const before = clone(s), out = transact(s, action, env); actions++; s = out.state; codes.push(out.code);
    if (out.code.startsWith('S_')) { assert.deepEqual(s, before, `${scenario.id}: failed transaction mutated state`); atomicFailures++; }
  }
  if (scenario.expectCodes) assert.deepEqual(codes, scenario.expectCodes, scenario.id);
  for (const [k, value] of Object.entries(scenario.expect ?? {})) assert.deepEqual(metrics(s)[k], value, `${scenario.id}: ${k}`);
}
const env = makeEnv(); env.policy = fixtures.demoPolicy;
let golden = base();
golden = transact(golden, vectors.scenarios[0].actions[0], env).state;
golden = transact(golden, vectors.scenarios[0].actions[1], env).state;
assert.deepEqual(golden, populated, 'independent authored snapshot differs from generated projection');
for (const v of vectors.dateVectors) assert.equal(localDate(v.at, v.timeZone), v.date);
for (const v of vectors.contentVectors) {
  const old = { subjectRef: ref('exercise.c.echo'), learningRevision: v.storedRevision }; old.subjectRef.version = v.storedVersion;
  const current = v.currentVersion === null ? null : { id: 'exercise.c.echo', version: v.currentVersion, learningRevision: v.currentRevision, acceptedPriorVersions: v.accepted };
  assert.equal(compatible(initial, old, current), v.expected, v.id);
}
function pointer(o, p) { return p.slice(1).split('/').reduce((v, k) => v[k], o); }
for (const v of vectors.invalidSnapshots) {
  const s = clone(populated);
  if (v.appendTo) pointer(s, v.appendTo).push(clone(pointer(s, v.copyFrom)));
  else { const parts = v.path.slice(1).split('/'); const name = parts.pop(); let target = s; for (const p of parts) target = target[p]; target[name] = clone(v.value); }
  assert.throws(() => validateSnapshot(s), error => error.code === v.code, v.id);
}
function migrateLegacy(old, failBeforeCommit = false) {
  const original = clone(old);
  try {
    requireRule(old.schemaVersion === '0.9.0', 'S_MIGRATION_UNSUPPORTED');
    exactKeys(old, ['schemaVersion', 'generation', 'timeZone', 'createdAt', 'packageRef', 'theme', 'confirmations', 'passes', 'rewards']);
    const s = clone(initial); Object.assign(s.meta, { generation: old.generation, timeZone: old.timeZone, createdAt: old.createdAt, activePackageRef: clone(old.packageRef), revision: 1 }); s.settings.theme = old.theme;
    for (const [rows, type] of [[old.confirmations, 'lesson.study-confirmed'], [old.passes, 'exercise.passed']]) for (const r of rows) s.progress.push({ eventType: type, result: result[type], subjectRef: clone(r.ref), packageRef: clone(old.packageRef), learningRevision: r.learningRevision, firstAt: r.at, lastAt: r.at });
    for (const r of old.rewards) s.ledger.push({ sourceId: r.sourceId, subjectId: r.subjectId, localDate: localDate(r.at, old.timeZone), occurredAt: r.at, status: 'posted', points: r.points, policyRef: { id: 'legacy.fixture', version: '0.9.0' } });
    validateSnapshot(s); if (failBeforeCommit) fail('S_ABORTED'); return { state: s, code: 'saved' };
  } catch (error) { return { state: original, code: error.code }; }
}
const migrated = migrateLegacy(vectors.legacyFixture);
assert.equal(migrated.code, 'saved'); assert.equal(metrics(migrated.state).points, 12); assert.equal(migrated.state.progress.length, 2); assert.equal(migrated.state.dailyFacts.length, 0); assert.equal(migrated.state.receipts.length, 0); assert.equal(migrated.state.goals.length, 0); assert.equal(migrated.state.meta.generation, vectors.legacyFixture.generation);
assert.deepEqual(migrateLegacy(vectors.legacyFixture, true).state, vectors.legacyFixture);
const unknownLegacy = clone(vectors.legacyFixture); unknownLegacy.schemaVersion = '0.8.0'; assert.equal(migrateLegacy(unknownLegacy).code, 'S_MIGRATION_UNSUPPORTED'); assert.deepEqual(migrateLegacy(unknownLegacy).state, unknownLegacy);
const brokenLegacy = clone(vectors.legacyFixture); brokenLegacy.rewards[0].points = -1; assert.equal(migrateLegacy(brokenLegacy).code, 'S_RECORD_INVALID'); assert.deepEqual(migrateLegacy(brokenLegacy).state, brokenLegacy);

// Synthetic public identity endpoints, not a published CONTENT-01 upgrade.
function migrateIdentity(state, a) {
  const before = clone(state);
  try {
    validateSnapshot(state);
    const s = clone(state);
    requireRule(!s.aliases.some(x => x.fromRef.id === a.fromRef.id || x.toRef.id === a.toRef.id || x.fromRef.id === a.toRef.id));
    requireRule(!s.progress.some(x => x.subjectRef.id === a.toRef.id) && !s.dailyFacts.some(x => x.subjectRef.id === a.toRef.id || x.canonicalSubjectId === a.toRef.id) && !s.ledger.some(x => x.subjectId === a.toRef.id) && !s.receipts.some(x => x.subjectRef.id === a.toRef.id));
    s.aliases.push(clone(a)); canonical(s, a.toRef.id); s.meta.revision++; validateSnapshot(s); return { state: s, code: 'saved' };
  } catch (error) { return { state: before, code: error.code }; }
}
const alias = { fromRef: ref('exercise.c.echo'), toRef: ref('exercise.c.echo-renamed'), fromAcceptedPriorVersions: [], kind: 'exercise', learningRevision: 1, manifestRef: ref('migration.fixture.rename') };
let aliasBase = transact(base(), { op: 'learn', type: 'exercise.passed', id: 'exercise.c.echo', event: 1 }, makeEnv()).state;
const aliased = migrateIdentity(aliasBase, alias); assert.equal(aliased.code, 'saved'); assert.equal(canonical(aliased.state, alias.toRef.id), 'exercise.c.echo'); assert.equal(aliased.state.dailyFacts.length, aliasBase.dailyFacts.length); assert.deepEqual(aliased.state.ledger, aliasBase.ledger); assert.deepEqual(aliased.state.progress, aliasBase.progress);
assert.equal(compatible(aliased.state, aliasBase.progress[0], { id: alias.toRef.id, version: '1.0.0', learningRevision: 1, acceptedPriorVersions: [] }), true);
const undeclared = clone(aliasBase.progress[0]); undeclared.subjectRef.version = '0.9.0'; assert.equal(compatible(aliased.state, undeclared, { id: alias.toRef.id, version: '1.0.0', learningRevision: 1, acceptedPriorVersions: [] }), false);
const newSideOnly = clone(initial); newSideOnly.ledger.push({ sourceId: 'reward.exercise.first-pass', subjectId: alias.toRef.id, occurredAt: '2026-10-13T16:00:00.000Z', localDate: '2026-10-14', status: 'pending', points: null, policyRef: null }); const denied = migrateIdentity(newSideOnly, alias); assert.equal(denied.code, 'S_RECORD_INVALID'); assert.deepEqual(denied.state, newSideOnly);
const cyclic = { ...clone(alias), fromRef: alias.toRef, toRef: alias.fromRef }; const cycleResult = migrateIdentity(aliased.state, cyclic); assert.equal(cycleResult.code, 'S_RECORD_INVALID'); assert.deepEqual(cycleResult.state, aliased.state);

const renamedEnv = makeEnv(); const renamedExercise = renamedEnv.entities.find(e => e.id === alias.fromRef.id); renamedExercise.id = alias.toRef.id;
for (const lesson of renamedEnv.lessons) for (const required of lesson.requiredExerciseRefs) if (required.id === alias.fromRef.id) required.id = alias.toRef.id;
const renamedLearn = transact(aliased.state, { op: 'learn', type: 'exercise.passed', id: alias.toRef.id, event: 2 }, renamedEnv);
assert.equal(renamedLearn.code, 'saved'); assert.equal(renamedLearn.state.ledger.length, 1); assert.equal(renamedLearn.state.dailyFacts.length, 1); assert.equal(renamedLearn.state.ledger[0].subjectId, alias.fromRef.id);
assert.equal(sumPoints({ ledger: [{ status: 'posted', points: Number.MAX_SAFE_INTEGER }, { status: 'posted', points: Number.MAX_SAFE_INTEGER }] }).toString(), '18014398509481982');
const clearAfterCommit = transact(base(), { op: 'learn', type: 'exercise.passed', id: 'exercise.c.echo', event: 1 }, makeEnv());
const dbAfterClear = transact(clearAfterCommit.state, { op: 'clear' }, makeEnv()).state;
assert.notEqual(dbAfterClear.meta.generation, clearAfterCommit.state.meta.generation, 'late ACK must compare fresh database meta, not cached state');

let extraReceiptChecks = 0;
const passAction = { op: 'learn', type: 'exercise.passed', id: 'exercise.c.echo', event: 1 };
const savedPass = transact(base(), passAction, makeEnv()).state;
for (const changed of [{ packageRef: { id: 'content.c.p0', version: '1.0.1' } }, { result: 'failed' }, { at: '2026-10-13T16:01:00.000Z' }, { id: 'exercise.c.two-x-plus-three' }]) {
  const out = transact(savedPass, { ...passAction, ...changed }, makeEnv()); assert.equal(out.code, 'S_EVENT_ID_REUSED'); assert.deepEqual(out.state, savedPass); extraReceiptChecks++;
}
const attemptAction = { op: 'learn', type: 'exercise.attempt-evaluated', id: 'exercise.c.echo', event: 1, category: 'program-error' };
const savedAttempt = transact(base(), attemptAction, makeEnv()).state;
const changedCase = transact(savedAttempt, { ...attemptAction, failedCaseKey: 'other' }, makeEnv()); assert.equal(changedCase.code, 'S_EVENT_ID_REUSED'); assert.deepEqual(changedCase.state, savedAttempt); extraReceiptChecks++;
const future = clone(base()); future.meta.schemaVersion = '2.0.0'; const futureOut = transact(future, passAction, makeEnv()); assert.equal(futureOut.code, 'S_VERSION_UNKNOWN'); assert.deepEqual(futureOut.state, future);
const missing = transact(null, passAction, makeEnv()); assert.equal(missing.code, 'S_RECORD_INVALID'); assert.equal(missing.state, null, 'missing DB cannot be initialized by an old learning command');
const unconfigured = clone(initial); openDay(unconfigured, '2026-10-14'); unconfigured.meta.revision = 1;
const noGoal = transact(unconfigured, passAction, makeEnv()); assert.equal(noGoal.code, 'saved'); assert.equal(noGoal.state.goals[0].achievedAt, null); assert.equal(noGoal.state.ledger.some(x => x.sourceId === 'reward.daily-goal.once'), false);

console.log(JSON.stringify({ snapshots: fixtures.snapshots.length, scenarios: vectors.scenarios.length, actions, atomicFailures, goldenProjection: 'matched', invalidSnapshots: vectors.invalidSnapshots.length, dateVectors: vectors.dateVectors.length, contentVectors: vectors.contentVectors.length, migrationChecks: 4, aliasChecks: 6, extraReceiptChecks, readonlyAndNullGoalChecks: 3, exactBigIntSum: '18014398509481982', lateAckGeneration: 'invalidated', limitation: 'Finite synthetic in-memory model only; no IndexedDB/Rust/Worker/browser persistence.' }, null, 2));
