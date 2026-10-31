import { useState } from 'react';
import type { AlgorithmPlayer } from '../engine/algorithm-player';
import type { AlgorithmFrame, AlgorithmResult } from '../engine/algorithm-protocol';
import { changedValues, slotValue } from './presentation';
import { SortArray, valueText } from './SortArray';
import type { BucketLayout } from './content';
import { BucketState } from './BucketState';

export function SortState({
  view,
  result,
  inputLength,
  recursive = false,
  bucketLayout,
  compact = false,
}: {
  view: ReturnType<AlgorithmPlayer['snapshot']>;
  result: AlgorithmResult;
  inputLength: number;
  recursive?: boolean;
  bucketLayout?: BucketLayout;
  compact?: boolean;
}) {
  const [selected, setSelected] = useState('');
  const state = view.state;
  if (!state) return <p>当前没有可回放状态。</p>;
  const step = view.cursor ? (result.trace?.steps[view.cursor - 1] ?? null) : null;
  const active = state.control.activeFrameId;
  const observed = state.frames.some((f) => f.id === selected) ? selected : active;
  const array = state.objects.find((o) => o.name === 'values'),
    counts = state.objects.find((o) => o.name === 'counts'),
    scratch = state.objects.find((o) => o.name === 'scratch');
  const changes = changedValues(step, state);
  const returned =
    step?.changes.flatMap((c) =>
      c.op === 'record' && c.table === 'frames' && c.before && !c.after
        ? [c.before as AlgorithmFrame]
        : [],
    ) ?? [];
  return (
    <>
      <div className="step-counters" data-testid="sort-counters">
        {Object.entries(state.counters).map(([key, value]) => (
          <span key={key}>
            {
              {
                comparisons: '比较',
                scalarWrites: '变量写入',
                arrayWrites: '数组写入',
                swaps: '交换',
              }[key]
            }{' '}
            <strong data-testid={`sort-counter-${key}`}>{value}</strong>
          </span>
        ))}
      </div>
      <p className="muted">
        计数含输入、初始化、循环条件与同值写。当前引擎未标注交换，不能用它推测交换次数。
      </p>
      {recursive && (
        <details open={!compact}>
          <summary>查看调用栈与内存</summary>
          <section
            className="sort-stack"
            data-testid="sort-stack"
            data-active-frame={active ?? ''}
            data-observed-frame={observed ?? ''}
          >
            <h3>同一步的调用栈</h3>
            <p>
              执行帧：{state.frames.find((f) => f.id === active)?.functionName ?? '无'}
              。选择调用者只切换观察，不移动执行步骤。
            </p>
            <div className="inline-actions">
              {state.frames.map((frame, index) => (
                <button
                  className="button button-small"
                  key={frame.id}
                  data-testid="sort-frame"
                  data-frame-id={frame.id}
                  aria-pressed={frame.id === observed}
                  onClick={() => setSelected(frame.id)}
                >
                  {index + 1} · {frame.functionName}
                  {frame.id === active ? ' · 正在执行' : ' · 调用者'}
                </button>
              ))}
            </div>
            {returned.map((frame) => (
              <p key={frame.id} data-testid="sort-returned">
                {frame.functionName}（{frame.id}）已返回，局部对象已离开当前状态；后退可恢复。
              </p>
            ))}
            <p className="muted">
              当前存活分配：{state.allocator.liveBytes}
              教学字节。下列地址是虚拟地址，非宿主真实地址；数组形参别名共享原对象。
            </p>
            <ul className="sort-bindings">
              {state.scopes
                .filter((scope) => scope.frameId === observed)
                .flatMap((scope) =>
                  scope.aliases.map((alias) => (
                    <li
                      key={`${scope.id}/${alias.name}`}
                      data-testid="sort-alias"
                      data-object-id={alias.objectId}
                    >
                      {alias.name} → {alias.objectId}（共享数组，未复制）
                    </li>
                  )),
                )}
            </ul>
            <div className="sort-memory" tabIndex={0} aria-label="当前观察帧的真实对象">
              <table>
                <caption>当前观察帧的参数与局部对象</caption>
                <thead>
                  <tr>
                    <th>名称 / 对象</th>
                    <th>种类</th>
                    <th>虚拟地址</th>
                    <th>容量 / 当前值</th>
                  </tr>
                </thead>
                <tbody>
                  {state.objects
                    .filter((o) => o.frameId === observed)
                    .map((o) => (
                      <tr key={o.id} data-testid="sort-object" data-object-id={o.id}>
                        <td>
                          {o.name}
                          <small> {o.id}</small>
                        </td>
                        <td>
                          {o.kind === 'int-array'
                            ? '数组'
                            : result.nodeMap.find((n) => n.nodeId === o.declarationNodeId)?.kind ===
                                'parameter'
                              ? '参数'
                              : '局部整数'}
                        </td>
                        <td>{o.baseAddress}</td>
                        <td>
                          {o.kind === 'int-array'
                            ? `${o.length}项 · ${o.length * 4}字节`
                            : valueText(slotValue(o, 0))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </details>
      )}
      {array ? (
        <SortArray object={array} length={inputLength} step={step} />
      ) : (
        <p data-testid="sort-array-absent">
          当前没有存活的原数组；前进到声明之后或从末步后退查看。
        </p>
      )}
      {bucketLayout && <BucketState state={state} step={step} layout={bucketLayout} />}
      {scratch && (
        <details className="sort-buckets" open>
          <summary>辅助数组 · 当前真实内容</summary>
          <SortArray object={scratch} length={inputLength} step={step} auxiliary />
        </details>
      )}
      {counts && (
        <details className="sort-buckets" open>
          <summary>查看41个真实计数桶</summary>
          <SortArray object={counts} length={41} step={step} buckets />
        </details>
      )}
      <details open={!compact}>
        <summary>查看当前变量与本步写入</summary>
        <section>
          <h3>当前变量{recursive ? ' · 观察帧' : ''}</h3>
          <ul className="variable-grid">
            {state.objects
              .filter((o) => o.kind === 'int' && (!recursive || o.frameId === observed))
              .map((o) => (
                <li
                  className="variable-value"
                  key={o.id}
                  data-testid="sort-variable"
                  data-name={o.name}
                >
                  <span>
                    {o.name}{' '}
                    <small>
                      {o.id} · {o.scopeId}
                    </small>
                  </span>
                  <b>{valueText(slotValue(o, 0))}</b>
                </li>
              ))}
          </ul>
        </section>
        <section>
          <h3>本步实际写入</h3>
          {changes.length ? (
            <ul>
              {changes.map((c, i) => (
                <li key={i}>
                  {c.name}[{c.index}]：{valueText(c.before)} → {valueText(c.after)}
                </li>
              ))}
            </ul>
          ) : (
            <p>本步没有单槽写入变化；声明、整体初始化和作用域变化以原步骤为准。</p>
          )}
        </section>
      </details>
      <section>
        <h3>当前输出</h3>
        <pre data-testid="sort-output">{state.output || '（无输出）'}</pre>
      </section>
    </>
  );
}
