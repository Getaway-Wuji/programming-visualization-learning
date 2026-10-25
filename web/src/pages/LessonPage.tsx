import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Breadcrumbs, MissingPage, PageHeading } from '../components/Ui';
import { ReadingBoundary, ReadingText, lessonProgress } from '../components/CourseReading';
import { Icon } from '../components/Icon';
import { lessons, paths } from '../navigation';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { useLocalLearningDate } from '../learning/goal-components';
import { localDateAt } from '../storage/validation';
import { isCompatibleLearningHistory } from '../learning/domain';

export default function LessonPage() {
  const { lessonId } = useParams();
  const { state, service } = useLearning();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const today = useLocalLearningDate(state.snapshot?.meta.timeZone);
  const reading = state.reading;
  const lesson = reading?.lessons.find((item) => item.id === lessonId);
  if (!lessons.some((item) => item.id === lessonId))
    return <MissingPage title="找不到这个小节" backTo="/courses" backLabel="返回课程目录" />;
  const chapter = reading?.chapters.find((item) => item.id === lesson?.chapterRef.id);
  const progress = state.projection?.lessons.find((item) => item.id === lessonId);
  const currentLesson = (state.practiceCatalog ?? state.reading?.catalog)?.lessons.find(
    (item) => item.ref.id === lessonId,
  );
  const confirmedToday = progress?.history.some(
    (row) =>
      row.eventType === 'lesson.study-confirmed' &&
      !!currentLesson &&
      isCompatibleLearningHistory(row, currentLesson, 'lesson', state.snapshot!.aliases) &&
      localDateAt(row.lastAt, state.snapshot!.meta.timeZone) === today,
  );
  const action = async (confirm: boolean) => {
    if (!lesson || busy) return;
    setBusy(true);
    setActionError(false);
    try {
      await service.recordLesson(lesson.id, confirm, state.sessionEpoch);
    } catch {
      setActionError(true);
    } finally {
      setBusy(false);
    }
  };
  const disabled =
    busy ||
    state.status === 'loading' ||
    state.status === 'saving' ||
    state.status === 'readonly' ||
    state.pendingCount > 0;
  return (
    <div
      data-page-id="PAGE-03"
      data-testid="lesson-reading"
      data-state={state.readingStatus ?? 'loading'}
    >
      <Breadcrumbs
        items={[
          { label: 'C 语言课程', to: '/courses' },
          ...(chapter ? [{ label: chapter.title, to: paths.chapter(chapter.id) }] : []),
          { label: lesson?.title ?? '课程小节' },
        ]}
      />
      <LearningSaveStatus />
      <ReadingBoundary>
        {!lesson ? (
          <MissingPage title="课程内容缺失" backTo="/courses" backLabel="返回课程目录" />
        ) : (
          <div>
            <PageHeading
              kicker={`第 ${chapter?.order ?? ''} 章 · ${chapter?.title ?? ''}`}
              title={lesson.title}
              description="先理解目标和示例，再主动确认学习，最后通过本节必修练习。"
            />
            <p className="notice" data-testid="lesson-progress">
              {lessonProgress(state, lesson.id)}
            </p>
            <div className="lesson-layout">
              <div className="lesson-main">
                <section className="card section-card sample-teaching">
                  <h2>学习目标</h2>
                  <ul>
                    {lesson.teaching.objectives.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                  <h2>讲解与示例</h2>
                  <ReadingText text={lesson.teaching.explanation} />
                  {lesson.teaching.exampleProgramRefs.map((ref) => {
                    const program = reading!.programs.find(
                      (item) => item.id === ref.id && item.version === ref.version,
                    )!;
                    return (
                      <div key={ref.id}>
                        <h3>{program.title}</h3>
                        <pre
                          className="sample-source"
                          tabIndex={0}
                          aria-label={`${program.title}参考源码`}
                        >
                          {program.sourceExample}
                        </pre>
                      </div>
                    );
                  })}
                  <h2>常见错误</h2>
                  <ul>
                    {lesson.teaching.commonMistakes.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                  <h2>范围与边界</h2>
                  <ul>
                    {lesson.teaching.boundaryNotes.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                  <h2>本节知识点</h2>
                  <ul>
                    {lesson.knowledgeRefs.map((ref) => (
                      <li key={ref.id}>
                        {reading!.knowledgePoints.find((item) => item.id === ref.id)?.title}
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="card section-card">
                  <h2>记录本节学习</h2>
                  <p className="muted">
                    学习确认与必修练习通过共同决定小节完成。浏览、刷新和查看解析不会自动通过练习。
                  </p>
                  <div className="inline-actions">
                    <button
                      className="button button-secondary"
                      disabled={disabled || progress?.started}
                      onClick={() => void action(false)}
                    >
                      开始本节学习
                    </button>
                    <button
                      className="button button-primary"
                      disabled={disabled || confirmedToday}
                      onClick={() => void action(true)}
                    >
                      {progress?.studyConfirmed && !confirmedToday ? '确认今日复习' : '确认已学习'}
                    </button>
                    {progress?.studyConfirmed && (
                      <Link className="text-link" to={paths.lesson(lesson.id)}>
                        复习本节
                      </Link>
                    )}
                  </div>
                  {actionError && !state.lastSaved && (
                    <p role="alert">本次操作未能保存。请查看本地保存状态，恢复后重试未保存操作。</p>
                  )}
                  <Link className="card-link" to="/courses">
                    返回课程目录
                    <Icon name="arrow" />
                  </Link>
                </section>
              </div>
              <aside className="lesson-aside">
                {lesson.requiredExerciseRefs.map((ref) => {
                  const exercise = reading!.exercises.find(
                    (item) => item.id === ref.id && item.version === ref.version,
                  )!;
                  const passed = state.projection?.exercises.find(
                    (item) => item.id === ref.id,
                  )?.passed;
                  return (
                    <section className="card section-card" key={ref.id}>
                      <span className="section-label">本节必修练习</span>
                      <h2>{exercise.title}</h2>
                      <p>{passed ? '已有兼容的历史通过记录' : '尚未通过'}</p>
                      <p className="muted">
                        搭建本节积木程序，提交真实测试并逐步复盘；通过记录保存在当前浏览器。
                      </p>
                      <Link className="button button-primary" to={paths.practice(ref.id)}>
                        进入练习工作区
                        <Icon name="arrow" />
                      </Link>
                    </section>
                  );
                })}
                <section className="card section-card">
                  <h2>关联演示</h2>
                  {lesson.caseRefs.length ? (
                    <ul className="lesson-list">
                      {lesson.caseRefs.map((ref) => (
                        <li key={ref.id}>
                          <Link className="card-link" to={paths.visualize(ref.id)}>
                            {reading!.cases.find((item) => item.id === ref.id)?.title}
                            <Icon name="chevron" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">本节没有关联演示。</p>
                  )}
                </section>
              </aside>
            </div>
          </div>
        )}
      </ReadingBoundary>
    </div>
  );
}
