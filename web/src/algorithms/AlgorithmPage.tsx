import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { Breadcrumbs, MissingPage, PageHeading } from '../components/Ui';
import { Workbench } from '../workbench/Workbench';
import { useLearning } from '../learning/react';
import { createSourceIndex } from '../player/source-location';
import {
  parseSortInput,
  prepareSort,
  sortCase,
  sortCatalogFor,
  allSortCases,
  isRecursiveSort,
  type SortCase,
} from './content';
import { SortController } from './controller';
import { sortExplanation } from './presentation';
import { SortState } from './SortState';
import '../components/array-trace.css';
import './algorithms.css';

function SortWorkspace({ spec }: { spec: SortCase }) {
  const { service } = useLearning();
  const [controller] = useState(() => new SortController());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot),
    { view, result, request, status } = snapshot;
  const [draft, setDraft] = useState(spec.defaultInput.join(' '));
  const parsed = useMemo(() => parseSortInput(spec, draft), [spec, draft]);
  const prepared = useMemo(
    () => prepareSort(spec, parsed.valid ? parsed.values : spec.defaultInput),
    [spec, parsed],
  );
  const source = request?.source ?? (parsed.valid ? prepared.source : '');
  const completeOutput = useMemo(
    () =>
      result?.trace?.steps
        .flatMap((step) =>
          step.changes.flatMap((change) => (change.op === 'output' ? [change.append] : [])),
        )
        .join('') ?? '',
    [result],
  );
  const explanation = result ? sortExplanation(result, view.cursor, prepared) : null;
  const terminal = result && view.cursor === view.length ? result.terminal : null;
  const highlight = terminal?.code && terminal.byteRange ? terminal.byteRange : view.byteRange;
  const range = useMemo(
    () => (highlight ? createSourceIndex(source).range(highlight) : null),
    [source, highlight],
  );
  const stop = useCallback(
    (visible: boolean) => {
      if (!visible) controller.pause();
    },
    [controller],
  );
  useEffect(() => {
    const unsubscribe = service.subscribeSessionInvalidation(() => controller.invalidate());
    const hidden = () => {
      if (document.visibilityState !== 'visible') controller.pause();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', hidden);
      controller.invalidate();
    };
  }, [controller, service]);
  const change = (text: string) => {
    controller.invalidate();
    setDraft(text);
  };
  const state = view.state;
  const active = Boolean(state);
  const sortCatalog = sortCatalogFor(spec);
  return (
    <div
      className="sort-workspace"
      data-testid="sort-workspace"
      data-state={status}
      data-run-id={view.identity?.runId ?? ''}
      data-cursor={view.cursor}
      data-length={view.length}
      data-source-revision={view.identity?.sourceRevision ?? ''}
    >
      <Breadcrumbs
        items={[
          { label: '学习首页', to: '/' },
          { label: '算法与演示', to: '/cases' },
          { label: spec.title },
        ]}
      />
      <PageHeading
        kicker="C++ · 真实执行与回放"
        title={spec.title}
        description={spec.description}
      />
      <section className="sort-input" aria-label="排序案例输入">
        <label htmlFor="sort-values">整数序列</label>
        <input
          id="sort-values"
          data-testid="sort-input"
          value={draft}
          maxLength={1024}
          onChange={(event) => change(event.target.value)}
          aria-invalid={!parsed.valid}
          aria-describedby="sort-input-help"
        />
        <p id="sort-input-help">
          0～30项，范围{spec.min}～{spec.max}
          。空格或逗号分隔，空数组写[]。观察不计积分或课程进度；修改输入撤销旧运行。
        </p>
        {!parsed.valid && <p role="alert">{parsed.issue}</p>}
        <div className="inline-actions">
          <button
            className="button button-primary"
            disabled={!parsed.valid || status === 'running'}
            onClick={() => void controller.execute(spec, parsed.values)}
          >
            运行C++案例
          </button>
          <button className="button" onClick={() => change(spec.defaultInput.join(' '))}>
            恢复示例输入
          </button>
          <button className="button" onClick={() => change('[]')}>
            使用空数组
          </button>
          {status === 'running' && (
            <button className="button" onClick={() => controller.cancel()}>
              取消运行
            </button>
          )}
        </div>
        {status === 'running' && <p role="status">正在执行并检查真实C++轨迹……</p>}
        {snapshot.error && (
          <p role="alert" data-testid="sort-error">
            本次未接收轨迹：{snapshot.error}。可重新运行。
          </p>
        )}
        {result && !result.trace && (
          <p role="alert" data-testid="sort-rejected">
            本次未生成执行轨迹：{result.terminal.code}。当前没有可播放的旧结果。
          </p>
        )}
        {result?.trace?.completeness === 'prefix' && (
          <p role="status">
            本次执行保留停止前缀：{result.terminal.code}。下方从初态回放，停止位置的诊断在末步显示。
          </p>
        )}
      </section>
      <Workbench
        kind="visualize"
        firstLabel="实际C++源码"
        secondLabel="排序观察"
        onSecondVisibility={stop}
        first={
          <section className="sort-source">
            <h2>{request ? '本次实际C++源码' : '待运行源码预览'}</h2>
            <p>
              只替换输入长度n，原序列经cin读入。输入无效时不生成源码。高亮
              {range ? `第${range.start.line}行，第${range.start.column}列` : '尚无对应步骤'}。
            </p>
            <pre tabIndex={0} aria-label="本次实际执行的C++源码" data-testid="sort-source">
              {range ? (
                <>
                  {source.slice(0, range.utf16Range.start)}
                  <mark
                    data-testid="sort-source-highlight"
                    data-byte-start={range.byteRange.start}
                    data-byte-end={range.byteRange.end}
                  >
                    {source.slice(range.utf16Range.start, range.utf16Range.end)}
                  </mark>
                  {source.slice(range.utf16Range.end)}
                </>
              ) : (
                source
              )}
            </pre>
            <details>
              <summary>复制完整源码</summary>
              <textarea
                aria-label="可复制的完整C++源码"
                readOnly
                value={source}
                rows={8}
                spellCheck={false}
              />
            </details>
          </section>
        }
        second={
          <section
            className="sort-stage basic-trace-view"
            tabIndex={0}
            aria-label="排序执行观察"
            onKeyDown={(event) => {
              if (
                event.target !== event.currentTarget ||
                event.repeat ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey
              )
                return;
              if (event.key === ' ') {
                event.preventDefault();
                controller.toggle();
              }
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                controller.step(event.key === 'ArrowRight' ? 1 : -1);
              }
            }}
          >
            <h2>排序观察</h2>
            <div className="player-controls" aria-label="C++排序播放控制">
              <div className="control-group">
                <button
                  className="button button-small"
                  disabled={!active || view.cursor === 0}
                  onClick={() => controller.step(-1)}
                >
                  后退
                </button>
                <button
                  className="button button-small"
                  disabled={!active || view.cursor === view.length}
                  onClick={() => controller.toggle()}
                >
                  {view.playing ? '暂停' : '播放'}
                </button>
                <button
                  className="button button-small"
                  disabled={!active || view.cursor === view.length}
                  onClick={() => controller.step(1)}
                >
                  前进
                </button>
                <button
                  className="button button-small"
                  disabled={!active}
                  onClick={() => controller.replay()}
                >
                  回到初态
                </button>
                <button
                  className="button button-small"
                  disabled={!active}
                  onClick={() => controller.seek(view.length)}
                >
                  查看末步
                </button>
              </div>
              <label>
                速度{' '}
                <select
                  aria-label="C++排序播放速度"
                  value={snapshot.rate}
                  disabled={!active}
                  onChange={(event) => controller.setRate(Number(event.target.value))}
                >
                  {[0.25, 0.5, 1, 1.5, 2, 4].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}×
                    </option>
                  ))}
                </select>
              </label>
              <label className="sort-seek">
                步骤 {view.cursor} / {view.length}
                <input
                  type="range"
                  aria-label="C++排序执行步骤"
                  min={0}
                  max={view.length || 1}
                  value={view.cursor}
                  disabled={!active}
                  onChange={(event) => controller.seek(Number(event.target.value))}
                />
              </label>
              <span role="status">
                {view.playing ? '正在播放' : active ? '已暂停' : '等待运行'}
              </span>
            </div>
            {state ? (
              <>
                <section className="sort-explanation" data-testid="sort-explanation">
                  <h3>{explanation?.title}</h3>
                  <p>{explanation?.explanation}</p>
                  <p className="muted">
                    真实步骤：{view.stepKind ?? '初态'}。聚焦本观察区后，空格播放/暂停，左右键单步。
                  </p>
                </section>
                <SortState
                  view={view}
                  result={result!}
                  inputLength={request?.input.length ?? 0}
                  recursive={isRecursiveSort(spec)}
                  bucketLayout={spec.bucketLayout}
                />
                {terminal && (
                  <p
                    data-testid="sort-terminal"
                    role={terminal.status === 'completed' ? 'status' : 'alert'}
                  >
                    {terminal.status === 'completed'
                      ? '程序正常结束，当前对象已按实际作用域离开。'
                      : `程序在此停止：${terminal.code}；保留真实前缀，可后退。`}
                  </p>
                )}
              </>
            ) : (
              <p>选择合法输入并运行，再查看真实数组和步骤。</p>
            )}
            {result && (
              <details className="sort-complete-output">
                <summary>完整执行结果（与当前步骤分开）</summary>
                <p>
                  本次终态：{result.terminal.status}
                  {result.terminal.code ? ` · ${result.terminal.code}` : ''}
                </p>
                <pre data-testid="sort-full-output">{completeOutput || '（无输出）'}</pre>
              </details>
            )}
          </section>
        }
      />
      <details className="sort-method">
        <summary>算法、限制与观察目标</summary>
        <p>
          案例{spec.id}@{spec.version}；程序{spec.programId}@{spec.programVersion}；内容包
          {sortCatalog.id}@{sortCatalog.version}。
        </p>
        <p>{spec.variant}</p>
        <p>{spec.complexity}</p>
        <p>{spec.extraSpace}</p>
        <ul>
          {spec.objectives.map((goal) => (
            <li key={goal}>{goal}</li>
          ))}
        </ul>
        <p>
          使用受支持C++子集的真实Rust解释执行，不是完整标准语言工作台。
          {spec.bucketLayout
            ? '桶案例不提供挑战、双算法对比或快照导出。'
            : '当前案例不提供挑战或快照导出；归并与快速可进入同数据对比。'}
        </p>
      </details>
      {isRecursiveSort(spec) && (
        <p>
          <Link className="text-link" to="/compare?pair=cpp-recursive">
            归并与快速 · 同数据对比 →
          </Link>
        </p>
      )}
      <nav className="inline-actions" aria-label="切换C++排序案例">
        {allSortCases.map((item) => (
          <Link
            className="text-link"
            key={item.id}
            aria-current={item.id === spec.id ? 'page' : undefined}
            to={`/algorithms/${item.id}`}
          >
            {item.title}
          </Link>
        ))}
        <Link className="text-link" to="/cases">
          返回算法与演示 →
        </Link>
      </nav>
    </div>
  );
}
export default function AlgorithmPage() {
  const { algorithmId = '' } = useParams(),
    spec = sortCase(algorithmId);
  return spec ? (
    <SortWorkspace key={spec.id} spec={spec} />
  ) : (
    <MissingPage title="找不到这个C++案例" backTo="/cases" backLabel="返回算法与演示" />
  );
}
