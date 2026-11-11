import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BugCatalogLink } from '../bugs/BugCatalogLink';
import { Breadcrumbs, PageHeading, StatePanel } from '../components/Ui';
import { C6TeachingReading } from '../components/C6TeachingReading';
import { bookTeachingBody } from '../content/book-teaching';
import { CourseReturn } from '../course-ui/CourseUi';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { DailyGoalSummary } from '../learning/goal-components';
import { HomePanel, homePanels } from '../learning/HomePanel';
import type { C6NavigationNode } from '../content/c6-course-types';
import type { C6TeachingChunk, C6TeachingNode } from '../content/c6-teaching-types';
import type { C6LearningIndex } from './index';
import './course.css';
import { C6KnowledgeOverview } from './Knowledge';
import { ReadingEnd } from './ReadingEnd';
import { languages, recentLearningLanguage } from '../learning/languages';
import { LanguageStudyCard } from '../learning/LanguageStudyCard';

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
                          : '展开阅读'}
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
  const { state } = useLearning();
  const [search, setSearch] = useSearchParams();
  const requested = search.get('panel');
  const panel =
    requested && Object.hasOwn(homePanels, requested)
      ? (requested as keyof typeof homePanels)
      : null;
  const index = state.c6!.index!,
    manifest = state.c6!.manifest!;
  const selectedLanguage =
    languages.find((item) => item.id === search.get('language')) ??
    languages.find((item) => item.id === recentLearningLanguage(state.snapshot))!;
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
  return (
    <div className="c6-course-page">
      <PageHeading
        kicker="我的学习"
        title={`继续学 ${selectedLanguage.label}`}
        description={
          selectedLanguage.id === 'c'
            ? '按章节顺序阅读、运行，再动手练习。'
            : '接着最近的学习进度，阅读、自检，并在工作台观察真实执行。'
        }
      />
      <div className="learning-language-picker" aria-label="选择学习语言">
        {languages.map((language) => (
          <button
            key={language.id}
            type="button"
            aria-pressed={selectedLanguage.id === language.id}
            onClick={() =>
              setSearch(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.set('language', language.id);
                  return next;
                },
                { replace: true },
              )
            }
          >
            {language.label}
          </button>
        ))}
      </div>
      <div className="c6-home-columns">
        {selectedLanguage.id !== 'c' ? (
          <LanguageStudyCard language={selectedLanguage.id} />
        ) : (
          <section className="card c6-next-section" aria-labelledby="c6-next-title">
            <p className="muted">
              {state.projection ? `${completed} / 404 个小节已完成` : '正在确认学习进度'}
            </p>
            {state.projection && (
              <progress value={completed} max={404} aria-label="C 课程完成进度" />
            )}
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
            <p className="muted">读到页末自动完成小节，练习可以从左侧菜单随时进入。</p>
            <div className="c6-home-practice-shortcuts">
              <h3>动手练习</h3>
              <div className="inline-actions">
                <Link className="text-link" to="/practice">
                  进入练习 →
                </Link>
                <Link className="text-link" to="/bugs">
                  Bug 修复闯关 →
                </Link>
              </div>
            </div>
          </section>
        )}
        <div className="card c6-goal-section">
          <DailyGoalSummary language={selectedLanguage.id} />
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
      <section className="card c6-course-switcher" aria-label="其他课程">
        <h2>课程与复盘</h2>
        <div className="inline-actions">
          <Link className="text-link" to={selectedLanguage.directory}>
            {selectedLanguage.label} 课程目录
          </Link>
          <Link className="text-link" to={selectedLanguage.workbench}>
            {selectedLanguage.label} 工作台
          </Link>
          <Link className="text-link" to={selectedLanguage.review}>
            {selectedLanguage.label} 学习复盘
          </Link>
          <Link className="text-link" to="/notebook">
            全部语言复盘入口
          </Link>
        </div>
      </section>
      {selectedLanguage.id === 'c' && <C6KnowledgeOverview />}
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
      <PageHeading kicker="C 语言课程" title="课程目录" description="17 章 · 404 个学习小节" />
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
          <p className="inline-actions">
            <Link className="button button-primary" to="/practice">
              进入练习
            </Link>
          </p>
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
  useEffect(() => {
    if (!nav) return;
    const abort = new AbortController();
    void service
      .courseRepository()
      .loadChunk(nav.chunkId, abort.signal)
      .then(async (chunk) => {
        const node = chunk.nodes.find((n) => n.sourceNodeId === nodeId);
        if (!node) throw Error('missing node');
        const body = await bookTeachingBody(
          'c',
          nav.chunkId,
          nodeId,
          node.titleDisplay,
          [node.body],
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setLoaded({ key: nodeId, node: { ...node, body: body.join('\n\n') }, chunk });
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
      <CourseReturn path="/courses" />
      <Breadcrumbs
        items={[
          { label: '课程目录', to: '/courses' },
          ...(parent ? [{ label: parent.titleDisplay, to: c6NodePath(index, parent.id) }] : []),
          { label: nav.titleDisplay },
        ]}
      />
      <PageHeading
        kicker={nav.chunkId === 'chA' || nav.chunkId === 'chB' ? '参考资料' : 'C 语言课程'}
        title={nav.titleDisplay}
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
          {lesson && lesson[5].length > 0 && (
            <section className="c6-section c6-section-practice">
              <h2>动手练习</h2>
              {lesson[5].map((id) => (
                <Link key={id} className="button button-secondary" to={`/practice/${id}`}>
                  {state.projection?.exercises.find((e) => e.id === id)?.passed
                    ? '去练习（已通过）'
                    : '去练习'}
                </Link>
              ))}
            </section>
          )}
          {lesson && <ReadingEnd key={lesson[0]} lessonId={lesson[0]} knowledgeId={lesson[3]} />}
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
          <CourseReturn path="/courses" />
        </>
      )}
    </div>
  );
}
