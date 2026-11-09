import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  loadLanguageNavigation,
  type LanguageNavigation,
  type TextLanguage,
} from '../learning/languages';
import './course-ui.css';

/** Shared course controls keep language pages in the same place without changing learning facts. */
export function CourseNav({ language, path }: { language: string; path: string }) {
  const { pathname } = useLocation();
  const work = ['workbench', 'example', 'practice'].some((part) =>
    pathname.startsWith(`${path}/${part}`),
  );
  return (
    <nav className="course-nav" aria-label={`${language} 学习`}>
      <Link
        to={path}
        aria-current={!work && !pathname.startsWith(`${path}/review`) ? 'page' : undefined}
      >
        {language} 目录
      </Link>
      <Link to={`${path}/workbench`} aria-current={work ? 'page' : undefined}>
        {language === 'MySQL' ? 'SQL 工作台' : '工作台'}
      </Link>
      <Link
        to={`${path}/review`}
        aria-current={pathname.startsWith(`${path}/review`) ? 'page' : undefined}
      >
        判题复盘
      </Link>
    </nav>
  );
}

export function CourseLoadState({
  language,
  failed,
  retry,
}: {
  language: string;
  failed: boolean;
  retry: () => void;
}) {
  return (
    <div className="course-load-state" role={failed ? 'alert' : 'status'}>
      {failed ? (
        <>
          暂时无法读取 {language} 课程。 <button onClick={retry}>重试</button>
        </>
      ) : (
        <>正在读取 {language} 课程…</>
      )}
    </div>
  );
}

export function CourseSearch({
  query,
  change,
}: {
  query: string;
  change: (query: string) => void;
}) {
  return (
    <label className="course-search">
      搜索目录
      <input
        type="search"
        value={query}
        onChange={(event) => change(event.target.value)}
        placeholder="输入标题或章节关键词"
      />
    </label>
  );
}

export function CourseMode({
  runnable = false,
  practice = false,
  completed = false,
  contains = false,
}: {
  runnable?: boolean;
  practice?: boolean;
  completed?: boolean;
  contains?: boolean;
}) {
  return (
    <span className="course-mode" data-mode={runnable ? 'runnable' : 'reading'}>
      <span>{runnable ? (contains ? '含可运行示例' : '可运行') : '阅读'}</span>
      {practice && <span>{contains ? '含练习' : '有练习'}</span>}
      {completed && <span className="course-read">已读</span>}
    </span>
  );
}

export function CourseProgress({
  count,
  total,
  label,
}: {
  count: number | undefined;
  total: number;
  label: string;
}) {
  return (
    <div className="course-progress">
      <span>{count === undefined ? '正在读取阅读进度' : `已读 ${count} / ${total} 小节`}</span>
      <progress value={count} max={total} aria-label={label} />
      <span className="course-help">读到页末自动记录，练习独立判定。</span>
    </div>
  );
}

export function CourseNext({
  title,
  to,
  started = false,
  complete = false,
  description,
}: {
  title: string;
  to: string;
  started?: boolean;
  complete?: boolean;
  description?: string;
}) {
  return (
    <section className="course-next" aria-label="推荐下一步">
      <div>
        <p className="course-next-label">
          {complete ? '课程已读完，可继续复习' : started ? '接着学' : '从这里开始'}
        </p>
        <h2>
          <Link to={to}>{title}</Link>
        </h2>
        {description && <p className="course-help">{description}</p>}
      </div>
      <Link className="button button-secondary" to={to}>
        {complete ? '回顾课程' : started ? '继续阅读' : '开始阅读'}
      </Link>
    </section>
  );
}

export function useCourseNavigation(language: TextLanguage) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    language: TextLanguage;
    value: LanguageNavigation | null;
    failed: boolean;
  }>();
  useEffect(() => {
    let active = true;
    void loadLanguageNavigation(language).then(
      (value) => {
        if (active) setResult({ language, value, failed: false });
      },
      () => {
        if (active) setResult({ language, value: null, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [language, attempt]);
  return {
    value: result?.language === language ? result.value : null,
    failed: result?.language === language && result.failed,
    retry: () => {
      setResult(undefined);
      setAttempt((value) => value + 1);
    },
  };
}

export function CourseResume({
  language,
  completed,
}: {
  language: TextLanguage;
  completed: ReadonlySet<string>;
}) {
  const navigation = useCourseNavigation(language);
  if (!navigation.value)
    return navigation.failed ? (
      <p className="course-help" role="alert">
        暂时无法读取下一步。<button onClick={navigation.retry}>重试</button>
      </p>
    ) : (
      <p className="course-help" role="status">
        正在准备下一步…
      </p>
    );
  const next = navigation.value.lessons.find(([id]) => !completed.has(id));
  const target = next ?? navigation.value.lessons[0];
  if (!target) return null;
  return (
    <CourseNext
      title={target[1]}
      to={target[2]}
      started={completed.size > 0}
      complete={!next}
      description="按目录顺序继续未读小节，也可从目录打开可运行示例与练习。"
    />
  );
}
