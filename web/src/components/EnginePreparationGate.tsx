import {
  Fragment,
  startTransition,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useLocation } from 'react-router';
import { prepareEngine, type PreparationEngine } from '../engine/preparation';
import { PageLoading } from './PageLoading';
import { usePreparationAdmission, type PreparationTicket } from './engine-preparation-state';
import './engine-preparation.css';

const engineNames: Record<PreparationEngine, string> = {
  c: 'C 语言',
  c6: 'C 课程',
  practice: '题目生成与判题',
  memory: '内存观察',
  algorithm: 'C++ 算法',
  advanced: 'C / C++',
  python: 'Python',
  java: 'Java',
  cpp: 'C++',
  rust: 'Rust',
  mysql: 'MySQL',
};

function failureMessage(cause: unknown) {
  if (
    cause &&
    typeof cause === 'object' &&
    'code' in cause &&
    cause.code === 'E_PREPARATION_TIMEOUT'
  )
    return '下载时间较长，本次准备已停止。请检查网络连接后重试。';
  return '执行资源未能完整下载或校验。请检查网络连接后重试。';
}

function PreparationSession({
  engine,
  label,
  children,
}: {
  engine: PreparationEngine;
  label: string;
  children: ReactNode;
}) {
  const admission = usePreparationAdmission();
  const admissionScope = admission?.scope;
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<{
    scope: string | undefined;
    phase: 'loading' | 'ready' | 'failed';
  }>({ scope: admissionScope, phase: 'loading' });
  const phase = loadState.scope === admissionScope ? loadState.phase : 'loading';
  const [failure, setFailure] = useState('');
  const panel = useRef<HTMLElement>(null);
  const readyContent = useRef<HTMLDivElement>(null);
  const loadingWasShown = useRef(false);
  const focusWhenReady = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const beginAdmission = admission?.begin;
  const readyAdmission = admission?.ready;
  const endAdmission = admission?.end;
  const noteVisibleLoading = useCallback(() => {
    loadingWasShown.current = true;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const ticket: PreparationTicket | null =
      admissionScope === undefined
        ? null
        : { scope: admissionScope, engine, token: Symbol('engine-preparation') };
    if (ticket) beginAdmission?.(ticket);
    void prepareEngine(engine, controller.signal).then(
      () => {
        if (!current || controller.signal.aborted) return;
        focusWhenReady.current ||= panel.current?.contains(document.activeElement) ?? false;
        // Keep the same placeholder if the workspace module still needs to load.
        startTransition(() => {
          if (ticket) readyAdmission?.(ticket);
          setLoadState({ scope: admissionScope, phase: 'ready' });
        });
      },
      (cause: unknown) => {
        if (!current || controller.signal.aborted) return;
        loadingWasShown.current = false;
        setFailure(failureMessage(cause));
        setLoadState({ scope: admissionScope, phase: 'failed' });
      },
    );
    return () => {
      current = false;
      controller.abort();
      if (ticket) endAdmission?.(ticket);
    };
  }, [engine, attempt, admissionScope, beginAdmission, readyAdmission, endAdmission]);

  useLayoutEffect(() => {
    if (phase !== 'ready' || !readyContent.current) return;
    const content = readyContent.current;
    if (loadingWasShown.current && !document.documentElement.dataset.themeReveal)
      content.dataset.pageArrival = 'true';
    loadingWasShown.current = false;
    if (!focusWhenReady.current) return;
    focusWhenReady.current = false;
    const focusTitle = () => {
      const active = document.activeElement;
      // Navigation stays usable during loading. Never take focus back from it
      // (or from a control the user already reached in the finished workspace).
      if (active && active !== document.body && active.id !== 'main-content') return true;
      const title = content.querySelector<HTMLElement>('h1');
      if (!title) return false;
      if (!title.hasAttribute('tabindex')) title.tabIndex = -1;
      title.focus({ preventScroll: true });
      return document.activeElement === title;
    };
    if (focusTitle()) return;
    const observer = new MutationObserver(() => {
      if (focusTitle()) observer.disconnect();
    });
    observer.observe(content, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [phase]);

  if (phase === 'ready')
    return (
      <div
        ref={readyContent}
        className="page-arrival"
        data-testid="engine-preparation"
        data-engine={engine}
        data-state="ready"
      >
        {children}
      </div>
    );

  const failed = phase === 'failed';
  return (
    <section
      ref={panel}
      className={failed ? 'engine-preparation-panel' : undefined}
      data-testid="engine-preparation"
      data-engine={engine}
      data-state={phase}
      tabIndex={-1}
      aria-label={failed ? undefined : `${label} 执行引擎`}
      aria-labelledby={failed ? titleId : undefined}
      aria-describedby={failed ? descriptionId : undefined}
    >
      {failed ? (
        <>
          <h1 id={titleId}>{label} 执行引擎暂时无法加载</h1>
          <p id={descriptionId} role="alert">
            {failure}
          </p>
          <div className="engine-preparation-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                panel.current?.focus({ preventScroll: true });
                setFailure('');
                setLoadState({ scope: admissionScope, phase: 'loading' });
                setAttempt((value) => value + 1);
              }}
            >
              重试加载
            </button>
            <Link className="button button-secondary" to="/">
              返回学习首页
            </Link>
          </div>
        </>
      ) : (
        <PageLoading
          variant="workbench"
          label={`正在准备 ${label} 工作区，当前尚未开始运行程序。`}
          onShown={noteVisibleLoading}
        />
      )}
    </section>
  );
}

/** Execution routes mount their workspace only after their own engine is ready. */
export function EnginePreparationGate({
  engine,
  label = engineNames[engine],
  children,
}: {
  engine: PreparationEngine;
  label?: string;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  return (
    <PreparationSession key={engine} engine={engine} label={label}>
      <Fragment key={pathname}>{children}</Fragment>
    </PreparationSession>
  );
}
