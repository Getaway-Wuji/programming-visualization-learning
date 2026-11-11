import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import {
  CourseNav,
  CourseReturn,
  CourseLoadState,
  CourseSearch,
  CourseMode,
  CourseProgress,
  CourseNext,
  CourseResume,
  useCourseNavigation,
} from '../course-ui/CourseUi';
import { ReadingEnd } from '../c6-learning/ReadingEnd';
import { C6TeachingReading } from '../components/C6TeachingReading';
import { useLearning } from '../learning/react';
import type { JavaArticle, JavaCourseNode, JavaManifest } from './content-types';
import { loadJavaArticle, loadJavaManifest } from './repository';
import { useJavaResource } from './use-resource';
import { isJavaProgress, javaTopicId, javaExercises } from './identities';
import { javaLessonIds } from './release.generated';
import '../python3/python.css';
import './java.css';

const loadIndex = (_: null, signal: AbortSignal) => loadJavaManifest(signal);
const coursePath = (order: number, id?: string) => '/java/article/' + order + (id ? '/' + id : '');

export function JavaNavigation() {
  return <CourseNav language="Java" path="/java" />;
}

export function JavaLoadState({ failed, retry }: { failed: boolean; retry: () => void }) {
  return <CourseLoadState language="Java" failed={failed} retry={retry} />;
}

