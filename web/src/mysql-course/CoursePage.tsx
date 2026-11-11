import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  CourseNav,
  CourseReturn,
  CourseLoadState,
  CourseSearch,
  CourseMode,
  CourseProgress,
  CourseNext,
} from '../course-ui/CourseUi';
import { ReadingEnd } from '../c6-learning/ReadingEnd';
import { C6TeachingReading } from '../components/C6TeachingReading';
import { bookTeachingBody } from '../content/book-teaching';
import { useLearning } from '../learning/react';
import { useJavaResource } from '../java/use-resource';
import { isMysqlProgress, mysqlExercises } from './identities';
import {
  loadMysqlLesson,
  loadMysqlManifest,
  type MysqlCatalogEntry,
  type MysqlManifest,
} from './repository';
import './mysql.css';

const lessonPath = (id: string) => '/mysql/lesson/' + id;
const numbered = (node: MysqlCatalogEntry) => node.number + ' ' + node.title;
const loadIndex = (_: null, signal: AbortSignal) => loadMysqlManifest(signal);
const loadDetailedLesson = async (id: string, signal: AbortSignal) => {
  const value = await loadMysqlLesson(id, signal);
  const lesson = value.lesson;
  const body = await bookTeachingBody(
    'mysql',
    `unit-${String(lesson.group).padStart(2, '0')}`,
    id,
    lesson.title,
    lesson.body,
    signal,
  );
  return { ...value, lesson: { ...lesson, body } };
};
export function MysqlNav() {
  return <CourseNav language="MySQL" path="/mysql" />;
}

export function MysqlLoadState({ failed, retry }: { failed: boolean; retry: () => void }) {
  return <CourseLoadState language="MySQL" failed={failed} retry={retry} />;
}

export function MysqlText({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) => (index % 2 ? <code key={index}>{part}</code> : part))}
    </>
  );
}
const runnableLessons = new Set(Object.values(mysqlExercises).map((profile) => profile.lesson));

