import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useLearning } from './react';
import {
  completedLanguageLessons,
  languages,
  loadLanguageNavigation,
  type LanguageNavigation,
  type TextLanguage,
} from './languages';

export function LanguageStudyCard({ language }: { language: TextLanguage }) {
  const { state } = useLearning();
  const [resource, setResource] = useState<{
    language: TextLanguage;
    index?: LanguageNavigation;
    failed?: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadLanguageNavigation(language).then(
      (index) => {
        if (alive) setResource({ language, index });
      },
      () => {
        if (alive) setResource({ language, failed: true });
      },
    );
    return () => {
      alive = false;
    };
  }, [language, attempt]);
  const metadata = languages.find((item) => item.id === language)!;
  const index = resource?.language === language ? resource.index : undefined;
  const completed = completedLanguageLessons(state.snapshot, language);
  const next = index?.lessons.find(([id]) => !completed.has(id));
  return (
    <section className="card c6-next-section" aria-label={`${metadata.label} 继续学习`}>
      <p className="muted">
        {completed.size} / {index?.lessons.length ?? metadata.total} 个小节已阅读
      </p>
      <progress
        value={completed.size}
        max={index?.lessons.length ?? metadata.total}
        aria-label={`${metadata.label} 课程完成进度`}
      />
      {index ? (
        <>
          <h2>{next?.[1] ?? '本语言小节已全部阅读'}</h2>
          <Link className="button button-primary" to={next?.[2] ?? metadata.directory}>
            {next ? (completed.size ? '继续阅读' : '开始阅读') : '回顾课程'}
          </Link>
          {next && (
            <p className="muted">
              {next[3] === 'practice'
                ? '本节包含可运行示例与独立练习。'
                : next[3] === 'run'
                  ? '本节可以运行示例并观察执行过程。'
                  : '本节通过阅读与自检理解知识。'}
            </p>
          )}
        </>
      ) : resource?.language === language && resource.failed ? (
        <>
          <p role="alert">学习导航暂时无法读取，已有进度保留。</p>
          <button
            className="button button-secondary"
            onClick={() => {
              setResource(null);
              setAttempt((value) => value + 1);
            }}
          >
            重试导航
          </button>
        </>
      ) : (
        <p role="status">正在读取学习导航…</p>
      )}
      <div className="c6-home-practice-shortcuts inline-actions">
        <Link className="text-link" to={metadata.directory}>
          查看目录
        </Link>
        <Link className="text-link" to={metadata.workbench}>
          打开工作台
        </Link>
        <Link className="text-link" to={metadata.review}>
          查看判题复盘
        </Link>
      </div>
    </section>
  );
}
