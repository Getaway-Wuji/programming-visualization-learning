import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { Icon } from '../components/Icon';
import { useAppearance } from '../appearance/react';
import { useWorkbench, type WorkbenchKind, type LayoutGuard } from './react';

const defaults = { practice: 50, visualize: 35, review: 35 } as const;
type Pane = 'first' | 'second';

/** Pane children keep their positions and identities when resized or hidden. */
export function Workbench({
  kind,
  firstLabel,
  secondLabel,
  first,
  second,
  onSecondVisibility,
}: {
  kind: WorkbenchKind;
  firstLabel: string;
  secondLabel: string;
  first: ReactNode;
  second: ReactNode;
  onSecondVisibility?: (visible: boolean) => void;
}) {
  const { layout, change, capture, disabled } = useWorkbench();
  const configuration = useAppearance().loaded?.configuration?.layout;
  const firstMinimum = configuration?.codePaneMin ?? 340;
  const secondMinimum = configuration?.chartPaneMin ?? 420;
  const gutter = configuration?.gutter ?? 16;
  const minimumWidth = firstMinimum + secondMinimum + gutter;
  const savedRatio = layout.splitRatios[kind];
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [active, setActive] = useState<Pane>(kind === 'practice' ? 'first' : 'second');
  const [expanded, setExpanded] = useState<Pane | 'none'>('none');
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; ratio: number; guard: LayoutGuard } | null>(null);
  const id = useId();
  const ratio = dragRatio ?? savedRatio;
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setNarrow(entry.contentRect.width < minimumWidth),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [minimumWidth]);
  const firstHidden = narrow ? active !== 'first' : expanded === 'second';
  const secondHidden = narrow ? active !== 'second' : expanded === 'first';
  useEffect(() => onSecondVisibility?.(!secondHidden), [secondHidden, onSecondVisibility]);
  const clamp = (value: number) => Math.max(30, Math.min(70, Math.round(value)));
  const save = (value: number, guard?: LayoutGuard) => {
    if (clamp(value) !== savedRatio) void change({ splitRatios: { [kind]: clamp(value) } }, guard);
  };
  const fromPointer = (clientX: number) => {
    const box = grid.current!.getBoundingClientRect();
    return clamp(((clientX - box.left - gutter / 2) / (box.width - gutter)) * 100);
  };
  function stopDrag(cancelled = false) {
    const current = drag.current;
    drag.current = null;
    setDragRatio(null);
    if (current && !cancelled) save(current.ratio, current.guard);
  }
  function selectPane(pane: Pane) {
    setActive(pane);
    // Keep focus on the selected tab; no hidden descendant retains the keyboard focus.
    root.current?.querySelector<HTMLButtonElement>(`[data-pane-tab="${pane}"]`)?.focus();
  }
  function pane(name: Pane, label: string, children: ReactNode, hidden: boolean) {
    return (
      <div
        className="workbench-region"
        data-testid={`workbench-${name}`}
        id={`${id}-${name}`}
        role={narrow ? 'tabpanel' : 'region'}
        aria-label={label}
        hidden={hidden}
        aria-labelledby={narrow ? `${id}-${name}-tab` : undefined}
      >
        <div className="workbench-region-heading">
          <span>{label}</span>
          <button
            type="button"
            className="button button-small pane-expand"
            hidden={narrow}
            aria-label={expanded === name ? '还原分栏' : `展开${label}`}
            aria-expanded={expanded === name}
            onClick={() => setExpanded(expanded === name ? 'none' : name)}
          >
            <Icon name={expanded === name ? 'restore' : 'expand'} />
            <span>{expanded === name ? '还原分栏' : '展开'}</span>
          </button>
        </div>
        <div className="workbench-region-content">{children}</div>
      </div>
    );
  }
  return (
    <div
      ref={root}
      className="adaptive-workbench"
      data-testid="workbench"
      data-kind={kind}
      data-narrow={narrow}
      data-active-pane={active}
      data-expanded={expanded}
    >
      <div className="workbench-tools">
        <div className="workbench-tabs" role="tablist" aria-label="工作区域" hidden={!narrow}>
          {(['first', 'second'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`${id}-${name}-tab`}
              data-pane-tab={name}
              aria-controls={`${id}-${name}`}
              aria-selected={active === name}
              tabIndex={active === name ? 0 : -1}
              onClick={() => selectPane(name)}
              onKeyDown={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  event.stopPropagation();
                  selectPane(
                    event.key === 'Home'
                      ? 'first'
                      : event.key === 'End'
                        ? 'second'
                        : active === 'first'
                          ? 'second'
                          : 'first',
                  );
                }
              }}
            >
              {name === 'first' ? firstLabel : secondLabel}
            </button>
          ))}
        </div>
        <span className="workbench-resize-hint" hidden={narrow || expanded !== 'none'}>
          拖动中间分隔条调整宽度
        </span>
        <button
          type="button"
          className="text-link"
          hidden={narrow}
          disabled={disabled || savedRatio === defaults[kind]}
          onClick={() => save(defaults[kind])}
        >
          恢复默认比例
        </button>
      </div>
      <div
        ref={grid}
        className="workbench-split"
        style={
          {
            '--split-ratio': ratio,
            '--pane-first-min': `${firstMinimum}px`,
            '--pane-second-min': `${secondMinimum}px`,
            '--pane-gutter': `${gutter}px`,
          } as CSSProperties
        }
      >
        {pane('first', firstLabel, first, firstHidden)}
        <div
          role="separator"
          className="workbench-divider"
          tabIndex={0}
          hidden={narrow || expanded !== 'none'}
          aria-label="调整面板宽度"
          aria-orientation="vertical"
          aria-valuemin={30}
          aria-valuemax={70}
          aria-valuenow={ratio}
          aria-valuetext={`首选${firstLabel} ${ratio}%，${secondLabel} ${100 - ratio}%；保留面板最小宽度`}
          aria-controls={`${id}-first ${id}-second`}
          aria-disabled={disabled}
          title="拖动调宽；方向键微调，Home / End 到边界，双击恢复默认"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (!disabled)
              save(
                event.key === 'Home'
                  ? 30
                  : event.key === 'End'
                    ? 70
                    : ratio + (event.key === 'ArrowRight' ? 2 : -2),
              );
          }}
          onDoubleClick={() => {
            if (!disabled) save(defaults[kind]);
          }}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            const guard = capture();
            if (!guard) return;
            drag.current = { pointer: event.pointerId, ratio: savedRatio, guard };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointer !== event.pointerId) return;
            // A browser may report a captured move with no held button after
            // leaving its window. Cancel it instead of applying a synthetic x=0.
            if ((event.buttons & 1) === 0) {
              stopDrag(true);
              return;
            }
            const value = fromPointer(event.clientX);
            drag.current.ratio = value;
            setDragRatio(value);
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointer !== event.pointerId) return;
            stopDrag();
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => stopDrag(true)}
          onLostPointerCapture={() => stopDrag(true)}
        >
          <span />
        </div>
        {pane('second', secondLabel, second, secondHidden)}
      </div>
    </div>
  );
}

export function WorkspaceContext({
  children,
  label = '题目与学习信息',
}: {
  children: ReactNode;
  label?: string;
}) {
  const { layout } = useWorkbench();
  const [show, setShow] = useState(false);
  const focus = layout.workbenchMode === 'focus';
  return (
    <div className="workspace-context">
      {focus && (
        <button
          type="button"
          className="text-link workspace-context-toggle"
          aria-expanded={show}
          onClick={() => setShow(!show)}
        >
          {show ? '收起' : '查看'}
          {label}
        </button>
      )}
      <div hidden={focus && !show}>{children}</div>
    </div>
  );
}
