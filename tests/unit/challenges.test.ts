import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { caseExecutionCatalog } from '../../web/src/content/case-learning';
import { caseRequest, acceptedCaseRequest } from '../../web/src/engine/execution-client';
import { decodeResult, encodeRequest } from '../../web/src/engine/protocol';
import { initSync, execute_request, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { engineBuild } from '../../web/src/generated/engine-build';
import {
  challengeQuestions,
  questionsForTrace,
  challengeSource,
} from '../../web/src/challenges/content';
import {
  createChallengeSession,
  readChallengeFact,
  type ChallengeFact,
} from '../../web/src/challenges/authority';
import {
  prepareChallengeAnswer,
  type ChallengeReceiptSummary,
} from '../../web/src/challenges/domain';
import { explainStep } from '../../web/src/challenges/explanation';
import { PlayerModel } from '../../web/src/player/model';
import { PlayerController } from '../../web/src/player/controller';
import {
  createMeta,
  emptySnapshot,
  recordKey,
  STORE_NAMES,
  type StorageSnapshot,
} from '../../web/src/storage/model';
import { validateSnapshot, validateRecord } from '../../web/src/storage/validation';
import { inspectRecoveryRows, type RawStorageRows } from '../../web/src/storage/recovery';
import { upgradeV6Meta } from '../../web/src/storage/v6-migration';
import { deriveLearningLevel, loadProfileConfiguration } from '../../web/src/learning/profile';

const at = '2026-10-31T03:00:00.000Z';
function archive() {
  const s = emptySnapshot(
    createMeta({
      generation: '16100000-0000-4000-8000-000000000001',
      timeZone: 'Asia/Shanghai',
      createdAt: at,
      activePackageRef: { id: 'content.c.p05', version: '1.0.0' },
    }),
  );
  s.goals.push({ localDate: '2026-10-31', goalVersion: 1, targets: null, achievedAt: null });
  return s;
}
function receipt(correct = true, index = 1): ChallengeReceiptSummary {
  const q = challengeQuestions[0];
  return {
    eventContractVersion: '1.1.0',
    eventType: 'challenge.answered',
    subjectRef: { ...q.ref },
    packageRef: { id: 'content.challenge.c', version: '1.0.0' },
    learningRevision: 1,
    result: correct ? 'correct' : 'incorrect',
    answerKind: correct ? q.anchorKind : q.choices.find((k) => k !== q.anchorKind)!,
    eventId: `16100000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    occurredAt: at,
    localDate: '2026-10-31',
    goalVersion: 1,
  };
}
function apply(s: StorageSnapshot, r: ChallengeReceiptSummary) {
  const operations = prepareChallengeAnswer(s, r);
  for (const op of operations) if (op.store === 'ledger') s.ledger.push(op.value);
  s.receipts.push({ ...r, committedRevision: ++s.meta.revision });
  return operations;
}
async function run(id: string, values?: Record<string, number | number[]>) {
  const c = caseExecutionCatalog(id)!;
  const input = values ?? c.program.exampleInput;
  const prepared = JSON.parse(
    new TextDecoder().decode(
      prepare_input(
        JSON.stringify(c),
        new TextEncoder().encode(
          JSON.stringify(
            Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))),
          ),
        ),
        1000,
      ),
    ),
  );
  const req = caseRequest(
    c,
    prepared.source,
    { contextId: id, contextRevision: 1, sourceRevision: 1 },
    { values: input, random: null },
  );
  const bytes = execute_request(
    encodeRequest(req),
    JSON.stringify(c),
    engineBuild.wasmSha256,
    1000,
  ).slice();
  return { c, req, result: await decodeResult(bytes.buffer, req) };
}

describe('16.1 true trace teaching and closed first-answer accounting', () => {
  beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));
  it('has exactly seven reviewed C cases, three stable independent questions and three exclusive options each', () => {
    expect(challengeQuestions).toHaveLength(21);
    expect(new Set(challengeQuestions.map((q) => q.ref.id)).size).toBe(21);
    const cases = new Set(challengeQuestions.map((q) => q.caseId));
    expect(cases.size).toBe(7);
    for (const id of cases) {
      expect(caseExecutionCatalog(id)?.program.languageRef.id).toBe('lang.c');
      expect(challengeQuestions.filter((q) => q.caseId === id)).toHaveLength(3);
    }
    for (const q of challengeQuestions) {
      expect(new Set(q.choices).size).toBe(3);
      expect(q.choices.filter((k) => k === q.anchorKind)).toHaveLength(1);
    }
  });
  for (const id of [...new Set(challengeQuestions.map((q) => q.caseId))])
    it(`reads all explanations and three anchors from the actual Rust run: ${id}`, async () => {
      const { c, req, result } = await run(id);
      expect(result.terminal.status).toBe('completed');
      const trace = result.trace!;
      const qs = questionsForTrace(id, trace.steps);
      expect(qs).toHaveLength(3);
      for (const q of qs) expect(trace.steps[q.cursor].kind).toBe(q.question.anchorKind);
      const p = new PlayerModel();
      p.acceptValidated(p.begin(result.identity), result);
      const start = structuredClone(p.snapshot());
      for (let i = 1; i <= trace.steps.length; i++) {
        expect(explainStep(trace.steps[i - 1], result, req.source.text)[0]).not.toContain(
          'undefined',
        );
        p.seek(i);
      }
      for (let i = trace.steps.length - 1; i >= 0; i--) p.seek(i);
      expect(p.snapshot().state).toEqual(start.state);
      expect(acceptedCaseRequest(result)).toBeNull();
      expect(() => createChallengeSession(c, result, () => true)).toThrow('S_CONTENT_INCOMPATIBLE');
    });
  it('keeps zero-loop and empty-array anchors based on actual Rust steps', async () => {
    for (const [id, values] of [
      ['case.c.loops', { n: 0 }],
      ['case.c.array-traversal', { values: [] }],
      ['case.c.bubble-sort', { values: [] }],
      ['case.c.selection-sort', { values: [] }],
      ['case.c.binary-search-first', { values: [], target: 0 }],
    ] as const) {
      const { result } = await run(id, values as Record<string, number | number[]>);
      expect(result.terminal.status).toBe('completed');
      expect(questionsForTrace(id, result.trace!.steps)).toHaveLength(3);
    }
    expect(questionsForTrace('case.c.assignment', [])).toEqual([]);
  });
  it('does not accept object literals as answer facts', () =>
    expect(() => readChallengeFact({} as ChallengeFact)).toThrow());
  it.each([true, false])(
    'atomically relates a signed first answer and its minimal receipt: correct=%s',
    (correct) => {
      const s = archive();
      apply(s, receipt(correct));
      expect(validateSnapshot(s)).toBe(true);
      expect(s.ledger[0].points).toBe(correct ? 2 : -1);
      expect(s.progress).toEqual([]);
      expect(s.dailyFacts).toEqual([]);
      expect(s.goals[0].achievedAt).toBeNull();
      const bad = structuredClone(s);
      bad.receipts = [];
      expect(validateSnapshot(bad)).toBe(false);
      const altered = structuredClone(s);
      altered.ledger[0].points = correct ? -1 : 2;
      expect(validateSnapshot(altered)).toBe(false);
    },
  );
  it('cannot replace a wrong first answer by replay, new run, new event or date', () => {
    const s = archive();
    apply(s, receipt(false));
    const before = structuredClone(s.ledger);
    expect(apply(s, receipt(true, 2))).toEqual([]);
    expect(s.ledger).toEqual(before);
    expect(s.receipts).toHaveLength(2);
    expect(validateSnapshot(s)).toBe(true);
    const leaked = { ...s.receipts[0], source: 'secret' };
    expect(validateRecord('receipts', leaked)).toBe(false);
    expect(validateRecord('ledger', { ...s.ledger[0], points: -2 })).toBe(false);
    expect(
      validateRecord('ledger', {
        ...s.ledger[0],
        status: 'pending',
        points: null,
        policyRef: null,
      }),
    ).toBe(false);
  });
  it('isolates unrelated damage without losing a valid signed challenge bundle', () => {
    const s = archive();
    apply(s, receipt(false));
    const raw = Object.fromEntries(
      STORE_NAMES.map((name) => {
        const rows = Array.isArray(s[name]) ? s[name] : [s[name]];
        return [
          name,
          {
            values: structuredClone(rows),
            keys: rows.map((value) => recordKey(name, s.meta.generation, value as never)),
          },
        ];
      }),
    ) as RawStorageRows;
    raw.avatar.values = [{ bad: true }];
    const recovery = inspectRecoveryRows(raw, (a, b) =>
      JSON.stringify(a) === JSON.stringify(b) ? 0 : 1,
    );
    expect(recovery.snapshot?.ledger.filter((e) => e.sourceId === challengeSource)).toHaveLength(1);
    expect(recovery.snapshot?.receipts).toHaveLength(1);
    expect(recovery.ledgerUncertain).toBe(false);
    expect(recovery.writable).toBe(false);
  });
  it('upgrades only valid SAVE6 meta and refuses unknown/future versions', () => {
    const s = archive();
    const old = { ...s.meta, schemaVersion: '6.0.0', dbVersion: 6 };
    const upgraded = upgradeV6Meta(old);
    expect(upgraded).toEqual({ ...old, schemaVersion: '8.0.0', dbVersion: 8, revision: 1 });
    expect(upgradeV6Meta({ ...old, extra: 'private' })).toBeNull();
    expect(() => upgradeV6Meta({ ...old, schemaVersion: '8.0.0' })).toThrow('S_VERSION_UNKNOWN');
  });
  it('shows a negative net balance at the lowest level without hiding its debt', async () => {
    const c = await loadProfileConfiguration();
    const level = deriveLearningLevel('-1', c);
    expect(level.progressPercent).toBe(0);
    expect(level.remainingPoints).toBe(String(BigInt(c.levels[1].minimumPoints) + 1n));
  });
  it('uses one reversible player with a guard before the predicted step', async () => {
    const { result } = await run('case.c.assignment');
    const p = new PlayerController();
    p.acceptValidated(p.begin(result.identity), result);
    p.seek(2);
    const before = structuredClone(p.getSnapshot().view.state);
    p.setAdvanceGuard((v) => v.cursor !== 2);
    p.step(1);
    p.play();
    expect(p.getSnapshot().view.cursor).toBe(2);
    p.step(-1);
    p.step(1);
    expect(p.getSnapshot().view.state).toEqual(before);
    p.setAdvanceGuard();
    p.step(1);
    expect(p.getSnapshot().view.cursor).toBe(3);
    p.invalidate();
    expect(p.getSnapshot().view.cursor).toBeNull();
  });
});
