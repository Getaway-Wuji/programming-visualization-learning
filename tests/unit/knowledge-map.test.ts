import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeMap,
  projectKnowledgeMap,
  knowledgeMapConfiguration,
} from '../../web/src/knowledge/model';
import type { CourseReading } from '../../web/src/content/reading';
import type { ContentPackage } from '../../web/src/content/types';
import type { LearningCatalog } from '../../web/src/learning/types';
import { emptySnapshot, createMeta, type Progress } from '../../web/src/storage/model';

const course = JSON.parse(
  readFileSync('content/c/p05/course-1.0.0.json', 'utf8'),
) as ContentPackage;
const original = JSON.parse(
  readFileSync('web/public/content/reading/course-reading-1.0.0.json', 'utf8'),
) as CourseReading;
const reading: CourseReading = {
  ...original,
  sourceSha256: createHash('sha256')
    .update(readFileSync('content/c/p05/course-1.0.0.json'))
    .digest('hex'),
  packageRef: { id: course.packageId, version: course.packageVersion },
  chapters: course.chapters,
  lessons: course.lessons,
  knowledgePoints: course.knowledgePoints,
  catalog: {
    purpose: 'course-practice',
    packageRef: { id: course.packageId, version: course.packageVersion },
    lessons: course.lessons.map((lesson) => ({
      ref: { id: lesson.id, version: lesson.version },
      learningRevision: lesson.learningRevision,
      acceptedPriorVersions: lesson.acceptedPriorVersions,
      requiredExerciseRefs: lesson.requiredExerciseRefs,
    })),
    exercises: [],
    cases: [],
  } as LearningCatalog,
};
const map = createKnowledgeMap(reading);
const snapshot = () =>
  emptySnapshot(
    createMeta({
      generation: crypto.randomUUID(),
      timeZone: 'Asia/Shanghai',
      createdAt: '2026-10-31T01:00:00.000Z',
      activePackageRef: reading.packageRef,
    }),
  );
const completion = (id = 'lesson.c.variables-output'): Progress => {
  const lesson = course.lessons.find((lesson) => lesson.id === id)!;
  return {
    eventType: 'lesson.completed',
    result: 'completed',
    subjectRef: { id, version: lesson.version },
    learningRevision: lesson.learningRevision,
    packageRef: reading.packageRef,
    firstAt: '2026-10-31T01:00:00.000Z',
    lastAt: '2026-10-31T01:00:00.000Z',
  };
};
const litIds = (value: ReturnType<typeof projectKnowledgeMap>) =>
  value.nodes
    .filter((node) => node.state === 'lit')
    .map((node) => node.knowledge.id)
    .sort();

