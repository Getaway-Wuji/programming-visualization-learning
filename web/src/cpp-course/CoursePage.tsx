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
import { isCppProgress, cppExercises } from './identities';
import {
  loadCppLesson,
  loadCppManifest,
  type CppCatalogEntry,
  type CppManifest,
} from './repository';
import '../python3/python.css';
import './cpp.css';

const lessonPath = (id: string) => '/cpp/lesson/' + id;
const loadIndex = (_: null, signal: AbortSignal) => loadCppManifest(signal);
const loadDetailedLesson = async (id: string, signal: AbortSignal) => {
  const value = await loadCppLesson(id, signal);
  const lesson = value.lesson;
  const body = await bookTeachingBody(
    'cpp',
    `unit-${String(lesson.group).padStart(2, '0')}`,
    id,
    lesson.title,
    lesson.body,
    signal,
  );
  return { ...value, lesson: { ...lesson, body } };
};

export function CppNav() {
  return <CourseNav language="C++" path="/cpp" />;
}

export function CppLoadState({ failed, retry }: { failed: boolean; retry: () => void }) {
  return <CourseLoadState language="C++" failed={failed} retry={retry} />;
}

export function CppText({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) => (index % 2 ? <code key={index}>{part}</code> : part))}
    </>
  );
}

const runnableLessons = new Set(Object.values(cppExercises).map((profile) => profile.lesson));

