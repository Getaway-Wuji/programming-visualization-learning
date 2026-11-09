import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  CourseNav,
  CourseLoadState,
  CourseSearch,
  CourseMode,
  CourseProgress,
  CourseNext,
} from '../course-ui/CourseUi';
import { ReadingEnd } from '../c6-learning/ReadingEnd';
import { useLearning } from '../learning/react';
import { useJavaResource } from '../java/use-resource';
import { isRustProgress, rustExercises } from './identities';
import {
  loadRustLesson,
  loadRustManifest,
  type RustCatalogEntry,
  type RustManifest,
} from './repository';
import '../python3/python.css';
import './rust.css';

const lessonPath = (id: string) => '/rust/lesson/' + id;
const loadIndex = (_: null, signal: AbortSignal) => loadRustManifest(signal);

export function RustNav() {
  return <CourseNav language="Rust" path="/rust" />;
}

export function RustLoadState({ failed, retry }: { failed: boolean; retry: () => void }) {
  return <CourseLoadState language="Rust" failed={failed} retry={retry} />;
}

export function RustText({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) => (index % 2 ? <code key={index}>{part}</code> : part))}
    </>
  );
}

const runnableLessons = new Set(Object.values(rustExercises).map((profile) => profile.lesson));

function BookCatalog({ index }: { index: RustManifest }) {
  const { state } = useLearning();
  const completed = new Set(
    state.snapshot?.progress
      .filter((row) => row.eventType === 'lesson.completed' && isRustProgress(row))
      .map((row) => row.subjectRef.id),
  );
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const byParent = useMemo(() => {
    const map = new Map<string | null, RustCatalogEntry[]>();
    for (const node of index.catalog) {
      const siblings = map.get(node.parent) ?? [];
      siblings.push(node);
      map.set(node.parent, siblings);
    }
    return map;
  }, [index]);
  const rows = (parent: string | null) => (
    <ul className="rust-tree">
      {byParent.get(parent)?.map((node) => (
        <li key={node.id}>
          {node.leaf ? (
            <>
              <Link to={lessonPath(node.id)}>{node.title}</Link>
              <CourseMode
                runnable={runnableLessons.has(node.id)}
                practice={runnableLessons.has(node.id)}
                completed={completed.has(node.id)}
              />
            </>
          ) : (
            <details open={node.depth === 1 && node.order === 1 ? true : undefined}>
              <summary>{node.title}</summary>
              <Link className="rust-guide" to={lessonPath(node.id)}>
                阅读导读
              </Link>
              {rows(node.id)}
            </details>
          )}
        </li>
      ))}
    </ul>
  );
  const matches = term ? index.catalog.filter((row) => row.title.toLowerCase().includes(term)) : [];
  return (
    <section className="rust-sheet course-catalog-panel" aria-label="教材目录">
      <h2>教材目录</h2>
      <CourseSearch query={query} change={setQuery} />
      {term ? (
        matches.length ? (
          <ul className="rust-tree">
            {matches.map((row) => (
              <li key={row.id}>
                <Link to={lessonPath(row.id)}>{row.title}</Link>
                {row.leaf && (
                  <CourseMode
                    runnable={runnableLessons.has(row.id)}
                    practice={runnableLessons.has(row.id)}
                    completed={completed.has(row.id)}
                  />
                )}{' '}
                <span className="rust-muted">PDF 第 {row.physicalPage} 页</span>
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
      (row) => row.eventType === 'lesson.completed' && isRustProgress(row),
    ).length ?? 0;
  const index = resource.value;
  const completed = new Set(
    state.snapshot?.progress
      .filter((row) => row.eventType === 'lesson.completed' && isRustProgress(row))
      .map((row) => row.subjectRef.id),
  );
  const next = index?.catalog.find((node) => node.leaf && !completed.has(node.id));
  const first = index?.catalog.find((node) => node.leaf);
  return (
    <>
      <header className="rust-title">
        <div>
          <h1 tabIndex={-1}>Rust 课程</h1>
          <p>按教材顺序阅读，观察变量、所有权、借用和函数调用。</p>
        </div>
        <Link className="button" to="/rust/workbench">
          打开工作台
        </Link>
      </header>
      {index ? (
        <>
          <CourseProgress
            count={state.snapshot ? count : undefined}
            total={index.counts.leaves}
            label="Rust 阅读进度"
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
          <div className="rust-catalog-grid">
            <BookCatalog index={index} />
            <section className="rust-sheet course-catalog-panel" aria-label="Rust 课程练习">
              <h2>课程练习</h2>
              <p className="rust-muted">从基础输出到所有权与借用，每题用四组输入验证当前代码。</p>
              <ul className="rust-tree">
                {Object.entries(rustExercises).map(([id, profile]) => (
                  <li key={id}>
                    <Link to={'/rust/practice/' + id}>{profile.title}</Link>
                  </li>
                ))}
              </ul>
              <p className="rust-muted">阅读与练习分别记录。学过的小节也可以随时回来复习。</p>
            </section>
          </div>
          <p className="rust-muted">
            目录来源为《{index.source.title}》，{index.source.authors.join('、')} 著，
            {index.source.publisher}，{index.source.edition}。讲解和练习为平台原创。
          </p>
        </>
      ) : (
        <RustLoadState failed={resource.failed} retry={resource.retry} />
      )}
    </>
  );
}

function Lesson({ id }: { id: string }) {
  const resource = useJavaResource(id, loadRustLesson);
  if (!resource.value) return <RustLoadState failed={resource.failed} retry={resource.retry} />;
  const { index, lesson } = resource.value;
  const parent = index.catalog.find((node) => node.id === lesson.parent);
  const children = index.catalog.filter((node) => node.parent === id);
  const previous = index.catalog[lesson.order - 2];
  const next = index.catalog[lesson.order];
  const example = lesson.example;
  const activity = lesson.activity;
  return (
    <article className="rust-sheet rust-reading">
      <p className="rust-muted">
        {parent && (
          <>
            <Link to={lessonPath(parent.id)}>{parent.title}</Link> ·{' '}
          </>
        )}
        PDF 第 {lesson.physicalPage} 页
      </p>
      <h1 tabIndex={-1}>{lesson.title}</h1>
      {lesson.body.map((text) => (
        <p key={text}>
          <RustText text={text} />
        </p>
      ))}
      {children.length > 0 && (
        <ul className="rust-tree">
          {children.map((child) => (
            <li key={child.id}>
              <Link to={lessonPath(child.id)}>{child.title}</Link>
            </li>
          ))}
        </ul>
      )}
      {example && (
        <section className="rust-section">
          <h2>{example.mode === 'wasm' ? '可运行示例' : '阅读示例'}</h2>
          {example.mode === 'reading' && <p className="rust-muted">{example.reason}</p>}
          <p>
            <RustText text={example.description} />
          </p>
          {example.source && (
            <pre>
              <code>{example.source}</code>
            </pre>
          )}
          {example.mode === 'reading' ? (
            example.result && (
              <p>
                <RustText text={example.result} />
              </p>
            )
          ) : (
            <>
              <p>
                输入 <code>{example.cases?.[0].input.trimEnd()}</code>，输出{' '}
                <code>{example.cases?.[0].expected.trimEnd()}</code>。
              </p>
              <Link to={'/rust/example/' + lesson.id}>运行并观察</Link>
            </>
          )}
        </section>
      )}
      {activity && (
        <section className="rust-section">
          <h2>{activity.mode === 'judge' ? '动手练习' : '理解自检'}</h2>
          <p>
            <RustText text={activity.prompt} />
          </p>
          {activity.mode === 'judge' ? (
            <Link className="button" to={'/rust/practice/' + activity.profile}>
              打开练习
            </Link>
          ) : (
            <details>
              <summary>核对答案</summary>
              <p>
                <RustText text={activity.answer} />
              </p>
            </details>
          )}
        </section>
      )}
      {lesson.leaf && <ReadingEnd lessonId={lesson.id} language="rust" />}
      <nav className="rust-page-turn" aria-label="相邻章节">
        {previous && <Link to={lessonPath(previous.id)}>上一节 · {previous.title}</Link>}
        {next && <Link to={lessonPath(next.id)}>下一节 · {next.title}</Link>}
      </nav>
    </article>
  );
}

export default function RustCoursePage() {
  const { lessonId } = useParams();
  return (
    <div className="python-screen rust-screen">
      <RustNav />
      {lessonId ? <Lesson id={lessonId} /> : <Catalog />}
    </div>
  );
}
