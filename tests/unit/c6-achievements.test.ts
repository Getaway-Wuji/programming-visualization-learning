import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  c6AchievementCatalog,
  assertAchievement,
  mergeAchievements,
  type AchievementEvidence,
} from '../../web/src/achievements/model';
import { isUuid, isUtcTime } from '../../web/src/storage/validation';

it('new badge references never inherit a removed exercise or an old record; exact new evidence is idempotent', () => {
  const generation = crypto.randomUUID(),
    at = '2026-11-03T00:00:00.000Z';
  const old: AchievementEvidence = {
    kind: 'exercise',
    eventId: crypto.randomUUID(),
    subjectRef: { id: 'exercise.c.bubble-sort', version: '1.0.0' },
    learningRevision: 1,
    occurredAt: at,
  };
  expect(mergeAchievements([], [old], generation, c6AchievementCatalog)).toEqual([]);
  const current = {
    ...old,
    eventId: crypto.randomUUID(),
    subjectRef: { id: 'exercise.c6.s10.1.1', version: '2.0.0' },
  };
  const rows = mergeAchievements([], [current], generation, c6AchievementCatalog);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    achievementVersion: '2.0.0',
    unlockedAt: at,
    badgeRef: { id: 'badge.c6.array-initialization-pass', version: '2.0.0' },
  });
  expect(mergeAchievements(rows, [current], generation, c6AchievementCatalog)).toEqual(rows);
  expect(() => assertAchievement(rows[0])).toThrow();
  expect(() =>
    assertAchievement({ ...rows[0], achievementVersion: '1.0.0' }, c6AchievementCatalog),
  ).toThrow();
  const ajv = new Ajv2020({ strict: false });
  ajv.addFormat('uuid', isUuid);
  ajv.addFormat('date-time', isUtcTime);
  const validate = ajv.compile(
    JSON.parse(readFileSync('shared/contracts/21.5-成就记录2.0.0.schema.json', 'utf8')),
  );
  expect(validate(rows[0]), JSON.stringify(validate.errors)).toBe(true);
  expect(validate({ ...rows[0], achievementVersion: '1.0.0' })).toBe(false);
});