function BookCatalog({ index }: { index: MysqlManifest }) {
  const { state } = useLearning();
  const completed = new Set(
    state.snapshot?.progress
      .filter((row) => row.eventType === 'lesson.completed' && isMysqlProgress(row))
      .map((row) => row.subjectRef.id),
  );
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const byParent = useMemo(() => {
    const map = new Map<string | null, MysqlCatalogEntry[]>();
    for (const node of index.catalog) {
      const siblings = map.get(node.parent) ?? [];
      siblings.push(node);
      map.set(node.parent, siblings);
    }
    return map;
  }, [index]);
  const rows = (parent: string | null) => (
    <ul className="mysql-tree">
      {byParent.get(parent)?.map((node) => (
        <li key={node.id}>
          {node.leaf ? (
            <>
              <Link to={lessonPath(node.id)}>{numbered(node)}</Link>
              <CourseMode
                runnable={runnableLessons.has(node.id)}
                practice={runnableLessons.has(node.id)}
                completed={completed.has(node.id)}
              />
            </>
          ) : (
            <details open={node.order === 1 ? true : undefined}>
              <summary>{numbered(node)}</summary>
              <Link to={lessonPath(node.id)}>阅读导读</Link>
              {rows(node.id)}
            </details>
          )}
        </li>
      ))}
    </ul>
  );
  const matches = term
    ? index.catalog.filter((node) => (node.number + ' ' + node.title).toLowerCase().includes(term))
    : [];
  return (
    <section className="mysql-sheet course-catalog-panel" aria-label="教材目录">
      <h2>教材目录</h2>
      <CourseSearch query={query} change={setQuery} />
      {term ? (
        matches.length ? (
          <ul className="mysql-tree">
            {matches.map((node) => (
              <li key={node.id}>
                <Link to={lessonPath(node.id)}>{numbered(node)}</Link>
                {node.leaf && (
                  <CourseMode
                    runnable={runnableLessons.has(node.id)}
                    practice={runnableLessons.has(node.id)}
                    completed={completed.has(node.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p role="status">没有匹配的小节。</p>
        )
      ) : (
        rows(null)
      )}
    </section>
  );
}
function Catalog() {
  const { state } = useLearning();
  const resource = useJavaResource(null, loadIndex);
  const count =
    state.snapshot?.progress.filter(
      (row) => row.eventType === 'lesson.completed' && isMysqlProgress(row),
    ).length ?? 0;
  const index = resource.value;
  const completed = new Set(
    state.snapshot?.progress
      .filter((row) => row.eventType === 'lesson.completed' && isMysqlProgress(row))
      .map((row) => row.subjectRef.id),
  );
  const next = index?.catalog.find((node) => node.leaf && !completed.has(node.id));
  const first = index?.catalog.find((node) => node.leaf);
  return (
    <>
      <header className="mysql-title">
        <div>
          <h1 tabIndex={-1}>MySQL 课程</h1>
          <p>从关系与表结构，到查询、数据变更和事务。</p>
        </div>
        <Link className="button" to="/mysql/workbench">
          打开 SQL 工作台
        </Link>
      </header>
      {index ? (
        <>
          <CourseProgress
            count={state.snapshot ? count : undefined}
            total={index.counts.leaves}
            label="MySQL 阅读进度"
          />
          {(next ?? first) && (
            <CourseNext
              title={numbered(next ?? first!)}
              to={lessonPath((next ?? first)!.id)}
              started={completed.size > 0}
              complete={!next}
              description="按目录顺序继续未读小节，也可随时打开标为可运行的小节动手观察。"
            />
          )}
          <div className="mysql-catalog-grid">
            <BookCatalog index={index} />
            <aside className="mysql-sheet course-catalog-panel" aria-label="MySQL 课程练习">
              <h2>课程练习</h2>
              <p>每题用四组独立数据库验证当前 SQL。</p>
              <ul className="mysql-tree">
                {Object.entries(mysqlExercises).map(([id, profile]) => (
                  <li key={id}>
                    <Link to={'/mysql/practice/' + id}>{profile.title}</Link>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </>
      ) : (
        <MysqlLoadState failed={resource.failed} retry={resource.retry} />
      )}
    </>
  );
}
function Lesson({ id }: { id: string }) {
  const resource = useJavaResource(id, loadDetailedLesson);
  if (!resource.value) return <MysqlLoadState failed={resource.failed} retry={resource.retry} />;
  const { index, lesson } = resource.value;
  const parent = index.catalog.find((node) => node.id === lesson.parent);
  const children = index.catalog.filter((node) => node.parent === id);
  const previous = index.catalog[lesson.order - 2],
    next = index.catalog[lesson.order];
  const example = lesson.example,
    activity = lesson.activity;
  return (
    <article className="mysql-sheet mysql-reading">
      {parent && (
        <p className="mysql-muted">
          <Link to={lessonPath(parent.id)}>{numbered(parent)}</Link>
        </p>
      )}
      <h1 tabIndex={-1}>{numbered(lesson)}</h1>
      <C6TeachingReading text={lesson.body.join('\n\n')} repeatedTitle={lesson.title} />
      {children.length > 0 && (
        <ul className="mysql-tree">
          {children.map((child) => (
            <li key={child.id}>
              <Link to={lessonPath(child.id)}>{numbered(child)}</Link>
            </li>
          ))}
        </ul>
      )}
      {example && (
        <section className="mysql-section">
          <h2>{example.mode === 'wasm' ? '可运行示例' : '阅读示例'}</h2>
          <p>
            <MysqlText text={example.description} />
          </p>
          {example.mode === 'reading' && <p className="mysql-muted">{example.reason}</p>}
          <pre>
            <code>{example.source}</code>
          </pre>
          <p>
            <MysqlText text={example.result} />
          </p>
          {example.mode === 'wasm' && (
            <Link to={'/mysql/example/' + lesson.id}>运行并观察数据库</Link>
          )}
        </section>
      )}
      {activity && (
        <section className="mysql-section">
          <h2>{activity.mode === 'judge' ? '动手练习' : '理解自检'}</h2>
          <p>
            <MysqlText text={activity.prompt} />
          </p>
          {activity.mode === 'judge' ? (
            <Link className="button" to={'/mysql/practice/' + activity.profile}>
              打开练习
            </Link>
          ) : (
            <details>
              <summary>核对答案</summary>
              <p>
                <MysqlText text={activity.answer} />
              </p>
            </details>
          )}
          <details>
            <summary>逐层提示</summary>
            {activity.hints.map((hint, at) => (
              <details key={hint}>
                <summary>提示 {at + 1}</summary>
                <p>
                  <MysqlText text={hint} />
                </p>
              </details>
            ))}
          </details>
        </section>
      )}
      {lesson.leaf && <ReadingEnd lessonId={lesson.id} language="mysql" />}
      <CourseReturn path="/mysql" />
      <nav className="mysql-page-turn" aria-label="相邻章节">
        {previous && <Link to={lessonPath(previous.id)}>上一节 · {numbered(previous)}</Link>}
        {next && <Link to={lessonPath(next.id)}>下一节 · {numbered(next)}</Link>}
      </nav>
    </article>
  );
}
export default function MysqlCoursePage() {
  const { lessonId } = useParams();
  return (
    <div className="mysql-screen">
      <MysqlNav />
      {lessonId ? <Lesson key={lessonId} id={lessonId} /> : <Catalog />}
    </div>
  );
}
