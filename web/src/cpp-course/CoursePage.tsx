import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ReadingEnd } from '../c6-learning/ReadingEnd';
import { useLearning } from '../learning/react';
import { useJavaResource } from '../java/use-resource';
import { isCppProgress } from './identities';
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

export function CppNav() {
  return (
    <nav className="python-nav cpp-nav" aria-label="C++ 学习">
      <Link to="/cpp">C++ 目录</Link>
      <Link to="/cpp/workbench">工作台</Link>
      <Link to="/cpp/review">复盘</Link>
      <span className="cpp-language-links">
        <Link to="/custom-code">C</Link>
        <Link to="/python/workbench">Python</Link>
        <Link to="/java/workbench">Java</Link>
      </span>
    </nav>
  );
}

export function CppLoadState({ failed, retry }: { failed: boolean; retry: () => void }) {
  return failed ? (
    <p role="alert">
      暂时无法读取 C++ 课程。 <button onClick={retry}>重试</button>
    </p>
  ) : (
    <p role="status">正在读取 C++ 课程…</p>
  );
}

export function CppText({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) => (index % 2 ? <code key={index}>{part}</code> : part))}
    </>
  );
}

function BookCatalog({ index }: { index: CppManifest }) {
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
            <Link to={lessonPath(node.id)}>
              {node.number} {node.title}
            </Link>
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
    <section className="cpp-sheet" aria-label="教材目录">
      <label className="cpp-search">
        搜索目录{' '}
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {term ? (
        matches.length ? (
          <ul className="cpp-tree">
            {matches.map((row) => (
              <li key={row.id}>
                <Link to={lessonPath(row.id)}>
                  {row.number} {row.title}
                </Link>{' '}
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
  return (
    <>
      <header className="cpp-title">
        <div>
          <h1>C++ 课程</h1>
          <p>按教材顺序阅读，用真实程序观察变量、指针和调用帧。</p>
        </div>
        <Link className="button" to="/cpp/workbench">
          打开工作台
        </Link>
      </header>
      {index ? (
        <>
          <div className="cpp-reading-progress">
            <span>
              已读 {count} / {index.counts.leaves} 小节
            </span>
            <progress value={count} max={index.counts.leaves} aria-label="C++ 阅读进度" />
          </div>
          <BookCatalog index={index} />
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
  const resource = useJavaResource(id, loadCppLesson);
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
      <h1>
        {lesson.number} {lesson.title}
      </h1>
      {lesson.body.map((text) => (
        <p key={text}>
          <CppText text={text} />
        </p>
      ))}
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
