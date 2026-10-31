import { p05CourseRelease } from './p05-course-release.generated';
import type { CourseReading } from './reading';
import type { CoursePractice } from './practice';
import type { CaseExecutionCatalog } from './case-learning';
import type { LearningCatalog } from '../learning/types';
import type { BlockProgram } from '../blocks/model';
import type { EntityRef } from './types';
import { activateCourseNavigation } from '../navigation';
import { bugRegistryRef, hasBugLearningSupplement } from '../bugs/content';
import {
  memoryBugRegistry,
  hasMemoryBugLearningSupplement,
  type MemoryBugQuestion,
} from '../memory-bugs/content';

export interface PracticeGuide {
  exerciseRef: EntityRef;
  hints: readonly string[];
  correctionSource: string;
  correctionProgram: BlockProgram;
  preferredEditor: 'code' | 'blocks';
}
export interface CourseBundle {
  bundleVersion: '1.0.0' | '1.1.0' | '1.2.0';
  memoryBugSupplement?: {
    registryRef: EntityRef;
    sourceSha256: string;
    questions: readonly MemoryBugQuestion[];
  };
  bugSupplement?: { registryRef: EntityRef; sourceSha256: string };
  registered: boolean;
  reading: CourseReading;
  practice: CoursePractice;
  cases: readonly CaseExecutionCatalog[];
  learning: LearningCatalog | null;
  guidance: readonly PracticeGuide[];
  sourceSha256: string;
}
let current: CourseBundle | null = null;
let pending: Promise<CourseBundle | null> | undefined;
let failure: string | null = null;
export const currentCourseBundle = () => current;
export const courseBundleFailure = () => failure;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export async function decodeCourseBundle(bytes: Uint8Array): Promise<CourseBundle> {
  if (bytes.byteLength !== p05CourseRelease.bytes) throw new Error('COURSE_BUNDLE_INTEGRITY');
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  if (
    Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('') !==
    p05CourseRelease.sha256
  )
    throw new Error('COURSE_BUNDLE_INTEGRITY');
  const bundle = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  ) as CourseBundle;
  const ref = { id: 'content.c.p05', version: '1.0.0' };
  const matches = (value: EntityRef) => value?.id === ref.id && value.version === ref.version;
  if (
    !['1.0.0', '1.1.0', '1.2.0'].includes(bundle.bundleVersion) ||
    bundle.registered !== p05CourseRelease.registered ||
    !matches(bundle.reading?.packageRef) ||
    !matches(bundle.practice?.packageRef) ||
    bundle.reading.lessons.length !== 32 ||
    bundle.reading.chapters.length !== 8 ||
    (['1.1.0', '1.2.0'].includes(bundle.bundleVersion)
      ? !bundle.bugSupplement ||
        bundle.bugSupplement.registryRef.id !== bugRegistryRef.id ||
        bundle.bugSupplement.registryRef.version !== bugRegistryRef.version ||
        !/^[a-f0-9]{64}$/.test(bundle.bugSupplement.sourceSha256) ||
        bundle.bugSupplement.sourceSha256 !== p05CourseRelease.bugSupplement.sourceSha256 ||
        !hasBugLearningSupplement(
          bundle.practice.exercises.map((e) => ({
            ref: { id: e.id, version: e.version },
            learningRevision: e.learningRevision,
            acceptedPriorVersions: e.acceptedPriorVersions,
            lessonRef: e.lessonRef,
            caseKeys: e.tests.map((t) => t.caseKey),
          })),
        )
      : bundle.practice.exercises.length !== 32 || !!bundle.bugSupplement) ||
    bundle.cases.length !== 7 ||
    !bundle.cases.every((entry) => matches(entry.packageRef)) ||
    bundle.guidance.length !== 32 ||
    bundle.reading.sourceSha256 !== bundle.sourceSha256 ||
    bundle.practice.sourceSha256 !== bundle.sourceSha256 ||
    (bundle.registered
      ? !bundle.learning || !matches(bundle.learning.packageRef)
      : bundle.learning !== null)
  )
    throw new Error('COURSE_BUNDLE_CONTENT');
  if (bundle.bundleVersion === '1.2.0') {
    const supplement = bundle.memoryBugSupplement;
    if (
      !supplement ||
      supplement.registryRef.id !== memoryBugRegistry.registryRef.id ||
      supplement.registryRef.version !== memoryBugRegistry.registryRef.version ||
      supplement.sourceSha256 !== p05CourseRelease.memoryBugSupplement.sourceSha256 ||
      JSON.stringify(supplement.questions) !== JSON.stringify(memoryBugRegistry.questions) ||
      (bundle.registered &&
        (!bundle.learning || !hasMemoryBugLearningSupplement(bundle.learning.exercises)))
    )
      throw new Error('COURSE_BUNDLE_CONTENT');
  } else if (bundle.memoryBugSupplement) throw new Error('COURSE_BUNDLE_CONTENT');
  return freeze(bundle);
}
/** One verified atomic resource. A failed candidate selects the entire known old release. */
export async function loadCourseBundle(
  fetcher: typeof fetch = fetch,
  retry = false,
): Promise<CourseBundle | null> {
  if (!p05CourseRelease.enabled) return null;
  if (retry && failure) pending = undefined;
  if (!pending)
    pending = (async () => {
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener(
          'abort',
          () => reject(new Error('COURSE_BUNDLE_TIMEOUT')),
          { once: true },
        ),
      );
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const target = new URL(
          `${import.meta.env.BASE_URL}${p05CourseRelease.file}`,
          location.href,
        );
        if (target.origin !== location.origin || !target.pathname.includes('/content/'))
          throw new Error('COURSE_BUNDLE_RESOURCE');
        const response = await Promise.race([
          fetcher(target, {
            signal: controller.signal,
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            headers: { Accept: 'application/json' },
          }),
          aborted,
        ]);
        if (!response.ok || response.redirected || !response.body)
          throw new Error('COURSE_BUNDLE_UNAVAILABLE');
        const length = response.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > 2 * 1024 * 1024))
          throw new Error('COURSE_BUNDLE_SIZE');
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const chunk = await Promise.race([reader.read(), aborted]);
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 2 * 1024 * 1024) throw new Error('COURSE_BUNDLE_SIZE');
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, at);
          at += chunk.length;
        }
        const bundle = await decodeCourseBundle(bytes);
        current = bundle;
        failure = null;
        activateCourseNavigation(bundle.reading);
        return bundle;
      } catch (error) {
        current = null;
        failure = error instanceof Error ? error.message : 'COURSE_BUNDLE_UNAVAILABLE';
        activateCourseNavigation(null);
        return null;
      } finally {
        clearTimeout(timer);
        controller.abort();
        void reader?.cancel().catch(() => undefined);
      }
    })();
  return pending;
}
