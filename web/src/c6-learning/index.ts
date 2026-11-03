import type { LearningCatalog } from '../learning/types';
import type { C6TeachingManifest } from '../content/c6-teaching-types';
import type { C6CourseCompatibility } from '../content/c6-course-types';
import { c6TeachingSha256 } from '../content/c6-teaching-validator.mjs';
import { c6LearningRelease } from './release.generated';

const loadedIndexes = new WeakSet<object>();
const validatedIndexes = new WeakSet<object>();
const sourceNodes = new WeakMap<C6LearningIndex, ReadonlySet<string>>();
export function isC6SourceNode(index: C6LearningIndex, nodeId: string): boolean {
  return sourceNodes.get(index)?.has(nodeId) ?? false;
}
export function isLoadedC6LearningIndex(index: C6LearningIndex): boolean {
  return loadedIndexes.has(index);
}

export type C6LessonIndex = readonly [
  lessonId: string,
  nodeId: string,
  chapterNodeId: string,
  knowledgeId: string,
  rewardGroupId: string,
  requiredExerciseIds: readonly string[],
];
export type C6ExerciseIndex = readonly [
  exerciseId: string,
  nodeId: string,
  lessonId: string,
  profileId: string,
  programId: string,
  caseKeys: readonly string[],
];
export type C6KnowledgeIndex = readonly [
  knowledgeId: string,
  nodeId: string,
  kind: 'chapter' | 'lesson',
  chapterKnowledgeId: string | null,
];
export interface C6LearningIndex {
  readonly indexVersion: '1.0.0';
  readonly catalogSetRef: { readonly id: 'catalog-set.c.primer6'; readonly version: '2.0.0' };
  readonly packageRef: { readonly id: 'content.c.primer6'; readonly version: '2.0.0' };
  readonly manifestSha256: string;
  readonly sourceSha256: string;
  readonly engineBuildSha256: string;
  readonly judgeOwnerPackageRef: { readonly id: 'content.c.primer6'; readonly version: '1.0.0' };
  readonly lessons: readonly C6LessonIndex[];
  readonly exercises: readonly C6ExerciseIndex[];
  readonly knowledge: readonly C6KnowledgeIndex[];
  readonly rewardGroups: C6CourseCompatibility['rewardGroups'];
  readonly legacyLinks: C6CourseCompatibility['legacyLinks'];
}
export type C6LearningCatalog = Omit<LearningCatalog, 'purpose'> & {
  readonly purpose: 'c6-course-practice';
};
export class C6LearningIndexError extends Error {
  constructor(
    readonly code:
      | 'C6_INDEX_INVALID'
      | 'C6_INDEX_HASH'
      | 'C6_INDEX_LOAD'
      | 'C6_INDEX_CANCELLED'
      | 'C6_INDEX_TIMEOUT',
  ) {
    super(code);
    this.name = 'C6LearningIndexError';
  }
}
function check(value: unknown): asserts value {
  if (!value) throw new C6LearningIndexError('C6_INDEX_INVALID');
}
function row(value: unknown, fields: readonly string[]): Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  check(
    Reflect.ownKeys(value).length === fields.length &&
      Reflect.ownKeys(value).every((key) => typeof key === 'string' && fields.includes(key)),
  );
  check(
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (d) => 'value' in d && d.enumerable,
    ),
  );
  return value as Record<string, unknown>;
}
function array(value: unknown, minimum: number, maximum = minimum): unknown[] {
  check(Array.isArray(value) && value.length >= minimum && value.length <= maximum);
  check(Reflect.ownKeys(value).length === value.length + 1);
  for (let i = 0; i < value.length; ++i) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    check(descriptor && 'value' in descriptor && descriptor.enumerable);
  }
  return value;
}
function id(value: unknown): asserts value is string {
  check(
    typeof value === 'string' && value.length <= 180 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(value),
  );
}
function reference(value: unknown, version?: string) {
  const r = row(value, ['id', 'version']);
  id(r.id);
  check(
    typeof r.version === 'string' &&
      /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(r.version),
  );
  if (version) check(r.version === version);
  return r as { id: string; version: string };
}
function unique(values: readonly unknown[]): void {
  check(new Set(values).size === values.length);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Cross-check metadata against the already validated, pinned teaching manifest. */
export function validateC6LearningIndex(
  value: unknown,
  manifest: C6TeachingManifest,
): C6LearningIndex {
  check(
    manifest.contractVersion === '3.0.0' &&
      manifest.packageRef.id === 'content.c.primer6' &&
      manifest.packageRef.version === '2.0.0' &&
      manifest.judgeOwnerPackageRef.version === '1.0.0',
  );
  const r = row(value, [
    'indexVersion',
    'catalogSetRef',
    'packageRef',
    'manifestSha256',
    'sourceSha256',
    'engineBuildSha256',
    'judgeOwnerPackageRef',
    'lessons',
    'exercises',
    'knowledge',
    'rewardGroups',
    'legacyLinks',
  ]);
  check(r.indexVersion === '1.0.0');
  check(reference(r.catalogSetRef, '2.0.0').id === 'catalog-set.c.primer6');
  check(reference(r.packageRef, '2.0.0').id === 'content.c.primer6');
  check(reference(r.judgeOwnerPackageRef, '1.0.0').id === 'content.c.primer6');
  check(
    r.manifestSha256 === c6LearningRelease.manifestSha256 &&
      r.sourceSha256 === c6LearningRelease.sourceSha256 &&
      r.sourceSha256 === manifest.sourceSha256 &&
      r.engineBuildSha256 === c6LearningRelease.engineBuildSha256 &&
      r.engineBuildSha256 === manifest.engineBuildSha256,
  );
  const lessons = array(r.lessons, 404),
    exercises = array(r.exercises, 44),
    knowledge = array(r.knowledge, 421);
  const navigation = new Map(manifest.nodes.map((n) => [`node.${n.id}`, n]));
  const entityIds = (kind: 'lessons' | 'exercises' | 'knowledge') =>
    new Set(manifest.chunks.flatMap((c) => c.entityIds[kind]));
  const allowedLessons = entityIds('lessons'),
    allowedExercises = entityIds('exercises'),
    allowedKnowledge = entityIds('knowledge');
  const lessonIds: string[] = [],
    exerciseIds: string[] = [],
    knowledgeIds: string[] = [];
  const lessonRows = lessons.map((entry) => {
    const tuple = array(entry, 6);
    tuple.slice(0, 5).forEach(id);
    const [lessonId, nodeId, chapter, knowledgeId, group] = tuple as string[];
    check(allowedLessons.has(lessonId) && allowedKnowledge.has(knowledgeId));
    check(
      navigation.get(nodeId)?.category === 'teaching-lesson' &&
        /^node\.c6\.ch[0-9]{2}$/u.test(chapter),
    );
    let cursor = navigation.get(nodeId);
    for (let i = 0; cursor?.parentId && i < 32; ++i)
      cursor = navigation.get(`node.${cursor.parentId}`);
    check(cursor?.id === chapter.slice(5));
    const required = array(tuple[5], 0, 1);
    required.forEach((ref) => {
      id(ref);
      check(allowedExercises.has(ref));
    });
    unique(required);
    lessonIds.push(lessonId);
    return { lessonId, nodeId, chapter, knowledgeId, group, required: required as string[] };
  });
  unique(lessonIds);
  const exerciseRows = exercises.map((entry) => {
    const tuple = array(entry, 6);
    tuple.slice(0, 5).forEach(id);
    const [exerciseId, nodeId, lessonId, profileId, programId] = tuple as string[];
    check(allowedExercises.has(exerciseId) && lessonIds.includes(lessonId));
    const lesson = lessonRows.find((l) => l.lessonId === lessonId)!;
    check(lesson.nodeId === nodeId && lesson.required.includes(exerciseId));
    check(
      profileId === exerciseId.replace(/^exercise\./u, 'judge.') &&
        programId === exerciseId.replace(/^exercise\./u, 'program.'),
    );
    const keys = array(tuple[5], 4);
    keys.forEach(id);
    unique(keys);
    exerciseIds.push(exerciseId);
    return { exerciseId, lessonId };
  });
  unique(exerciseIds);
  check(lessonRows.flatMap((l) => l.required).length === 44);
  for (const entry of knowledge) {
    const tuple = array(entry, 4);
    id(tuple[0]);
    id(tuple[1]);
    check(allowedKnowledge.has(tuple[0]) && navigation.has(tuple[1]));
    check(tuple[2] === 'chapter' || tuple[2] === 'lesson');
    if (tuple[2] === 'chapter')
      check(tuple[3] === null && /^node\.c6\.ch[0-9]{2}$/u.test(tuple[1]));
    else {
      id(tuple[3]);
      check(allowedKnowledge.has(tuple[3]));
      const lesson = lessonRows.find((l) => l.nodeId === tuple[1]);
      check(
        lesson?.knowledgeId === tuple[0] &&
          tuple[3] === lesson.chapter.replace(/^node\./u, 'knowledge.'),
      );
    }
    knowledgeIds.push(tuple[0]);
  }
  unique(knowledgeIds);
  const groups = array(r.rewardGroups, 42),
    groupedLessons: string[] = [],
    groupedExercises: string[] = [],
    groupIds: string[] = [];
  for (const entry of groups) {
    const g = row(entry, [
      'id',
      'lessonRefs',
      'exerciseRefs',
      'legacyLessonRef',
      'legacyExerciseRef',
      'lessonReward',
      'exerciseReward',
      'emptyNewGroupCanGrant',
    ]);
    id(g.id);
    groupIds.push(g.id);
    check(g.emptyNewGroupCanGrant === false);
    for (const ref of array(g.lessonRefs, 0, 404)) {
      const lessonId = reference(ref, '2.0.0').id;
      check(lessonRows.some((l) => l.lessonId === lessonId && l.group === g.id));
      groupedLessons.push(lessonId);
    }
    for (const ref of array(g.exerciseRefs, 0, 44)) {
      const exerciseId = reference(ref, '2.0.0').id;
      check(
        exerciseRows.some(
          (e) =>
            e.exerciseId === exerciseId &&
            lessonRows.some((l) => l.lessonId === e.lessonId && l.group === g.id),
        ),
      );
      groupedExercises.push(exerciseId);
    }
    for (const name of ['legacyLessonRef', 'legacyExerciseRef'])
      if (g[name] !== null) reference(g[name]);
    for (const [name, points, sourceId] of [
      ['lessonReward', 20, 'reward.lesson.first-completion'],
      ['exerciseReward', 10, 'reward.exercise.first-pass'],
    ] as const) {
      const reward = row(g[name], ['points', 'subjectId', 'sourceId']);
      id(reward.subjectId);
      check(reward.points === points && reward.sourceId === sourceId);
    }
  }
  unique(groupIds);
  unique(groupedLessons);
  unique(groupedExercises);
  check(groupedLessons.length === 404 && groupedExercises.length === 44);
  for (const entry of array(r.legacyLinks, 79)) {
    const link = row(entry, [
      'kind',
      'fromRef',
      'targetRef',
      'relatedSourceNodeRef',
      'oldPackageRef',
      'language',
      'learningRevision',
      'acceptedPriorVersions',
      'transferPass',
    ]);
    check(['lesson', 'exercise', 'case', 'supplemental-exercise'].includes(String(link.kind)));
    reference(link.fromRef);
    reference(link.targetRef);
    if (link.oldPackageRef !== null) reference(link.oldPackageRef);
    if (link.relatedSourceNodeRef !== null)
      check(navigation.has(reference(link.relatedSourceNodeRef, '2.0.0').id));
    check(link.language === null || link.language === 'c' || link.language === 'cpp');
    check(
      link.learningRevision === null ||
        (Number.isInteger(link.learningRevision) && Number(link.learningRevision) > 0),
    );
    for (const version of array(link.acceptedPriorVersions, 0, 20))
      check(typeof version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/u.test(version));
    check(link.transferPass === false);
  }
  const result = freeze(value as C6LearningIndex);
  validatedIndexes.add(result);
  sourceNodes.set(result, new Set(navigation.keys()));
  return result;
}

export function c6LearningCatalog(index: C6LearningIndex): C6LearningCatalog {
  check(validatedIndexes.has(index));
  return freeze({
    purpose: 'c6-course-practice',
    packageRef: index.packageRef,
    lessons: index.lessons.map((l) => ({
      ref: { id: l[0], version: '2.0.0' },
      learningRevision: 1,
      acceptedPriorVersions: [],
      requiredExerciseRefs: l[5].map((id) => ({ id, version: '2.0.0' })),
    })),
    exercises: index.exercises.map((e) => ({
      ref: { id: e[0], version: '2.0.0' },
      learningRevision: 1,
      acceptedPriorVersions: [],
      lessonRef: { id: e[2], version: '2.0.0' },
      caseKeys: e[5],
    })),
    cases: [],
  });
}

export async function loadC6LearningIndex(
  manifest: C6TeachingManifest,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<C6LearningIndex> {
  if (signal?.aborted) throw new C6LearningIndexError('C6_INDEX_CANCELLED');
  const deadline = performance.now() + 10_000;
  const url = new URL(
    `${import.meta.env.BASE_URL}content/c/primer6-learning/${c6LearningRelease.file}`,
    location.href,
  );
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10_000);
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const aborted = new Promise<never>((_, reject) => {
    const stop = () =>
      reject(new C6LearningIndexError(timedOut ? 'C6_INDEX_TIMEOUT' : 'C6_INDEX_CANCELLED'));
    if (controller.signal.aborted) stop();
    else controller.signal.addEventListener('abort', stop, { once: true });
  });
  void aborted.catch(() => undefined);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    check(url.origin === location.origin && ['http:', 'https:'].includes(url.protocol));
    const response = await Promise.race([
      fetcher(url, {
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }),
      aborted,
    ]);
    if (
      !response.ok ||
      response.redirected ||
      !response.body ||
      (response.url && response.url !== url.href)
    )
      throw new C6LearningIndexError('C6_INDEX_LOAD');
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/u.test(length) || Number(length) > 262144))
      throw new C6LearningIndexError('C6_INDEX_LOAD');
    reader = response.body.getReader();
    const bytes = new Uint8Array(c6LearningRelease.bytes);
    let size = 0;
    for (;;) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      if (size + part.value.byteLength > bytes.length)
        throw new C6LearningIndexError('C6_INDEX_HASH');
      bytes.set(part.value, size);
      size += part.value.byteLength;
    }
    if (
      size !== bytes.length ||
      (await Promise.race([c6TeachingSha256(bytes), aborted])) !== c6LearningRelease.sha256
    )
      throw new C6LearningIndexError('C6_INDEX_HASH');
    if (controller.signal.aborted)
      throw new C6LearningIndexError(timedOut ? 'C6_INDEX_TIMEOUT' : 'C6_INDEX_CANCELLED');
    const result = validateC6LearningIndex(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      manifest,
    );
    if (performance.now() >= deadline) throw new C6LearningIndexError('C6_INDEX_TIMEOUT');
    loadedIndexes.add(result);
    return result;
  } catch (error) {
    if (error instanceof C6LearningIndexError) throw error;
    throw new C6LearningIndexError('C6_INDEX_LOAD');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  }
}
