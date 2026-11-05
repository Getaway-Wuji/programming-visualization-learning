import { Link, useParams } from 'react-router';
import { Breadcrumbs, MissingPage, PageHeading, StatePanel } from '../components/Ui';
import { WorkspaceContext } from '../workbench/Workbench';
import { Icon } from '../components/Icon';
import { cases, lessons, paths } from '../navigation';
import { CaseSample } from '../components/ContentSample';
import { PracticeExecution } from '../components/PracticeExecution';
import { CaseExecution } from '../components/CaseExecution';
import { SubjectLearningStatus, useLearning } from '../learning/react';
import { bugQuestions } from '../bugs/content';

function practiceLesson(exerciseId?: string) {
  const ordinary = lessons.find((item) => item.exerciseId === exerciseId);
  if (ordinary) return ordinary;
  const bug = bugQuestions.find((q) => q.exerciseRef.id === exerciseId);
  const base = bug && lessons.find((item) => item.exerciseId === bug.baseExerciseRef.id);
  return base && bug
    ? { ...base, exerciseId: bug.exerciseRef.id, exerciseTitle: bug.title }
    : undefined;
}

function CodePanel({ generated = false }: { generated?: boolean }) {
  return (
    <section
      className="workbench-panel code-pane"
      data-testid="code-panel"
      aria-label={generated ? '生成代码区域' : '执行代码区域'}
    >
      <header className="panel-heading">
        <h2 className="panel-title">
          <Icon name="code" />
          {generated ? '生成的 C 代码' : 'C 代码'}
        </h2>
        <span className="badge badge-muted">只读</span>
      </header>
      <div className="code-toolbar">
        <span>尚无源码</span>
        <span>C · P0 教学子集</span>
      </div>
      <div className="panel-body code-body">
        <span className="code-gutter" aria-hidden="true">
          —
        </span>
        <textarea
          className="code-area"
          aria-label={generated ? '生成的 C 代码' : '当前执行的 C 代码'}
          value=""
          readOnly
          spellCheck={false}
          placeholder={
            generated ? '积木编辑器接入后，在这里查看生成的代码。' : '实际运行的代码将在这里显示。'
          }
        />
      </div>
      <p className="workbench-caption">可聚焦、选择和复制；当前没有生成或执行过的程序。</p>
    </section>
  );
}

export function PracticePage() {
  const { exerciseId } = useParams();
  const lesson = practiceLesson(exerciseId);
  if (!lesson)
    return <MissingPage title="找不到这个练习" backTo="/courses" backLabel="返回课程目录" />;
  return (
    <div data-page-id="PAGE-04">
      <Breadcrumbs
        items={[
          { label: 'C 语言课程', to: '/courses' },
          { label: lesson.title, to: paths.lesson(lesson.id) },
          { label: lesson.exerciseTitle },
        ]}
      />
      <PageHeading
        kicker="动手练习 · 程序与输入"
        title={lesson.exerciseTitle}
        description="用 C 代码或积木解答，提交后逐步复盘真实执行。"
      />
      <WorkspaceContext>
        <SubjectLearningStatus kind="exercise" id={lesson.exerciseId} />
      </WorkspaceContext>
      <PracticeExecution id={lesson.exerciseId} />
      <p className="muted">积木只生成受支持的 C 程序。返回本节可查看已保存的历史进度。</p>
      <Link className="text-link" to={paths.lesson(lesson.id)}>
        返回本节学习
      </Link>
    </div>
  );
}

