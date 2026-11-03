import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { expect, it } from 'vitest';
import { createC6ResetMeta } from '../../web/src/storage/c6-reset';
import { createMeta, emptySnapshot } from '../../web/src/storage/model';
import {
  assertRecord,
  assertSnapshot,
  isLocalDate,
  isUtcTime,
  isUuid,
} from '../../web/src/storage/validation';
import { c6RewardGroups } from '../../web/src/c6-learning/rewards.generated';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat('uuid', isUuid);
ajv.addFormat('date-time', isUtcTime);
ajv.addFormat('date', isLocalDate);
const current = ajv.compile(load('shared/contracts/21.5-存档结构10.0.0.schema.json'));
const legacy = ajv.compile(load('shared/contracts/19.1-存档结构9.0.0.schema.json'));
const learning = ajv.compile(load('shared/contracts/21.5-学习事件2.0.0.schema.json'));
const snapshot = ajv.compile(load('shared/contracts/21.5-C6当前快照2.0.0.schema.json'));
const generation = '00000000-0000-4000-8000-000000000021',
  at = '2026-11-03T00:00:00.000Z';

it('recognizes only registered nonempty topic reward ownership and never grants legacy or unproven rights', () => {
  for (const group of c6RewardGroups.filter((g) => g.lessonSubjectId.startsWith('reward.c6.'))) {
    for (const kind of ['lesson', 'exercise'] as const) {
      const entry = {
        sourceId:
          kind === 'lesson' ? 'reward.lesson.first-completion' : 'reward.exercise.first-pass',
        subjectId: kind === 'lesson' ? group.lessonSubjectId : group.exerciseSubjectId,
        localDate: '2026-11-03',
        occurredAt: at,
        status: 'pending',
        points: null,
        policyRef: null,
      };
      if (!(kind === 'lesson' ? group.lessonIds.length : group.exerciseIds.length)) {
        expect(() => assertRecord('ledger', entry)).toThrow();
        continue;
      }
      expect(() => assertRecord('ledger', entry)).not.toThrow();
      expect(() =>
        assertRecord('ledger', { ...entry, subjectId: entry.subjectId + '.unknown' }),
      ).toThrow();
      expect(() =>
        assertRecord('ledger', { ...entry, sourceId: 'reward.case.first-view' }),
      ).toThrow();
      const fresh = emptySnapshot(createC6ResetMeta(generation, 'Asia/Shanghai', at));
      fresh.ledger.push(entry as never);
      expect(
        current({ snapshot: fresh, rows: { activities: [], drafts: [] } }),
        JSON.stringify(current.errors),
      ).toBe(true);
      expect(() => assertSnapshot(fresh)).toThrow();
      const old = emptySnapshot(
        createMeta({
          generation,
          timeZone: 'Asia/Shanghai',
          createdAt: at,
          activePackageRef: { id: 'content.c.p0', version: '1.0.0' },
        }),
      );
      old.ledger.push({
        ...entry,
        status: 'posted',
        points: kind === 'lesson' ? 20 : 10,
        policyRef: { id: 'legacy.fixture', version: '0.9.0' },
      } as never);
      expect(() => assertSnapshot(old)).toThrow();
    }
  }
});

it('keeps SAVE9 and SAVE10 structural entry points separate', () => {
  const state = {
    snapshot: emptySnapshot(createC6ResetMeta(generation, 'Asia/Shanghai', at)),
    rows: { activities: [], drafts: [] },
  };
  expect(current(state), JSON.stringify(current.errors)).toBe(true);
  expect(legacy(state.snapshot)).toBe(false);
  const old = emptySnapshot(
    createMeta({
      generation,
      timeZone: 'Asia/Shanghai',
      createdAt: at,
      activePackageRef: { id: 'content.c.p0', version: '1.0.0' },
    }),
  );
  expect(legacy(old)).toBe(true);
  expect(current({ ...state, snapshot: old })).toBe(false);
  expect(current({ ...state, extra: true })).toBe(false);
});
it('requires the explicit LEARN2 envelope and exact new course ownership', () => {
  const command = {
    learnVersion: '2.0.0',
    generation,
    receipt: {
      eventId: crypto.randomUUID(),
      eventType: 'lesson.study-confirmed',
      subjectRef: { id: 'lesson.c6.s2.1', version: '2.0.0' },
      packageRef: { id: 'content.c.primer6', version: '2.0.0' },
      learningRevision: 1,
      result: 'confirmed',
      goalVersion: 1,
      occurredAt: at,
      localDate: '2026-11-03',
    },
  };
  expect(learning(command), JSON.stringify(learning.errors)).toBe(true);
  expect(learning({ ...command, learnVersion: '1.0.0' })).toBe(false);
  const old = structuredClone(command);
  old.receipt.subjectRef.version = '1.0.0';
  expect(learning(old)).toBe(false);
  const reference = structuredClone(command);
  reference.receipt.subjectRef.id = 'node.c6.appB';
  expect(learning(reference)).toBe(false);
});
it('the new snapshot schema compiles with the frozen typed state and rejects an old-format DTO', () => {
  expect(snapshot({ formatId: 'urn:c-viz:current-snapshot:1.0.0', formatVersion: '1.0.0' })).toBe(
    false,
  );
});