describe('15.1 course-constrained knowledge graph and durable facts', () => {
  it('uses all ten exact course nodes and eleven directed prerequisites in both reviewed courses', () => {
    for (const current of [reading, original]) {
      const graph = createKnowledgeMap(current);
      expect(graph.nodes).toHaveLength(10);
      expect(graph.edges).toHaveLength(11);
      expect(graph.edges).toEqual(
        expect.arrayContaining(
          current.knowledgePoints.flatMap((node) =>
            node.prerequisiteRefs.map((ref) => ({ from: ref.id, to: node.id })),
          ),
        ),
      );
      for (const node of graph.nodes)
        expect(node.lessons.map((lesson) => lesson.id)).toEqual(
          current.chapters
            .flatMap((chapter) => chapter.lessonRefs)
            .map((ref) => current.lessons.find((lesson) => lesson.id === ref.id)!)
            .filter((lesson) => lesson.knowledgeRefs.some((ref) => ref.id === node.knowledge.id))
            .map((lesson) => lesson.id),
        );
    }
  });
  it.each([
    'source',
    'missing',
    'version',
    'duplicate',
    'cycle',
    'foreign-language',
    'orphan-lesson',
    'unknown-lesson-knowledge',
    'duplicate-edge',
    'self-edge',
  ])('rejects %s rather than inventing a relation or broken destination', (kind) => {
    const value = structuredClone(reading);
    const config = structuredClone(knowledgeMapConfiguration);
    if (kind === 'source') Object.assign(value, { sourceSha256: '0'.repeat(64) });
    if (kind === 'missing') (value.knowledgePoints as unknown[]).pop();
    if (kind === 'version') Object.assign(config.nodes[0].knowledgeRef, { version: '9.0.0' });
    if (kind === 'duplicate') config.nodes[0] = config.nodes[1];
    if (kind === 'cycle')
      (value.knowledgePoints[0].prerequisiteRefs as unknown[]).push({
        id: 'knowledge.c.binary-search',
        version: '1.0.0',
      });
    if (kind === 'foreign-language')
      Object.assign(value.knowledgePoints[1], {
        languageRef: { id: 'lang.cpp', version: '1.0.0' },
      });
    if (kind === 'orphan-lesson') (value.chapters[0].lessonRefs as unknown[]).pop();
    if (kind === 'unknown-lesson-knowledge')
      (value.lessons[0].knowledgeRefs as unknown[]).push({
        id: 'knowledge.c.missing',
        version: '1.0.0',
      });
    if (kind === 'duplicate-edge')
      (value.knowledgePoints[1].prerequisiteRefs as unknown[]).push(
        value.knowledgePoints[1].prerequisiteRefs[0],
      );
    if (kind === 'self-edge')
      (value.knowledgePoints[0].prerequisiteRefs as unknown[]).push({
        id: value.knowledgePoints[0].id,
        version: value.knowledgePoints[0].version,
      });
    expect(() => createKnowledgeMap(value, config)).toThrow('KNOWLEDGE_MAP_INVALID');
  });
  it('separates an empty durable archive, unavailable archive and uncertain recovery', () => {
    expect(
      projectKnowledgeMap(map, snapshot(), reading.catalog).nodes.every(
        (node) => node.state === 'unlearned',
      ),
    ).toBe(true);
    expect(
      projectKnowledgeMap(map, null, reading.catalog).nodes.every(
        (node) => node.state === 'unknown',
      ),
    ).toBe(true);
    const uncertain = projectKnowledgeMap(map, snapshot(), reading.catalog, true);
    expect(uncertain.known).toBe(false);
    expect(uncertain.nodes.every((node) => node.state === 'unknown')).toBe(true);
  });
  it('never substitutes started, confirmed, passed or a reconstructed completion for the actual saved completion event', () => {
    const value = snapshot();
    const done = completion();
    value.progress.push(
      { ...done, eventType: 'lesson.started', result: 'started' },
      { ...done, eventType: 'lesson.study-confirmed', result: 'confirmed' },
      {
        ...done,
        eventType: 'exercise.passed',
        result: 'passed',
        subjectRef: course.lessons[1].requiredExerciseRefs[0],
      },
    );
    expect(litIds(projectKnowledgeMap(map, value, reading.catalog))).toEqual([]);
    value.progress.push(done);
    const before = JSON.stringify(value);
    const view = projectKnowledgeMap(map, value, reading.catalog);
    expect(litIds(view)).toEqual([
      'knowledge.c.entry',
      'knowledge.c.input',
      'knowledge.c.output',
      'knowledge.c.variables',
    ]);
    expect(view.edges.filter((edge) => edge.lit)).toHaveLength(3);
    expect(
      view.nodes.find((node) => node.knowledge.id === 'knowledge.c.variables')!.completed,
    ).toHaveLength(1);
    expect(JSON.stringify(value)).toBe(before);
  });
  it('does not infer prerequisite completion backwards from a downstream completed lesson', () => {
    const value = snapshot();
    value.progress.push(completion('lesson.c.first-program'));
    const view = projectKnowledgeMap(map, value, reading.catalog);
    expect(litIds(view)).toEqual(['knowledge.c.entry', 'knowledge.c.output']);
    expect(view.edges.some((edge) => edge.lit)).toBe(false);
  });
  it.each(['foreign-package', 'unknown-version', 'different-revision'])(
    'preserves but does not light %s completion',
    (kind) => {
      const value = snapshot();
      const done = completion();
      if (kind === 'foreign-package')
        done.packageRef = { id: 'content.c.foreign', version: '1.0.0' };
      if (kind === 'unknown-version') done.subjectRef.version = '8.0.0';
      if (kind === 'different-revision') done.learningRevision = 2;
      value.progress.push(done);
      const before = JSON.stringify(value);
      expect(litIds(projectKnowledgeMap(map, value, reading.catalog))).toEqual([]);
      expect(JSON.stringify(value)).toBe(before);
    },
  );
  it('accepts explicitly reviewed original-course completion after upgrade and clears all light with a new empty generation', () => {
    const value = snapshot();
    const done = completion();
    done.subjectRef.version = '1.0.1';
    done.packageRef = original.packageRef;
    value.progress.push(done);
    expect(litIds(projectKnowledgeMap(map, value, reading.catalog))).toHaveLength(4);
    expect(litIds(projectKnowledgeMap(map, snapshot(), reading.catalog))).toEqual([]);
    expect(value.progress).toEqual([done]);
  });
});