function BookCatalog({ index }: { index: CppManifest }) {
  const { state } = useLearning();
  const completed = new Set(
    state.snapshot?.progress
      .filter((row) => row.eventType === 'lesson.completed' && isCppProgress(row))
      .map((row) => row.subjectRef.id),
  );
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const byParent = useMemo(() => {
    const map = new Map<string | null, CppCatalogEntry[]>();
    for (const node of index.catalog) {
      const siblings = map.get(node.parent) ?? [];
      siblings.push(node);
      map.set(node.parent, siblings);
    }
    return map;
  }, [index]);
  const rows = (parent: string | null) => (
    <ul className="cpp-tree">
      {byParent.get(parent)?.map((node) => (
        <li key={node.id}>
          {node.leaf ? (
            <>
              <Link to={lessonPath(node.id)}>
                {node.number} {node.title}
              </Link>
              <CourseMode
                runnable={runnableLessons.has(node.id)}
                practice={runnableLessons.has(node.id)}
                completed={completed.has(node.id)}
              />
            </>
          ) : (
            <details open={node.depth === 1 && node.order === 1 ? true : undefined}>
              <summary>
                {node.number} {node.title}
              </summary>
              <Link className="cpp-guide" to={lessonPath(node.id)}>
                阅读导读
              </Link>
              {rows(node.id)}
            </details>
          )}
        </li>
      ))}
    </ul>
  );
  const matches = term
    ? index.catalog.filter((row) => (row.number + ' ' + row.title).toLowerCase().includes(term))
    : [];
  return (
    <section className="cpp-sheet course-catalog-panel" aria-label="教材目录">
      <h2>教材目录</h2>
      <CourseSearch query={query} change={setQuery} />
      {term ? (
        matches.length ? (
          <ul className="cpp-tree">
            {matches.map((row) => (
              <li key={row.id}>
                <Link to={lessonPath(row.id)}>
                  {row.number} {row.title}
                </Link>
                {row.leaf && (
                  <CourseMode
                    runnable={runnableLessons.has(row.id)}
                    practice={runnableLessons.has(row.id)}
                    completed={completed.has(row.id)}
                  />
                )}{' '}
                <span className="cpp-muted">第 {row.printedPage} 页</span>
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
      (row) => row.eventType === 'lesson.completed' && isCppProgress(row),
    ).length ?? 0;
  const index = resource.value;
  const completed = new Set(
    state.snapshot?.progress
      .filter((row) => row.eventType === 'lesson.completed' && isCppProgress(row))
      .map((row) => row.subjectRef.id),
  );
  const next = index?.catalog.find((node) => node.leaf && !completed.has(node.id));
  const first = index?.catalog.find((node) => node.leaf);
  return (
    <>
      <header className="cpp-title">
        <div>
          <h1 tabIndex={-1}>C++ 课程</h1>
          <p>按教材顺序阅读，用真实程序观察变量、指针和调用帧。</p>
        </div>
        <Link className="button" to="/cpp/workbench">
          打开工作台
        </Link>
      </header>
      {index ? (
        <>
          <CourseProgress
            count={state.snapshot ? count : undefined}
            total={index.counts.leaves}
            label="C++ 阅读进度"
          />
          {(next ?? first) && (
            <CourseNext
              title={(next ?? first!).title}
              to={lessonPath((next ?? first)!.id)}
              started={completed.size > 0}
              complete={!next}
              description="按目录顺序继续未读小节，也可随时打开标为可运行的小节动手观察。"
            />
          )}
          <div className="course-catalog-grid">
            <BookCatalog index={index} />
            <aside className="cpp-sheet course-catalog-panel" aria-label="C++ 课程练习">
              <h2>课程练习</h2>
              <p className="course-help">每题用四组独立输入验证当前代码，阅读与练习分别记录。</p>
              <ul className="cpp-tree">
                {Object.entries(cppExercises).map(([id, profile]) => (
                  <li key={id}>
                    <Link to={'/cpp/practice/' + id}>{profile.title}</Link>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
          <p className="cpp-muted">
            目录来源为《{index.source.title}》，{index.source.author} 编著，{index.source.publisher}
            ，{index.source.year} 年。讲解和练习为平台原创。
          </p>
        </>
      ) : (
        <CppLoadState failed={resource.failed} retry={resource.retry} />
      )}
    </>
  );
}

function Lesson({ id }: { id: string }) {
  const resource = useJavaResource(id, loadDetailedLesson);
  if (!resource.value) return <CppLoadState failed={resource.failed} retry={resource.retry} />;
  const { index, lesson } = resource.value;
  const parent = index.catalog.find((node) => node.id === lesson.parent);
  const children = index.catalog.filter((node) => node.parent === id);
  const previous = index.catalog[lesson.order - 2];
  const next = index.catalog[lesson.order];
  const example = lesson.example;
  const activity = lesson.activity;
  return (
    <article className="cpp-sheet cpp-reading">
      <p className="cpp-muted">
        {parent && (
          <>
            <Link to={lessonPath(parent.id)}>{parent.title}</Link> ·{' '}
          </>
        )}
        教材第 {lesson.printedPage} 页
      </p>
      <h1 tabIndex={-1}>
        {lesson.number} {lesson.title}
      </h1>
      <C6TeachingReading text={lesson.body.join('\n\n')} repeatedTitle={lesson.title} />
      {children.length > 0 && (
        <ul className="cpp-tree">
          {children.map((child) => (
            <li key={child.id}>
              <Link to={lessonPath(child.id)}>
                {child.number} {child.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {example && (
        <section className="cpp-section">
          <h2>{example.mode === 'wasm' ? '可运行示例' : '阅读示例'}</h2>
          {example.mode === 'reading' && <p className="cpp-muted">{example.reason}</p>}
          <p>
            <CppText text={example.description} />
          </p>
          {example.source && (
            <pre>
              <code>{example.source}</code>
            </pre>
          )}
          {example.mode === 'reading' ? (
            example.result && (
              <p>
                <CppText text={example.result} />
              </p>
            )
          ) : (
            <>
              <p>
                输入 {example.cases[0].input.values.join(' ')}，输出{' '}
                <code>{example.cases[0].expected.trimEnd()}</code>。
              </p>
              <Link to={'/cpp/example/' + lesson.id}>运行并观察</Link>
            </>
          )}
        </section>
      )}
      {activity && (
        <section className="cpp-section">
          <h2>{activity.mode === 'judge' ? '动手练习' : '理解自检'}</h2>
          <p>
            <CppText text={activity.prompt} />
          </p>
          {activity.mode === 'judge' ? (
            <Link className="button" to={'/cpp/practice/' + activity.profile}>
              打开练习
            </Link>
          ) : (
            <details>
              <summary>核对答案</summary>
              <p>
                <CppText text={activity.answer} />
              </p>
            </details>
          )}
        </section>
      )}
      {lesson.leaf && <ReadingEnd lessonId={lesson.id} language="cpp" />}
      <CourseReturn path="/cpp" />
      <nav className="cpp-page-turn" aria-label="相邻章节">
        {previous && <Link to={lessonPath(previous.id)}>上一节 · {previous.title}</Link>}
        {next && <Link to={lessonPath(next.id)}>下一节 · {next.title}</Link>}
      </nav>
    </article>
  );
}

export default function CppCoursePage() {
  const { lessonId } = useParams();
  return (
    <div className="python-screen cpp-screen">
      <CppNav />
      {lessonId ? <Lesson id={lessonId} /> : <Catalog />}
    </div>
  );
}
