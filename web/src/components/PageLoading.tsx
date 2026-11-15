import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import './page-loading.css';

type LoadingVariant = 'page' | 'course' | 'article' | 'workbench';

export function PageLoading({
  variant = 'page',
  label = '正在加载页面',
  onShown,
}: {
  variant?: LoadingVariant;
  label?: string;
  onShown?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const delay = window.setTimeout(() => {
      onShown?.();
      setVisible(true);
    }, 300);
    return () => window.clearTimeout(delay);
  }, [onShown]);

  return (
    <div
      className={`page-loading page-loading--${variant}`}
      data-testid="page-loading"
      data-visible={visible}
    >
      <span className="screen-reader-only" role="status">
        {visible ? label : ''}
      </span>
      <div className="page-loading-visual" aria-hidden="true">
        <div className="page-loading-meter">
          <span />
        </div>
        <div className="page-loading-heading">
          <span />
          <span />
          <span />
        </div>
        <div className="page-loading-layout">
          {(variant === 'course' || variant === 'workbench') && (
            <div className="page-loading-sheet page-loading-companion">
              <span />
              <span />
              <span />
            </div>
          )}
          <div className="page-loading-sheet">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}

function PageArrival({ waited, children }: { waited: RefObject<boolean>; children: ReactNode }) {
  const page = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (waited.current && page.current && !document.documentElement.dataset.themeReveal)
      page.current.dataset.pageArrival = 'true';
  }, [waited]);
  return (
    <div className="page-arrival" ref={page}>
      {children}
    </div>
  );
}

export function PageLoadingBoundary({
  variant,
  children,
}: {
  variant: LoadingVariant;
  children: ReactNode;
}) {
  const waited = useRef(false);
  const noteWait = useCallback(() => {
    waited.current = true;
  }, []);
  return (
    <Suspense fallback={<PageLoading variant={variant} onShown={noteWait} />}>
      <PageArrival waited={waited}>{children}</PageArrival>
    </Suspense>
  );
}
