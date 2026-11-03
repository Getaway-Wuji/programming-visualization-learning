import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BugCatalogLink } from '../bugs/BugPanel';
import { Breadcrumbs, PageHeading, StatePanel } from '../components/Ui';
import { C6TeachingReading } from '../components/C6TeachingReading';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { DailyGoalSummary } from '../learning/goal-components';
import { ProfileSummary } from '../learning/profile-components';
import { HomePanel, homePanels } from '../learning/HomePanel';
import type { C6NavigationNode } from '../content/c6-course-types';
import type { C6TeachingChunk, C6TeachingNode } from '../content/c6-teaching-types';
import type { C6LearningIndex } from './index';
import './course.css';
import { C6KnowledgeOverview } from './Knowledge';
import { KnowledgeMarkButton, KnowledgeMarksStatus } from '../review-notebook/marks';

export function C6Boundary({ children }: { children: ReactNode }) {
  const { state, service } = useLearning();
  if (state.c6?.status !== 'ready' || !state.c6.index || !state.c6.manifest)
    return (
      <StatePanel
        kind={state.c6?.status === 'failed' ? 'error' : 'loading'}
        title={state.c6?.status === 'failed' ? '课程暂时无法读取' : '正在准备 C 课程'}
        description={
          state.c6?.status === 'failed'
            ? '请检查连接后重试，课程资源校验通过后才能开始学习。'
            : '正在读取教材目录和学习要求。'
        }
      >
        {state.c6?.status === 'failed' && (
          <button className="button button-primary" onClick={() => void service.start()}>
            重试读取
          </button>
        )}
      </StatePanel>
    );
  return children;
}
export function c6NodePath(index: C6LearningIndex, nodeId: string): string {
  const lesson = index.lessons.find((l) => l[1] === `node.${nodeId}`);
  return lesson ? `/lessons/${lesson[0]}` : `/courses/${nodeId}`;
}
export function C6LegacyLink({ id }: { id: string }) {
  const { state } = useLearning();
  const index = state.c6!.index!;
  const related = index.legacyLinks.find((l) => l.fromRef.id === id)?.relatedSourceNodeRef?.id;
  const node = state.c6!.manifest!.nodes.find((n) => `node.${n.id}` === related);
  return (
    <StatePanel
      kind="empty"
      title="课程内容已更新"
      description="这个地址属于旧课程。请从新版教材继续学习。"
    >
      {node && (
        <Link className="button button-primary" to={c6NodePath(index, node.id)}>
          阅读相关章节：{node.titleDisplay}
        </Link>
      )}
      <Link className="button button-secondary" to="/courses">
        打开课程目录
      </Link>
    </StatePanel>
  );
}
function NodeRows({ nodes }: { nodes: readonly C6NavigationNode[] }) {
  const { state } = useLearning();
  const index = state.c6!.index!;
  return (
    <ul className="c6-node-list">
      {nodes.map((node) => {
        const lesson = index.lessons.find((l) => l[1] === `node.${node.id}`);
        const progress = state.projection?.lessons.find((l) => l.id === lesson?.[0]);
        return (
          <li key={node.id}>
            <Link to={c6NodePath(index, node.id)}>
              <span>{node.titleDisplay}</span>
              <span className="c6-node-detail">
                {node.chunkId === 'chA' || node.chunkId === 'chB'
                  ? '参考资料'
                  : progress?.completed
                    ? '已完成'
                    : progress?.studyConfirmed
                      ? '已阅读 · 待练习'
                      : progress?.started
                        ? '阅读中'
                        : lesson
                          ? '小节'
                          : '展开阅读'}{' '}
                · 书页 {node.physicalPage}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
export function C6HomePage() {
  return (
    <C6Boundary>
      <Home />
    </C6Boundary>
  );
}
function Home() {
  const { state, service } = useLearning();
  const [search, setSearch] = useSearchParams();
  const requested = search.get('panel');
  const panel =
    requested && Object.hasOwn(homePanels, requested)
      ? (requested as keyof typeof homePanels)
      : null;
  const index = state.c6!.index!,
    manifest = state.c6!.manifest!;
  const completed = state.projection?.lessons.filter((l) => l.completed).length ?? 0;
  const started = state.projection?.lessons
    .filter((l) => l.started && !l.completed)
    .sort((a, b) =>
      (b.history.at(-1)?.lastAt ?? '').localeCompare(a.history.at(-1)?.lastAt ?? ''),
    )[0];
  const next =
    index.lessons.find((l) => l[0] === started?.id) ??
    index.lessons.find((l) => !state.projection?.lessons.find((p) => p.id === l[0])?.completed);
  const title = manifest.nodes.find((n) => `node.${n.id}` === next?.[1])?.titleDisplay;
  const pointsConfirmed = !!state.snapshot && !state.recovery?.ledgerUncertain;
  const points = pointsConfirmed
    ? state
        .snapshot!.ledger.reduce((n, l) => n + (l.status === 'posted' ? BigInt(l.points) : 0n), 0n)
        .toString()
    : null;
  return (
    <div className="c6-course-page">
      <PageHeading
        kicker="我的学习"
        title="继续学 C"
        description="按《C Primer Plus》第 6 版的章节顺序，阅读、运行，再动手练习。"
      />
      <div className="c6-home-columns">
        <section className="c6-next-section" aria-labelledby="c6-next-title">
          <p className="muted">
            {state.projection ? `${completed} / 404 个小节已完成` : '正在确认学习进度'}
          </p>
          {state.projection && <progress value={completed} max={404} aria-label="C 课程完成进度" />}
          <h2 id="c6-next-title">{title ?? '全书小节已完成'}</h2>
          {next ? (
            <Link className="button button-primary" to={`/lessons/${next[0]}`}>
              {started ? '继续阅读' : '开始阅读'}
            </Link>
          ) : (
            <Link className="button button-primary" to="/courses">
              回顾全书
            </Link>
          )}
          <Link className="text-link" to="/courses">
            查看课程目录
          </Link>
          <p className="muted">每节主动确认阅读；有配套执行题的小节，还需通过全部判题组。</p>
        </section>
        <div>
          <DailyGoalSummary />
          <p className="inline-actions">
            <Link className="text-link" to="/?panel=goals">
              设置每日目标
            </Link>
            <Link className="text-link" to="/?panel=history">
              查看打卡历史
            </Link>
          </p>
        </div>
      </div>
      <section className="c6-profile-section" aria-label="学习积累">
        <ProfileSummary />
        <div>
          <h2>已入账 {points === null ? '暂不可确认' : `${points} 分`}</h2>
          <p>每个教学组首次完成 20 分，组内首次通过执行题 10 分；每日目标达成 5 分。</p>
          <Link className="text-link" to="/?panel=points">
            查看积分明细
          </Link>
          {state.projection?.ledger.pending.length ? (
            <button className="text-link" onClick={() => void service.settleRewards()}>
              重试待入账奖励
            </button>
          ) : null}
          <details>
            <summary>查看积分记录</summary>
            <ul className="c6-ledger-list">
              {state.snapshot?.ledger
                .slice()
                .reverse()
                .map((l) => (
                  <li key={`${l.sourceId}:${l.subjectId}:${l.localDate}`}>
                    <span>
                      {l.localDate} ·{' '}
                      {l.sourceId === 'reward.lesson.first-completion'
                        ? '教学组完成'
                        : l.sourceId === 'reward.exercise.first-pass'
                          ? '执行练习通过'
                          : l.sourceId === 'reward.daily-goal.once'
                            ? '每日目标'
                            : '学习奖励'}
                    </span>
                    <span>{l.status === 'posted' ? `+${l.points} 分` : '待入账'}</span>
                  </li>
                ))}
            </ul>
            {!pointsConfirmed ? (
              <p className="muted">积分记录暂不可确认，请先恢复本地档案。</p>
            ) : !state.snapshot?.ledger.length ? (
              <p className="muted">完成学习后，积分记录会显示在这里。</p>
            ) : null}
          </details>
        </div>
      </section>
      <C6KnowledgeOverview />
      <LearningSaveStatus />
      {panel && (
        <HomePanel key={panel} panel={panel} dismiss={() => setSearch({}, { replace: true })} />
      )}
    </div>
  );
}
export function C6CoursePage() {
  const { chapterId } = useParams();
  return <C6Boundary>{chapterId ? <SourcePage nodeId={chapterId} /> : <Directory />}</C6Boundary>;
}
function Directory() {
  const { state } = useLearning();
  const [query, setQuery] = useState('');
  const nodes = state.c6!.manifest!.nodes;
  const roots = nodes.filter((n) => n.parentId === null);
  const filtered = nodes.filter((n) =>
    n.titleDisplay.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div className="c6-course-page">
      <PageHeading
        kicker="C 语言课程"
        title="课程目录"
        description="《C Primer Plus》第 6 版 · 17 章 · 404 个学习小节"
      />
      <label className="c6-search">
        查找章节或主题
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例如：14.3.1、结构、指针"
        />
      </label>
      {query.trim() ? (
        <section aria-label="章节搜索结果">
          <p className="muted">找到 {filtered.length} 个目录项</p>
          <NodeRows nodes={filtered} />
          {!filtered.length && <p>没有匹配章节，请换一个关键词。</p>}
        </section>
      ) : (
        <>
          <section aria-labelledby="c6-chapters-title">
            <h2 id="c6-chapters-title">正文章节</h2>
            <NodeRows nodes={roots.filter((n) => n.chunkId !== 'chA' && n.chunkId !== 'chB')} />
          </section>
          <section className="c6-reference-section" aria-labelledby="c6-reference-title">
            <h2 id="c6-reference-title">参考资料</h2>
            <p className="muted">附录 A、B 用于查阅，不计入课程完成进度与奖励。</p>
            <NodeRows nodes={roots.filter((n) => n.chunkId === 'chA' || n.chunkId === 'chB')} />
          </section>
          <BugCatalogLink />
        </>
      )}
    </div>
  );
}
export function C6LessonPage() {
  const { lessonId = '' } = useParams();
  const { state } = useLearning();
  const lesson = state.c6?.index?.lessons.find((l) => l[0] === lessonId);
  return (
    <C6Boundary>
      {lesson ? <SourcePage nodeId={lesson[1].slice(5)} /> : <C6LegacyLink id={lessonId} />}
    </C6Boundary>
  );
}
function SourcePage({ nodeId }: { nodeId: string }) {
  const { state, service } = useLearning();
  const nav = state.c6!.manifest!.nodes.find((n) => n.id === nodeId);
  const [loaded, setLoaded] = useState<{
    key: string;
    node: C6TeachingNode;
    chunk: C6TeachingChunk;
  } | null>(null);
  const [failed, setFailed] = useState('');
  const [attempt, retry] = useState(0);
  const [saveError, setSaveError] = useState<{ nodeId: string; epoch: number } | null>(null);
  useEffect(() => {
    if (!nav) return;
    const abort = new AbortController();
    void service
      .courseRepository()
      .loadChunk(nav.chunkId, abort.signal)
      .then((chunk) => {
        const node = chunk.nodes.find((n) => n.sourceNodeId === nodeId);
        if (!node) throw Error('missing node');
        if (!abort.signal.aborted) {
          setLoaded({ key: nodeId, node, chunk });
          setFailed('');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(nodeId);
      });
    return () => abort.abort();
  }, [service, nodeId, nav, attempt]);
  if (!nav) return <C6LegacyLink id={nodeId} />;
  const index = state.c6!.index!,
    manifest = state.c6!.manifest!;
  const node = loaded?.key === nodeId ? loaded.node : null;
  const chunk = loaded?.key === nodeId ? loaded.chunk : null;
  const lesson = index.lessons.find((l) => l[1] === `node.${nodeId}`);
  const progress = state.projection?.lessons.find((l) => l.id === lesson?.[0]);
  const parent = manifest.nodes.find((n) => n.id === nav.parentId);
  const children = manifest.nodes.filter((n) => n.parentId === nodeId);
  const currentAt = index.lessons.findIndex((l) => l[0] === lesson?.[0]);
  const next = currentAt >= 0 ? index.lessons[currentAt + 1] : null;
  const guides =
    chunk?.activities.filter(
      (a) => a.sourceNodeRef.id === `node.${nodeId}` && a.kind === 'source-design-guide',
    ) ?? [];
  return (
    <div className="c6-course-page c6-reading-page">
      <Breadcrumbs
        items={[
          { label: '课程目录', to: '/courses' },
          ...(parent ? [{ label: parent.titleDisplay, to: c6NodePath(index, parent.id) }] : []),
          { label: nav.titleDisplay },
        ]}
      />
      <PageHeading
        kicker={
          nav.chunkId === 'chA' || nav.chunkId === 'chB' ? '参考资料' : 'C Primer Plus · 第 6 版'
        }
        title={nav.titleDisplay}
        description={`教材书页 ${nav.physicalPage}`}
      />
      {!node && (
        <StatePanel
          kind={failed === nodeId ? 'error' : 'loading'}
          title={failed === nodeId ? '本节内容读取失败' : '正在读取本节'}
          description="正文和代码按章节加载。"
        >
          {failed === nodeId && (
            <button className="button button-secondary" onClick={() => retry((n) => n + 1)}>
              重试本节
            </button>
          )}
        </StatePanel>
      )}
      {node && (
        <>
          <C6TeachingReading
            text={
              node.body.startsWith(`# ${nav.titleDisplay}\n`)
                ? node.body.slice(nav.titleDisplay.length + 3)
                : node.body
            }
          />
          {node.programRefs.length > 0 && (
            <section className="c6-section" aria-labelledby="c6-programs-title">
              <h2 id="c6-programs-title">本节完整程序</h2>
              <ul className="c6-node-list">
                {node.programRefs.map((ref) => {
                  const program = chunk!.programs.find((p) => p.ref.id === ref.id)!;
                  return (
                    <li key={ref.id}>
                      <Link to={`/c6/program/${ref.id}?node=${encodeURIComponent(nodeId)}`}>
                        <span>{program.title}</span>
                        <span className="c6-node-detail">
                          {program.mode === 'reading' ? '阅读完整代码与边界' : '打开运行与逐步回放'}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {guides.length > 0 && (
            <section className="c6-section">
              <h2>来源习题指导 · 选做</h2>
              <p className="muted">用于思考与自行设计；阅读指导不记为原题代码通过。</p>
              {guides.map(
                (guide) =>
                  guide.kind === 'source-design-guide' && (
                    <details key={guide.ref.id}>
                      <summary>{guide.goal}</summary>
                      <C6TeachingReading text={guide.discussion} />
                    </details>
                  ),
              )}
            </section>
          )}
          {lesson && (
            <section className="c6-reading-confirmation" aria-label="本节学习要求">
              <h2>{progress?.completed ? '本节已完成' : '本节学习要求'}</h2>
              <p>
                {progress?.studyConfirmed ? '已确认阅读。' : '读完本节后，请主动确认阅读。'}
                {lesson[5].length ? '配套练习全部通过后完成本节。' : '本节完成阅读确认即可完成。'}
              </p>
              <button
                className="button button-primary"
                disabled={
                  !state.capabilities.learning ||
                  state.status === 'saving' ||
                  state.status === 'readonly' ||
                  !!progress?.studyConfirmed
                }
                onClick={() => {
                  setSaveError(null);
                  void service
                    .recordLesson(lesson[0], true, state.sessionEpoch)
                    .catch(() => setSaveError({ nodeId, epoch: state.sessionEpoch }));
                }}
              >
                {progress?.studyConfirmed ? '已确认阅读' : '我已读完本节'}
              </button>
              {progress?.studyConfirmed && (
                <button
                  className="button button-secondary"
                  disabled={
                    !state.capabilities.learning ||
                    state.status === 'saving' ||
                    state.status === 'readonly'
                  }
                  onClick={() => {
                    setSaveError(null);
                    void service
                      .recordLesson(lesson[0], true, state.sessionEpoch)
                      .catch(() => setSaveError({ nodeId, epoch: state.sessionEpoch }));
                  }}
                >
                  确认今日复习
                </button>
              )}
              {saveError?.nodeId === nodeId &&
                saveError.epoch === state.sessionEpoch &&
                !progress?.studyConfirmed && <p role="alert">阅读确认未保存，请重试。</p>}
              {lesson[5].map((id) => (
                <p key={id}>
                  <Link className="text-link" to={`/practice/${id}`}>
                    {state.projection?.exercises.find((e) => e.id === id)?.passed
                      ? '回顾已通过的配套练习'
                      : '完成配套执行练习'}
                  </Link>
                </p>
              ))}
              <p>
                <KnowledgeMarkButton lessonId={lesson[0]} knowledgeId={lesson[3]} />
              </p>
              <KnowledgeMarksStatus />
            </section>
          )}
          {children.length > 0 && (
            <section className="c6-section">
              <h2>本部分目录</h2>
              <NodeRows nodes={children} />
            </section>
          )}
          {next && (
            <nav className="c6-next-link" aria-label="下一小节">
              <Link className="text-link" to={`/lessons/${next[0]}`}>
                下一小节：{manifest.nodes.find((n) => `node.${n.id}` === next[1])?.titleDisplay}
              </Link>
            </nav>
          )}
          {lesson && <LearningSaveStatus />}
        </>
      )}
    </div>
  );
}
