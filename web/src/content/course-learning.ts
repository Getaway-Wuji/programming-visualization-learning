import { createLearningCatalog } from '../learning/catalog';
import type { LearningCatalog } from '../learning/types';
import type { CourseReading } from './reading';
import { readingRelease } from './reading-release.generated';
import { practiceRelease } from './practice-release.generated';
import { courseLearningRelease } from './course-learning-release.generated';

interface CourseLearning {
  learningVersion: '1.0.0';
  sourceSha256: string;
  readingSha256: string;
  practiceSha256: string;
  blocksBuildSha256: string;
  capabilities: ['lesson.started', 'lesson.study-confirmed', 'exercise.passed'];
  catalog: LearningCatalog;
}
const capabilities = ['lesson.started', 'lesson.study-confirmed', 'exercise.passed'];

/** Verify the reviewed byte release before parsing or granting any learning capability. */
export async function decodeCourseLearning(
  bytes: Uint8Array,
  reading: CourseReading,
): Promise<LearningCatalog> {
  if (bytes.byteLength !== courseLearningRelease.bytes)
    throw new Error('COURSE_LEARNING_INTEGRITY');
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  if (hex !== courseLearningRelease.sha256) throw new Error('COURSE_LEARNING_INTEGRITY');
  const source = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  ) as CourseLearning;
  if (
    !source ||
    Object.keys(source).sort().join(',') !==
      'blocksBuildSha256,capabilities,catalog,learningVersion,practiceSha256,readingSha256,sourceSha256' ||
    source.learningVersion !== '1.0.0' ||
    source.sourceSha256 !== courseLearningRelease.sourceSha256 ||
    source.sourceSha256 !== reading.sourceSha256 ||
    source.sourceSha256 !== readingRelease.sourceSha256 ||
    source.sourceSha256 !== practiceRelease.sourceSha256 ||
    source.readingSha256 !== courseLearningRelease.readingSha256 ||
    source.readingSha256 !== readingRelease.sha256 ||
    source.practiceSha256 !== courseLearningRelease.practiceSha256 ||
    source.practiceSha256 !== practiceRelease.sha256 ||
    !/^[a-f0-9]{64}$/.test(source.blocksBuildSha256) ||
    JSON.stringify(source.capabilities) !== JSON.stringify(capabilities) ||
    reading.catalog.purpose !== 'lesson-reading' ||
    JSON.stringify(source.catalog) !==
      JSON.stringify({ ...reading.catalog, purpose: 'course-practice' })
  )
    throw new Error('COURSE_LEARNING_CONTENT');
  return createLearningCatalog(source.catalog);
}

export async function loadCourseLearning(
  reading: CourseReading,
  fetcher: typeof fetch = fetch,
): Promise<LearningCatalog> {
  const target = new URL(`${import.meta.env.BASE_URL}${courseLearningRelease.file}`, location.href);
  const root = new URL(`${import.meta.env.BASE_URL}content/`, location.href);
  if (target.origin !== location.origin || !target.pathname.startsWith(root.pathname))
    throw new Error('COURSE_LEARNING_RESOURCE');
  const controller = new AbortController();
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => reject(new Error('COURSE_LEARNING_TIMEOUT')),
      { once: true },
    );
  });
  const timer = setTimeout(() => controller.abort(), 10_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await Promise.race([
      fetcher(target, {
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }),
      timeout,
    ]);
    if (!response.ok || response.redirected || !response.body)
      throw new Error('COURSE_LEARNING_UNAVAILABLE');
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > 2 * 1024 * 1024))
      throw new Error('COURSE_LEARNING_SIZE');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('COURSE_LEARNING_SIZE');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return await decodeCourseLearning(bytes, reading);
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  }
}
