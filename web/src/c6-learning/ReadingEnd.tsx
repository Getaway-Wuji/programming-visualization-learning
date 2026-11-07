import { useEffect, useRef, useState } from 'react';
import { useLearning } from '../learning/react';
import { KnowledgeMarkButton, KnowledgeMarksStatus } from '../review-notebook/marks';
import { useLocalLearningDate } from '../learning/use-local-date';

export function ReadingEnd({
  lessonId,
  knowledgeId,
  language = 'c',
}: {
  lessonId: string;
  knowledgeId?: string;
  language?: 'c' | 'python' | 'java' | 'cpp';
}) {
  const { state, service } = useLearning();
  const end = useRef<HTMLDivElement>(null);
  const interacted = useRef<string | null>(null);
  const pending = useRef(false);
  const [failed, setFailed] = useState(false);
  const read =
    language !== 'c'
      ? state.snapshot?.progress.some(
          (row) => row.eventType === 'lesson.study-confirmed' && row.subjectRef.id === lessonId,
        )
      : state.projection?.lessons.find((lesson) => lesson.id === lessonId)?.studyConfirmed;
  const today = useLocalLearningDate(state.snapshot?.meta.timeZone);
  const readToday = state.snapshot?.dailyFacts.some(
    (fact) =>
      fact.localDate === today &&
      fact.eventType === 'lesson.completed' &&
      fact.subjectRef.id === lessonId,
  );
  useEffect(() => {
    if (readToday || !today || !state.capabilities.learning) return;
    let active = true;
    let frame = 0;
    const check = () => {
      const current = service.getState();
      if (
        !active ||
        interacted.current !== today ||
        pending.current ||
        failed ||
        document.hidden ||
        current.status !== 'ready' ||
        current.sessionEpoch !== state.sessionEpoch
      )
        return;
      if (!end.current || end.current.getBoundingClientRect().bottom > window.innerHeight + 8)
        return;
      pending.current = true;
      const record =
        language === 'cpp'
          ? service.recordCppLesson(lessonId, state.sessionEpoch)
          : language === 'java'
            ? service.recordJavaLesson(lessonId, state.sessionEpoch)
            : language === 'python'
              ? service.recordPythonLesson(lessonId, state.sessionEpoch)
              : service.recordLesson(lessonId, true, state.sessionEpoch);
      void record
        .catch(() => {
          if (active) setFailed(true);
        })
        .finally(() => {
          pending.current = false;
        });
    };
    const scroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    const interact = (event: Event) => {
      if (
        event instanceof KeyboardEvent &&
        !['End', 'PageDown', 'ArrowDown', ' '].includes(event.key)
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input,textarea,select,[contenteditable=true]')
      )
        return;
      interacted.current = today;
      scroll();
    };
    // Scroll does not bubble from nested reading containers. Capture it as well
    // as document scrolling, and recheck when layout/storage readiness changes.
    window.addEventListener('scroll', interact, { passive: true, capture: true });
    window.addEventListener('wheel', interact, { passive: true });
    window.addEventListener('touchmove', interact, { passive: true });
    window.addEventListener('keydown', interact);
    const observer = new IntersectionObserver(() => scroll());
    if (end.current) observer.observe(end.current);
    const resized = new ResizeObserver(() => scroll());
    if (end.current?.parentElement) resized.observe(end.current.parentElement);
    const unsubscribe = service.subscribe(scroll);
    check();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', interact, true);
      window.removeEventListener('wheel', interact);
      window.removeEventListener('touchmove', interact);
      window.removeEventListener('keydown', interact);
      observer.disconnect();
      resized.disconnect();
      unsubscribe();
    };
  }, [
    readToday,
    today,
    state.capabilities.learning,
    state.sessionEpoch,
    lessonId,
    language,
    service,
    failed,
  ]);
  return (
    <div
      ref={end}
      className="c6-reading-end"
      data-testid="reading-end"
      data-read={!!read}
      data-read-today={!!readToday}
    >
      {readToday && (
        <p className="muted" role="status">
          今日阅读已记录
        </p>
      )}
      {knowledgeId && (
        <>
          <KnowledgeMarkButton lessonId={lessonId} knowledgeId={knowledgeId} />
          <KnowledgeMarksStatus />
        </>
      )}
      {failed && !readToday && (
        <p role="alert">
          阅读进度未保存。
          <button className="text-link" onClick={() => setFailed(false)}>
            重试保存
          </button>
        </p>
      )}
    </div>
  );
}