function TraceWorkspace({ review }: { review: boolean }) {
  const { state } = useLearning();
  return (
    <>
      <div className="visualization-layout">
        <CodePanel />
        <section
          className="workbench-panel trace-stage"
          data-testid="animation-panel"
          aria-label="动画区域"
        >
          <header className="panel-heading">
            <h2 className="panel-title">
              <Icon name="chart" />
              执行可视化
            </h2>
            <span className="badge badge-muted">尚无轨迹</span>
          </header>
          <div className="panel-body trace-empty">
            <div className="empty-icon">
              <Icon name="chart" />
            </div>
            <StatePanel
              title={review ? '还没有可复盘的运行' : '等待真实执行结果'}
              description={
                review
                  ? '本题尚无当前有效提交。返回练习工作区完成真实运行后，才能复盘代码与数据变化。'
                  : '运行功能接入后，这里会根据真实执行轨迹显示数组与变量变化。'
              }
            />
          </div>
          <div className="player-controls" aria-label="播放控制（尚无可播放轨迹）">
            <div className="control-group">
              <button className="button button-small" disabled>
                后退
              </button>
              <button className="button button-primary button-small" disabled>
                <Icon name="play" />
                播放
              </button>
              <button className="button button-small" disabled>
                前进
              </button>
              <button className="button button-small" disabled>
                重播
              </button>
            </div>
            <label className="muted">
              速度{' '}
              <select
                aria-label="播放速度"
                disabled
                value={state.snapshot?.settings.playbackRate ?? 1}
              >
                {[0.25, 0.5, 1, 1.5, 2, 4].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="workbench-caption">
            有可播放轨迹后，可使用空格暂停/播放、左右方向键单步查看。
          </p>
        </section>
      </div>
      <div className="trace-panels">
        {[
          { title: '变量', description: '暂无变量状态' },
          { title: '数组', description: '暂无数组状态' },
          { title: '输出', description: '暂无输出' },
        ].map((panel) => (
          <section className="card trace-panel" key={panel.title}>
            <h2>{panel.title}</h2>
            <p className="muted">{panel.description}</p>
          </section>
        ))}
      </div>
    </>
  );
}

export function VisualizePage() {
  const { caseId } = useParams();
  const item = cases.find((value) => value.id === caseId);
  if (!item)
    return <MissingPage title="找不到这个案例" backTo="/cases" backLabel="返回算法与演示" />;
  const lesson = lessons.find((value) => value.id === item.lessonId)!;
  return (
    <div data-page-id="PAGE-06" data-mode="case">
      <Breadcrumbs items={[{ label: '算法与演示', to: '/cases' }, { label: item.title }]} />
      <PageHeading
        kicker={item.kind === 'algorithm' ? '算法案例 · 可视化工作区' : '语法演示 · 可视化工作区'}
        title={item.title}
        description={item.description}
      />
      <WorkspaceContext label="案例与输入说明">
        <SubjectLearningStatus kind="case" id={item.id} />
        <CaseSample key={item.id} id={item.id} />
      </WorkspaceContext>
      <CaseExecution key={item.id} id={item.id}>
        <TraceWorkspace review={false} />
      </CaseExecution>
      <div className="inline-actions">
        <Link className="text-link" to="/cases">
          返回案例目录
        </Link>
        <Link className="text-link" to={paths.lesson(lesson.id)}>
          关联小节：{lesson.title}
          <Icon name="arrow" />
        </Link>
      </div>
    </div>
  );
}

export function ReviewPage() {
  const { exerciseId } = useParams();
  const lesson = practiceLesson(exerciseId);
  if (!lesson)
    return <MissingPage title="找不到这个练习复盘" backTo="/courses" backLabel="返回课程目录" />;
  return (
    <div data-page-id="PAGE-06" data-mode="exercise-review">
      <Breadcrumbs
        items={[
          { label: lesson.title, to: paths.lesson(lesson.id) },
          { label: lesson.exerciseTitle, to: paths.practice(lesson.exerciseId) },
          { label: '本次复盘' },
        ]}
      />
      <PageHeading
        kicker="练习复盘 · 当前提交"
        title={`${lesson.exerciseTitle} · 本次复盘`}
        description="复盘共享本题当前有效提交；查看、返回和播放不会重新运行。刷新或离开本题后不恢复临时结果。"
      />
      <WorkspaceContext label="复盘信息">
        <SubjectLearningStatus kind="exercise" id={lesson.exerciseId} />
      </WorkspaceContext>
      <PracticeExecution id={lesson.exerciseId} review />
      <Link className="text-link" to={paths.lesson(lesson.id)}>
        返回本节学习
      </Link>
    </div>
  );
}
