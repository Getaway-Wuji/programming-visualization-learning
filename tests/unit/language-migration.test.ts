import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import {
  availableMigrationLesson,
  initialTeachingState,
  languageIds,
  languageInfo,
  migrationContent,
  teachingReducer,
} from '../../web/src/language-migration/model';
import type { CourseReading } from '../../web/src/content/reading';

it('closed content rejects unknown authority, invalid references, incomplete language pairs and unsafe annotation ranges', () => {
  const script = `import{validateLanguageMigration}from'./scripts/language-migration-content.mjs';import{readFileSync}from'node:fs';const v=JSON.parse(readFileSync('content/advanced/language-migration-1.0.0.json'));validateLanguageMigration();let n=0;for(const edit of[v=>v.learningAuthority=true,v=>v.version='2',v=>v.languages[0].sourceRefs[0].url='https://example.com',v=>v.languages[0].defaultTarget='c',v=>v.languageOrder.reverse(),v=>delete v.topics[0].snippets.java,v=>v.topics.pop(),v=>v.topics[0].id='functions',v=>v.topics[0].lessonRef.version='1.1.0',v=>v.topics[0].knowledgeRefs=[],v=>v.topics[0].snippets.c.steps[0].lines=[24],v=>v.topics[0].snippets.c.code='x'.repeat(121),v=>v.topics[0].snippets.c.code=Array(25).fill('x').join(String.fromCharCode(10)),v=>v.topics[0].snippets.c.steps[0].lines=[1,1]]){const c=structuredClone(v);edit(c);try{validateLanguageMigration(c)}catch{n++}}if(n!==14)throw Error('invalid static content accepted:'+n);`;
  expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', script])).not.toThrow();
});
for (const known of languageIds)
  it(`existing ${known} changes the actual bridge, default target and resets the teaching cursor`, () => {
    const state = teachingReducer(
      { ...initialTeachingState, cursor: 2, playing: true },
      { type: 'known', value: known },
    );
    expect(state.known).toBe(known);
    expect(state.target).toBe(languageInfo(known).defaultTarget);
    expect(state.target).not.toBe(known);
    expect(state).toMatchObject({ cursor: 0, playing: false, generation: 1 });
    expect(new Set(migrationContent.languages.map((l) => l.bridge)).size).toBe(4);
  });
for (const known of languageIds)
  for (const target of languageIds.filter((id) => id !== known))
    it(`ordered reading pair ${known} to ${target} has six distinct, complete snippets and no evaluator`, () => {
      const a = teachingReducer(initialTeachingState, { type: 'known', value: known });
      const b = teachingReducer(a, { type: 'target', value: target });
      expect(b).toMatchObject({ known, target, cursor: 0, playing: false });
      for (const topic of migrationContent.topics) {
        expect(topic.snippets[known].steps).toHaveLength(3);
        expect(topic.snippets[target].steps).toHaveLength(3);
        expect(topic.snippets[known].context).not.toBe(topic.snippets[target].context);
      }
    });
it('manual traversal clamps both boundaries, pauses, and reset preserves current choices', () => {
  let state = teachingReducer(initialTeachingState, { type: 'known', value: 'python' });
  state = teachingReducer(state, { type: 'topic', value: 'arrays' });
  state = teachingReducer(state, { type: 'step', delta: -1 });
  expect(state.cursor).toBe(0);
  for (let i = 0; i < 8; i++) state = teachingReducer(state, { type: 'step', delta: 1 });
  expect(state.cursor).toBe(3);
  state = teachingReducer(state, { type: 'reset' });
  expect(state).toMatchObject({
    known: 'python',
    target: 'java',
    topic: 'arrays',
    cursor: 0,
    playing: false,
  });
});
it('explicit playback reaches the third annotation, stops and starts a replay from zero', () => {
  let state = teachingReducer(initialTeachingState, { type: 'play' });
  for (let i = 0; i < 3; i++)
    state = teachingReducer(state, { type: 'tick', generation: state.generation });
  expect(state).toMatchObject({ cursor: 3, playing: false });
  expect(teachingReducer(state, { type: 'tick', generation: state.generation })).toBe(state);
  expect(teachingReducer(state, { type: 'play' })).toMatchObject({ cursor: 0, playing: true });
});
it('switching, manual movement, reset and pause revoke already queued ticks', () => {
  const old = teachingReducer(initialTeachingState, { type: 'play' });
  for (const action of [
    { type: 'known', value: 'java' },
    { type: 'target', value: 'python' },
    { type: 'topic', value: 'strings' },
    { type: 'step', delta: 1 },
    { type: 'reset' },
    { type: 'pause' },
  ] as const) {
    const next = teachingReducer(old, action);
    expect(teachingReducer(next, { type: 'tick', generation: old.generation })).toBe(next);
  }
});
it('unknown selections and same-language targets are rejected without changing cursor or identity', () => {
  for (const action of [
    { type: 'known', value: 'rust' },
    { type: 'target', value: 'c' },
    { type: 'target', value: null },
    { type: 'topic', value: '../fake' },
  ] as const)
    expect(teachingReducer(initialTeachingState, action)).toBe(initialTeachingState);
});
it('state transitions leave initial state and original content immutable', () => {
  const before = JSON.stringify(migrationContent),
    initial = structuredClone(initialTeachingState);
  let state = initialTeachingState;
  for (const id of languageIds) {
    state = teachingReducer(state, { type: 'known', value: id });
    state = teachingReducer(state, { type: 'play' });
    state = teachingReducer(state, { type: 'tick', generation: state.generation });
  }
  expect(initialTeachingState).toEqual(initial);
  expect(JSON.stringify(migrationContent)).toBe(before);
});
const base = JSON.parse(readFileSync('content/c/p05/course-1.0.0.json', 'utf8'));
const reading = { ...base, packageRef: migrationContent.packageRef } as CourseReading;
it('all six preparation links resolve exact original lessons, knowledge and required exercises', () => {
  for (const topic of migrationContent.topics)
    expect(availableMigrationLesson(topic, reading)).toMatchObject(topic.lessonRef);
});
it('foreign package, changed lesson or knowledge versions and missing exercises cannot authorize preparation links', () => {
  const topic = migrationContent.topics[0];
  expect(availableMigrationLesson(topic, null)).toBeNull();
  for (const edit of [
    (v: CourseReading) => {
      (v.packageRef as { version: string }).version = '9';
    },
    (v: CourseReading) => {
      (v.lessons.find((l) => l.id === topic.lessonRef.id)! as { version: string }).version = '9';
    },
    (v: CourseReading) => {
      (
        v.knowledgePoints.find((k) => k.id === topic.knowledgeRefs[0].id)! as { version: string }
      ).version = '9';
    },
    (v: CourseReading) => {
      (v as { exercises: CourseReading['exercises'] }).exercises = [];
    },
  ]) {
    const copy = structuredClone(reading);
    edit(copy);
    expect(availableMigrationLesson(topic, copy)).toBeNull();
  }
});