function Catalog({ manifest }: { manifest: JavaManifest }) {
  const navigation = useCourseNavigation('java');
  const { state } = useLearning();
  const completed = new Set(
    state.snapshot?.progress
      .filter((row) => row.eventType === 'lesson.completed' && isJavaProgress(row))
      .map((row) => row.subjectRef.id),
  );
  const [query, setQuery] = useState('');
  const keyword = query.trim().toLocaleLowerCase();
  const leaves = keyword
    ? (navigation.value?.lessons.filter(([, title]) =>
        title.toLocaleLowerCase().includes(keyword),
      ) ?? [])
    : [];
  return (
    <section className="python-catalog course-catalog-panel" aria-label="教材目录">
      <h2>教材目录</h2>
      <CourseSearch query={query} change={setQuery} />
      {manifest.sections.map((section) => {
        const entries = [
          ...manifest.chunks
            .filter((e) => e.parent === section.sourceNodeId)
            .map((e) => ({
              order: e.orderInGroup,
              title: e.titleDisplay,
              path: coursePath(e.articleSourceOrder),
              external: false,
              runnable: Object.values(javaExercises).some(
                (exercise) => exercise.articleOrder === e.articleSourceOrder,
              ),
            })),
          ...manifest.supplementarySidebarLinks
            .filter((e) => e.sourceParent === section.sourceNodeId)
            .map((e) => ({
              order: e.groupOrder,
              title: e.title,
              path: e.url,
              external: true,
              runnable: false,
            })),
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
                    <>
                      <Link to={e.path}>{e.title}</Link>
                      <CourseMode runnable={e.runnable} practice={e.runnable} contains />
                    </>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ) : null;
      })}
      {keyword && leaves.length > 0 && (
        <section aria-label="匹配小节">
          <h2>匹配小节</h2>
          <ul className="python-list">
            {leaves.map(([id, title, path, mode]) => (
              <li key={id}>
                <Link to={path}>{title}</Link>
                <CourseMode
                  runnable={mode !== 'reading'}
                  practice={mode === 'practice'}
                  completed={completed.has(id)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {keyword &&
        leaves.length === 0 &&
        !manifest.chunks.some((entry) =>
          entry.titleDisplay.toLocaleLowerCase().includes(keyword),
        ) &&
        !manifest.supplementarySidebarLinks.some((entry) =>
          entry.title.toLocaleLowerCase().includes(keyword),
        ) && <p role="status">没有匹配的小节。</p>}
    </section>
  );
}

function Tree({ data, order, active }: { data: JavaArticle; order: number; active: string }) {
  const { nodes } = data;
  const { state } = useLearning();
  const completed = new Set(
    state.snapshot?.progress
      .filter((row) => row.eventType === 'lesson.completed' && isJavaProgress(row))
      .map((row) => row.subjectRef.id),
  );
  const runnable = new Set(
    data.examples
      .filter((example) => example.status === 'runnable-required')
      .map((example) => example.id),
  );
  const judged = new Set(
    data.activities
      .filter((activity) => activity.kind === 'rust-judge')
      .map((activity) => activity.id),
  );
  const byParent = new Map<string, JavaCourseNode[]>();
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
        {node.leaf && node.status === 'authored' && (
          <CourseMode
            runnable={runnable.has(node.exampleId ?? '')}
            practice={judged.has(node.activityId ?? '')}
            completed={completed.has(node.platformRef.id)}
          />
        )}
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
  data: JavaArticle;
  order: number;
  section?: string;
}) {
  const { state } = useLearning();
  const completed = new Set(
    state.snapshot?.progress
      .filter((row) => row.eventType === 'lesson.completed' && isJavaProgress(row))
      .map((row) => row.subjectRef.id),
  );
  const unread = data.nodes.find(
    (row) => row.leaf && row.status === 'authored' && !completed.has(row.platformRef.id),
  );
  const [directoryOpen] = useState(() => matchMedia('(min-width: 761px)').matches);
  const node = section ? data.nodes.find((row) => row.platformRef.id === section) : data.nodes[0];
  if (!node)
    return (
      <p role="alert">
        找不到这个小节。 <Link to={coursePath(order)}>返回文章</Link>
      </p>
    );
  if (node.status === 'context-only') {
    let parent = data.nodes.find((value) => value.sourceNodeId === node.parent);
    while (parent?.status === 'context-only') {
      const parentId = parent.parent;
      parent = data.nodes.find((value) => value.sourceNodeId === parentId);
    }
    return <Navigate replace to={coursePath(order, parent?.platformRef.id)} />;
  }
  const example = data.examples.find((value) => value.id === node.exampleId);
  const activity = data.activities.find((value) => value.id === node.activityId);
  const next = data.nodes
    .slice(data.nodes.indexOf(node) + 1)
    .find((row) => row.status !== 'context-only');
  return (
    <div className="python-article-grid">
      <details className="python-directory" open={directoryOpen}>
        <summary>本篇目录</summary>
        <Tree data={data} order={order} active={node.platformRef.id} />
      </details>
      <article className="python-reading" key={node.platformRef.id}>
        <h1 tabIndex={-1}>{node.titleDisplay}</h1>
        {node.leaf && node.status === 'authored' && (
          <CourseMode
            runnable={example?.status === 'runnable-required'}
            practice={activity?.kind === 'rust-judge'}
            completed={completed.has(node.platformRef.id)}
          />
        )}
        {node.goal && <p className="python-goal">{node.goal}</p>}
        {node.body && <C6TeachingReading text={node.body.join('\n\n')} />}
        {data.diagrams?.map((diagram) => (
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
            <C6TeachingReading text={example.prompt} />
            <p className="muted">{example.reason}</p>
            <details>
              <summary>选做自检 · 展开解析</summary>
              <C6TeachingReading text={activity.reveal} />
            </details>
          </section>
        )}
        {example?.status === 'runnable-required' && (
          <section className="python-sheet">
            <h2>可运行示例</h2>
            <pre>{example.source}</pre>
            <Link to={'/java/example/' + order + '/' + node.platformRef.id}>在工作台运行示例</Link>
          </section>
        )}
        {activity?.kind === 'rust-judge' && (
          <section>
            <h2>{activity.title}</h2>
            <p>{activity.task}</p>
            <Link to={'/java/practice/' + activity.id}>打开练习</Link>
          </section>
        )}
        {next && (
          <p>
            <Link to={coursePath(order, next.platformRef.id)}>继续阅读 {next.titleDisplay}</Link>
          </p>
        )}
        {unread && unread.platformRef.id !== node.platformRef.id && (
          <CourseNext
            title={unread.titleDisplay}
            to={coursePath(order, unread.platformRef.id)}
            started={completed.size > 0}
            description="本篇下一步 · 阅读与练习分别记录。"
          />
        )}
        {node.leaf && node.status === 'authored' && (
          <ReadingEnd
            lessonId={node.platformRef.id}
            language="java"
            knowledgeId={node.questionId ? javaTopicId(node.questionId) : undefined}
          />
        )}
        <CourseReturn path="/java" />
      </article>
    </div>
  );
}

function Article({ order, section }: { order: number; section?: string }) {
  const { value, failed, retry } = useJavaResource(order, loadJavaArticle);
  return value ? (
    <ArticleBody data={value} order={order} section={section} />
  ) : (
    <JavaLoadState failed={failed} retry={retry} />
  );
}

export default function JavaCoursePage() {
  const { order, section } = useParams();
  const { state } = useLearning();
  const complete = state.snapshot?.progress.filter(
    (row) => row.eventType === 'lesson.completed' && isJavaProgress(row),
  ).length;
  const { value, failed, retry } = useJavaResource(null, loadIndex);
  return (
    <section className="python-screen java-screen">
      <JavaNavigation />
      {order ? (
        <Article order={Number(order)} section={section} />
      ) : (
        <>
          <header className="course-header">
            <div>
              <h1 tabIndex={-1}>Java 课程</h1>
              <p>按文章阅读，在可运行小节里观察程序的每一步。</p>
            </div>
            <Link className="button button-secondary" to="/java/workbench">
              打开工作台
            </Link>
          </header>
          <CourseProgress count={complete} total={javaLessonIds.length} label="Java 课程完成进度" />
          <CourseResume
            language="java"
            completed={
              new Set(
                state.snapshot?.progress
                  .filter((row) => row.eventType === 'lesson.completed' && isJavaProgress(row))
                  .map((row) => row.subjectRef.id),
              )
            }
          />
          {value ? <Catalog manifest={value} /> : <JavaLoadState failed={failed} retry={retry} />}
        </>
      )}
    </section>
  );
}
