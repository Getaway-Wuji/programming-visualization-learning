import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ReadingEnd } from '../c6-learning/ReadingEnd';
import { useLearning } from '../learning/react';
import type { PythonArticle, PythonCourseNode, PythonManifest } from './content-types';
import { loadPythonArticle, loadPythonManifest } from './repository';
import { usePythonResource } from './use-resource';
import { isPythonProgress, pythonTopicId } from './identities';
import { pythonLessonIds } from './release.generated';
import './python.css';

const loadIndex = (_: null, signal: AbortSignal) => loadPythonManifest(signal);
const coursePath = (order: number, id?: string) =>
  '/python/article/' + order + (id ? '/' + id : '');

export function PythonNavigation() {
  return (
    <nav className="python-nav" aria-label="Python">
      <Link to="/python">Python 课程</Link>
      <Link to="/python/workbench">Python 工作台</Link>
      <Link to="/python/review">Python 复盘</Link>
      <Link to="/courses">C 语言课程</Link>
      <Link to="/java/workbench">Java 工作台</Link>
    </nav>
  );
}

export function PythonLoadState({ failed, retry }: { failed: boolean; retry: () => void }) {
  return failed ? (
    <p role="alert">
      课程内容暂时无法读取。 <button onClick={retry}>重试</button>
    </p>
  ) : (
    <p role="status">正在加载 Python 课程…</p>
  );
}

