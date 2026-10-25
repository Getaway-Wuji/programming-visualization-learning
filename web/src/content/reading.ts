import type { LearningServiceState } from '../learning/service';
import type {
  ChapterEntity,
  LessonEntity,
  ProgramEntity,
  KnowledgeEntity,
  EntityRef,
} from './types';
import type { LearningCatalog, LearningProjection } from '../learning/types';
import type { Alias } from '../storage/model';
import { isCompatibleLearningHistory } from '../learning/domain';
import { readingRelease } from './reading-release.generated';

export interface CourseReading {
  readonly readingVersion: '1.0.0';
  readonly sourceSha256: string;
  readonly packageRef: EntityRef;
  readonly chapters: readonly ChapterEntity[];
  readonly lessons: readonly LessonEntity[];
  readonly programs: readonly ProgramEntity[];
  readonly knowledgePoints: readonly KnowledgeEntity[];
  readonly exercises: readonly (EntityRef & {
    title: string;
    lessonRef: EntityRef;
    prompt: string;
  })[];
  readonly cases: readonly (EntityRef & { title: string })[];
  readonly catalog: LearningCatalog;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** The exact public bytes were reviewed at build time. Hash verification precedes parsing. */
export async function decodeReading(bytes: Uint8Array): Promise<CourseReading> {
  if (bytes.byteLength !== readingRelease.bytes) throw new Error('READING_INTEGRITY');
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  const hex = Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
  if (hex !== readingRelease.sha256) throw new Error('READING_INTEGRITY');
  return freeze(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as CourseReading,
  );
}
export async function loadCourseReading(fetcher: typeof fetch = fetch): Promise<CourseReading> {
  const controller = new AbortController();
  const target = new URL(`${import.meta.env.BASE_URL}${readingRelease.file}`, location.href);
  const root = new URL(`${import.meta.env.BASE_URL}content/`, location.href);
  if (target.origin !== location.origin || !target.pathname.startsWith(root.pathname))
    throw new Error('READING_RESOURCE');
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('READING_TIMEOUT')), {
      once: true,
    });
  });
  const timer = setTimeout(() => controller.abort(), 10_000);
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
      throw new Error('READING_UNAVAILABLE');
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > 2 * 1024 * 1024))
      throw new Error('READING_SIZE');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('READING_SIZE');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return await decodeReading(bytes);
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  }
}

export function continueLesson(
  reading: CourseReading,
  projection: LearningProjection | null,
  aliases: readonly Alias[] = [],
): string {
  const ordered = reading.chapters.flatMap((chapter) => chapter.lessonRefs.map((ref) => ref.id));
  if (!projection) return ordered[0];
  const pending = ordered.filter(
    (id) => !projection.lessons.find((lesson) => lesson.id === id)?.completed,
  );
  const candidates = pending.length ? pending : ordered;
  const recent = projection.history
    .filter(
      (row) => row.eventType === 'lesson.started' || row.eventType === 'lesson.study-confirmed',
    )
    .flatMap((row) => {
      const lesson = reading.catalog.lessons.find(
        (item) =>
          candidates.includes(item.ref.id) &&
          isCompatibleLearningHistory(row, item, 'lesson', aliases),
      );
      return lesson ? [{ id: lesson.ref.id, lastAt: row.lastAt }] : [];
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return recent[0]?.id ?? candidates[0];
}

export function lessonProgress(state: LearningServiceState, id: string): string {
  if (!state.projection) return '学习记录尚未读取';
  const lesson = state.projection.lessons.find((value) => value.id === id);
  if (!lesson) return '课程内容缺失';
  const text = lesson.completed
    ? '小节已完成'
    : lesson.studyConfirmed
      ? '已确认学习，待通过必修练习'
      : lesson.started
        ? '已开始'
        : '未开始';
  return state.temporary ? `${text} · 本次尚未保存` : text;
}
