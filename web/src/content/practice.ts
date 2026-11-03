import type {
  EntityRef,
  ExerciseEntity,
  ProgramEntity,
  InputSpecEntity,
  JudgeProfileEntity,
} from './types';
import type { ExecutionCatalog } from '../engine/execution-client';
import { practiceRelease } from './practice-release.generated';
import { loadCourseBundle } from './course-bundle';
import { c6IndependentSupplement } from '../c6-learning/supplements';
export interface CoursePractice {
  readonly practiceVersion: '1.0.0';
  readonly sourceSha256: string;
  readonly packageRef: EntityRef;
  readonly exercises: readonly ExerciseEntity[];
  readonly programs: readonly ProgramEntity[];
  readonly inputSpecs: readonly InputSpecEntity[];
  readonly judgeProfiles: readonly JudgeProfileEntity[];
}
export interface ExerciseCatalog extends ExecutionCatalog {
  subject: ExerciseEntity;
  judgeProfile: JudgeProfileEntity;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export async function decodePractice(bytes: Uint8Array): Promise<CoursePractice> {
  if (bytes.byteLength !== practiceRelease.bytes) throw new Error('PRACTICE_INTEGRITY');
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  if (
    Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('') !==
    practiceRelease.sha256
  )
    throw new Error('PRACTICE_INTEGRITY');
  return freeze(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as CoursePractice,
  );
}
export async function loadCoursePractice(signal?: AbortSignal): Promise<CoursePractice> {
  const independent = c6IndependentSupplement();
  if (independent) {
    if (signal?.aborted) throw new Error('PRACTICE_ABORTED');
    return independent.practice;
  }
  const bundle = await loadCourseBundle();
  if (signal?.aborted) throw new Error('PRACTICE_ABORTED');
  if (bundle) return bundle.practice;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('PRACTICE_ABORTED')), {
      once: true,
    });
    if (controller.signal.aborted) reject(new Error('PRACTICE_ABORTED'));
  });
  const timer = setTimeout(abort, 10_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const target = new URL(`${import.meta.env.BASE_URL}${practiceRelease.file}`, location.href);
    if (target.origin !== location.origin) throw new Error('PRACTICE_RESOURCE');
    const response = await Promise.race([
      fetch(target, {
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' },
      }),
      timeout,
    ]);
    if (!response.ok || response.redirected || !response.body)
      throw new Error('PRACTICE_UNAVAILABLE');
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > 2 * 1024 * 1024))
      throw new Error('PRACTICE_SIZE');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('PRACTICE_SIZE');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return await decodePractice(bytes);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  }
}
export function exerciseCatalog(content: CoursePractice, id: string): ExerciseCatalog {
  const subject = content.exercises.find((entry) => entry.id === id);
  const program = content.programs.find(
    (entry) => entry.id === subject?.programRef.id && entry.version === subject.programRef.version,
  );
  const inputSpec = content.inputSpecs.find(
    (entry) => entry.id === program?.inputRef.id && entry.version === program.inputRef.version,
  );
  const judgeProfile = content.judgeProfiles.find(
    (entry) => entry.id === subject?.judgeRef.id && entry.version === subject.judgeRef.version,
  );
  if (!subject || !program || !inputSpec || !judgeProfile) throw new Error('PRACTICE_MISSING');
  return { packageRef: content.packageRef, subject, program, inputSpec, judgeProfile };
}