function Catalog({ manifest }: { manifest: PythonManifest }) {
  const [query, setQuery] = useState('');
  const keyword = query.trim().toLocaleLowerCase();
  return (
    <div className="python-catalog">
      <label>
        查找文章{' '}
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {manifest.sections.map((section) => {
        const entries = [
          ...manifest.chunks
            .filter((e) => e.parent === section.sourceNodeId)
            .map((e) => ({
              order: e.orderInGroup,
              title: e.titleDisplay,
              path: coursePath(e.articleSourceOrder),
              external: false,
            })),
          ...manifest.supplementarySidebarLinks
            .filter((e) => e.sourceParent === section.sourceNodeId)
            .map((e) => ({ order: e.groupOrder, title: e.title, path: e.url, external: true })),
        ]
          .filter((entry) => entry.title.toLocaleLowerCase().includes(keyword))
          .sort((a, b) => a.order - b.order);
        return entries.length ? (
          <section key={section.sourceNodeId}>
            <h2>{section.titleOriginal ?? '基础教程'}</h2>
            <ol className="python-list">
              {entries.map((e) => (
                <li key={e.path} value={e.order}>
                  {e.external ? (
                    <a href={e.path} rel="noreferrer">
                      {e.title}（来源参考）
                    </a>
                  ) : (
                    <Link to={e.path}>{e.title}</Link>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ) : null;
      })}
      {keyword &&
        !manifest.chunks.some((entry) =>
          entry.titleDisplay.toLocaleLowerCase().includes(keyword),
        ) &&
        !manifest.supplementarySidebarLinks.some((entry) =>
          entry.title.toLocaleLowerCase().includes(keyword),
        ) && <p>未找到匹配的文章。</p>}
    </div>
  );
}

function Tree({
  nodes,
  order,
  active,
}: {
  nodes: PythonCourseNode[];
  order: number;
  active: string;
}) {
  const byParent = new Map<string, PythonCourseNode[]>();
  for (const node of nodes) {
    const children = byParent.get(node.parent);
    if (children) children.push(node);
    else byParent.set(node.parent, [node]);
  }
  const list = (parent: string) =>
    byParent.get(parent)?.map((node) => (
      <li key={node.sourceNodeId}>
        <Link
          to={coursePath(order, node.platformRef.id)}
          aria-current={node.platformRef.id === active ? 'page' : undefined}
        >
          {node.titleDisplay}
          {node.status === 'context-only' ? '（示例标题）' : ''}
        </Link>
        {byParent.has(node.sourceNodeId) && <ul>{list(node.sourceNodeId)}</ul>}
      </li>
    ));
  return <ul className="python-tree">{list(nodes[0].parent)}</ul>;
}

function ArticleBody({
  data,
  order,
  section,
}: {
  data: PythonArticle;
  order: number;
  section?: string;
}) {
  const node = section ? data.nodes.find((row) => row.platformRef.id === section) : data.nodes[0];
  if (!node)
    return (
      <p role="alert">
        找不到这个小节。 <Link to={coursePath(order)}>返回文章</Link>
      </p>
    );
  const example = data.examples.find((value) => value.id === node.exampleId);
  const activity = data.activities.find((value) => value.id === node.activityId);
  const source = node.sourceRef + (node.anchor ? '#' + encodeURIComponent(node.anchor) : '');
  const next = data.nodes
    .slice(data.nodes.indexOf(node) + 1)
    .find((row) => row.status !== 'context-only');
  return (
    <div className="python-article-grid">
      <details className="python-directory" open>
        <summary>本篇目录</summary>
        <Tree nodes={data.nodes} order={order} active={node.platformRef.id} />
      </details>
      <article className="python-reading" key={node.platformRef.id}>
        <h1 tabIndex={-1}>{node.titleDisplay}</h1>
        {node.status === 'context-only' && (
          <p>
            这是原文章中的示例标题。
            <Link
              to={coursePath(
                order,
                data.nodes.find((value) => value.sourceNodeId === node.parent)?.platformRef.id,
              )}
            >
              返回上级内容
            </Link>
          </p>
        )}
        {node.goal && <p className="python-goal">{node.goal}</p>}
        {node.body?.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
        {!section &&
          data.diagrams?.map((diagram) => (
            <section key={diagram.title}>
              <h2>{diagram.title}</h2>
              <ol>
                {diagram.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          ))}
        {example?.status === 'reading-only' && activity?.kind === 'optional-self-check' && (
          <section className="python-sheet">
            <h2>阅读示例</h2>
            <p>{example.prompt}</p>
            <p className="muted">{example.reason}</p>
            <details>
              <summary>选做自检 · 展开解析</summary>
              <p>{activity.reveal}</p>
            </details>
          </section>
        )}
        {example?.status === 'runnable-required' && (
          <section className="python-sheet">
            <h2>可运行示例</h2>
            <pre>{example.source}</pre>
            <Link to={'/python/example/' + order + '/' + node.platformRef.id}>
              在工作台运行示例
            </Link>
          </section>
        )}
        {activity?.kind === 'rust-judge' && (
          <section>
            <h2>{activity.title}</h2>
            <p>{activity.task}</p>
            <Link to={'/python/practice/' + activity.id}>打开练习</Link>
          </section>
        )}
        {node.status === 'reference-only' && data.references.length > 0 && (
          <ul>
            {data.references.map((ref, index) => (
              <li key={ref.url + index}>
                <a href={ref.url} rel="noreferrer">
                  {ref.title}
                </a>
              </li>
            ))}
          </ul>
        )}
        <p>
          <a href={source} rel="noreferrer">
            来源文章
          </a>
        </p>
        {!section &&
          data.supplementalSources?.map((ref) => (
            <p key={ref.url}>
              <a href={ref.url} rel="noreferrer">
                {ref.title}
              </a>
            </p>
          ))}
        {next && (
          <p>
            <Link to={coursePath(order, next.platformRef.id)}>继续阅读 {next.titleDisplay}</Link>
          </p>
        )}
        {node.leaf && node.status === 'authored' && (
          <ReadingEnd
            lessonId={node.platformRef.id}
            language="python"
            knowledgeId={node.questionId ? pythonTopicId(node.questionId) : undefined}
          />
        )}
      </article>
    </div>
  );
}

function Article({ order, section }: { order: number; section?: string }) {
  const { value, failed, retry } = usePythonResource(order, loadPythonArticle);
  return value ? (
    <ArticleBody data={value} order={order} section={section} />
  ) : (
    <PythonLoadState failed={failed} retry={retry} />
  );
}

export default function PythonCoursePage() {
  const { order, section } = useParams();
  const { state } = useLearning();
  const complete = state.snapshot?.progress.filter(
    (row) => row.eventType === 'lesson.completed' && isPythonProgress(row),
  ).length;
  const { value, failed, retry } = usePythonResource(null, loadIndex);
  return (
    <section className="python-screen">
      <PythonNavigation />
      {order ? (
        <Article order={Number(order)} section={section} />
      ) : (
        <>
          <h1 tabIndex={-1}>Python 3 课程</h1>
          <p className="muted">按文章阅读，在可运行小节里观察程序的每一步。</p>
          {complete !== undefined && (
            <label className="python-course-progress">
              已读 {complete} / {pythonLessonIds.length} 小节
              <progress
                aria-label="Python 课程完成进度"
                value={complete}
                max={pythonLessonIds.length}
              />
            </label>
          )}
          {value ? <Catalog manifest={value} /> : <PythonLoadState failed={failed} retry={retry} />}
        </>
      )}
    </section>
  );
}
