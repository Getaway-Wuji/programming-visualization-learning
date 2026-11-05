import { useEffect, useState, type ReactNode } from 'react';
import {
  ContentError,
  createContentRepository,
  type ContentPackage,
  type ProgramEntity,
  type Teaching,
} from '../content';
import { caseExecutionCatalog } from '../content/case-learning';

const repository = createContentRepository();
type SampleState = {
  state: 'loading' | 'ready' | 'failed';
  content: ContentPackage | null;
  code?: string;
};

function failureMessage(code?: string) {
  if (code === 'CONTENT_LOAD_FAILED') return '内容样例未能加载，请检查网络后重试。';
  if (code === 'CONTENT_LOAD_TIMEOUT') return '内容样例加载超时，请重试。';
  if (code === 'CONTENT_PUBLICATION_UNVERIFIED')
    return '内容缺少正式发布所需的审核记录，暂时无法展示。';
  return '内容样例未通过版本、结构或关联检查，暂时无法展示。请重试。';
}

export function ContentSample({ children }: { children: (content: ContentPackage) => ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [sample, setSample] = useState<SampleState>({ state: 'loading', content: null });
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void repository.load(controller.signal).then(
      (content) => {
        if (current) setSample({ state: 'ready', content });
      },
      (error: unknown) => {
        if (current)
          setSample({
            state: 'failed',
            content: null,
            code: error instanceof ContentError ? error.code : 'CONTENT_LOAD_FAILED',
          });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [attempt]);
  return (
    <section
      className="card section-card content-sample"
      data-testid="content-sample"
      data-state={sample.state}
    >
      {sample.state === 'loading' && <p role="status">正在读取并检查内容样例……</p>}
      {sample.state === 'failed' && (
        <>
          <p role="alert">{failureMessage(sample.code)}</p>
          <button
            className="button button-secondary"
            onClick={() => {
              setSample({ state: 'loading', content: null });
              setAttempt((value) => value + 1);
            }}
          >
            重新加载内容
          </button>
        </>
      )}
      {sample.state === 'ready' && sample.content && (
        <>
          <p className="notice sample-label">标准内容样例 · 尚未正式发布</p>
          <p className="muted">
            内容版本 {sample.content.packageVersion} · 只读预览，浏览不会产生学习记录或奖励。
          </p>
          {children(sample.content)}
        </>
      )}
    </section>
  );
}

function TeachingText({
  teaching,
  programs,
}: {
  teaching: Teaching;
  programs: readonly ProgramEntity[];
}) {
  return (
    <div className="sample-teaching">
      <h3>学习目标</h3>
      <ul>
        {teaching.objectives.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
      <h3>讲解与示例</h3>
      <p className="preserve-lines">{teaching.explanation}</p>
      {teaching.exampleProgramRefs.map((ref) => {
        const program = programs.find(
          (item) => item.id === ref.id && item.version === ref.version,
        )!;
        return (
          <div key={ref.id}>
            <h4>{program.title} · 参考源码</h4>
            <p className="muted">
              这里是讲解用的参考源码；本次是否运行及实际代码，以执行区域为准。
            </p>
            <pre className="sample-source" tabIndex={0} aria-label={`${program.title}参考源码`}>
              {program.sourceExample}
            </pre>
          </div>
        );
      })}
      <h3>常见错误</h3>
      <ul>
        {teaching.commonMistakes.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
      <h3>范围与边界</h3>
      <ul>
        {teaching.boundaryNotes.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  );
}

export function LessonSample({ id }: { id: string }) {
  return (
    <>
      <ContentSample>
        {(content) => {
          const lesson = content.lessons.find((item) => item.id === id);
          return lesson ? (
            <>
              <h2>本节学习内容样例</h2>
              <TeachingText teaching={lesson.teaching} programs={content.programs} />
            </>
          ) : (
            <p role="alert">内容样例中没有这个小节。</p>
          );
        }}
      </ContentSample>
      <button className="button button-secondary" disabled>
        确认已学习
      </button>
    </>
  );
}

export function CaseSample({ id }: { id: string }) {
  const catalog = caseExecutionCatalog(id);
  return (
    <section
      className="card section-card content-sample"
      data-testid="content-sample"
      data-content-scope="case-view"
      data-state={catalog ? 'ready' : 'failed'}
    >
      {catalog ? (
        <>
          <h2>案例讲解</h2>
          <TeachingText teaching={catalog.subject.teaching} programs={[catalog.program]} />
        </>
      ) : (
        <p role="alert">已审核案例中没有这个内容。</p>
      )}
    </section>
  );
}

export function ExerciseSample({ id }: { id: string }) {
  return (
    <ContentSample>
      {(content) => {
        const exercise = content.exercises.find((item) => item.id === id);
        if (!exercise) return <p role="alert">内容样例中没有这个练习。</p>;
        const program = content.programs.find((item) => item.id === exercise.programRef.id)!;
        const input = content.inputSpecs.find((item) => item.id === program.inputRef.id)!;
        return (
          <>
            <h2>练习题目样例</h2>
            <p className="preserve-lines">{exercise.prompt}</p>
            <h3>输入范围</h3>
            <ul>
              {input.fields.map((field) => (
                <li key={field.key}>
                  {field.key}：
                  {field.kind === 'sequence'
                    ? `整数数组，长度 ${field.minItems}～${field.maxItems}，元素`
                    : '整数'}
                  范围 {field.min}～{field.max}
                </li>
              ))}
            </ul>
            <p className="muted">编辑器与真实判定尚未接入，当前不能提交。</p>
          </>
        );
      }}
    </ContentSample>
  );
}

export function CatalogSample({ kind }: { kind: 'course' | 'case' }) {
  return (
    <ContentSample>
      {(content) => (
        <p>
          {kind === 'course'
            ? `已读取 ${content.chapters.length} 章、${content.lessons.length} 小节和 ${content.exercises.length} 个必修练习样例。`
            : `已读取 ${content.cases.filter((item) => item.kind === 'demo').length} 个语法演示和 ${content.cases.filter((item) => item.kind === 'algorithm').length} 个算法案例样例。`}
          {kind === 'course'
            ? '选择下方目录可查看只读讲解。'
            : '下方 7 个已审核案例独立开放观看确认；本样例目录的读取与检查不触发奖励。选择案例后可查看讲解、设置输入并运行，支持单步、回退与重播。'}
        </p>
      )}
    </ContentSample>
  );
}
