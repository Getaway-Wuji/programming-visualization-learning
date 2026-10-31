import { useId, useLayoutEffect, useRef } from 'react';
import type { MemoryResult, MemoryState, MemoryStep } from '../engine/memory-protocol';
import { memorySlots, memoryValueText, virtualAddress } from '../memory/presentation';
import type { NodeCase } from './content';
import { nodesView, nodeOutcomeText } from './presentation';
export function NodeGraph({
  state,
  result,
  spec,
  step,
}: {
  state: MemoryState;
  result: MemoryResult;
  spec: NodeCase;
  step: MemoryStep | null;
}) {
  const diagram = nodesView(state, result.types, spec, step),
    marker = useId().replaceAll(':', ''),
    scroller = useRef<HTMLDivElement>(null),
    hasNodes = diagram.nodes.length > 0;
  useLayoutEffect(() => {
    const center = () => {
      const element = scroller.current;
      if (element && hasNodes)
        element.scrollLeft = Math.max(0, (element.scrollWidth - element.clientWidth) / 2);
    };
    center();
    window.addEventListener('resize', center);
    return () => window.removeEventListener('resize', center);
  }, [hasNodes, diagram.width]);
  return (
    <section
      className="node-graph"
      aria-label="当前真实节点图"
      data-testid="node-graph"
      data-size={diagram.size ?? ''}
      data-processed={diagram.processed ?? ''}
      data-outcome={diagram.outcome ?? ''}
    >
      <h3>当前真实连接</h3>
      <dl className="node-summary">
        <div>
          <dt>源码size / 上限</dt>
          <dd>{diagram.size ?? '待初始化'} / 7</dd>
        </div>
        <div>
          <dt>完整处理命令</dt>
          <dd>{diagram.processed ?? '待初始化'}</dd>
        </div>
        <div>
          <dt>最近源码结果</dt>
          <dd data-testid="node-outcome">
            {diagram.outcome === null
              ? '待初始化'
              : (nodeOutcomeText[diagram.outcome] ?? `未知码${diagram.outcome}`)}
          </dd>
        </div>
      </dl>
      <p
        data-testid="node-anchor"
        data-name={diagram.anchorName}
        data-kind={diagram.anchorObject ? diagram.anchor.kind : 'absent'}
        data-target={diagram.anchor.value?.objectId ?? ''}
      >
        main.{diagram.anchorName}：
        {diagram.anchorObject ? diagram.anchor.label : '当前无存活入口对象'}；存活Node{' '}
        {diagram.nodes.length}，从此入口连通{diagram.reachableCount}。
      </p>
      <p className="muted">
        连接与size各自按真实步骤更新，暂时不等不补齐。图形可在本区横向滚动；下方逐对象给出全部字段。教学虚拟地址不是宿主地址。
      </p>
      <div
        ref={scroller}
        className="node-diagram-scroll"
        tabIndex={0}
        aria-label="节点连接图，可横向滚动"
      >
        {diagram.nodes.length ? (
          <svg
            role="img"
            aria-label={`${spec.title}当前存活节点及有效指针连接`}
            viewBox={`0 0 ${diagram.width} ${diagram.height}`}
            style={{ minWidth: diagram.width }}
          >
            <defs>
              <marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 0 L8 4 L0 8 Z" fill="currentColor" />
              </marker>
            </defs>
            {diagram.edges.map((e) => (
              <g
                key={`${e.from}-${e.field}`}
                data-testid="node-edge"
                data-from={e.from}
                data-to={e.to}
                data-field={e.field}
              >
                <path
                  d={`M${e.start.x} ${e.start.y} L${e.end.x} ${e.end.y}`}
                  fill="none"
                  markerEnd={`url(#${marker})`}
                />
                <text x={(e.start.x + e.end.x) / 2 + 6} y={(e.start.y + e.end.y) / 2}>
                  {e.field}
                </text>
              </g>
            ))}
            {diagram.nodes.map((n) => (
              <g
                key={n.object.id}
                transform={`translate(${n.x},${n.y})`}
                data-testid="node-figure"
                data-object-id={n.object.id}
                data-value={typeof n.value === 'number' ? n.value : 'uninitialized'}
                data-reachable={n.reachable}
                data-write={n.changed}
              >
                <rect x="-63" y="-30" width="126" height="60" rx="5" />
                <text y="-8" textAnchor="middle">
                  {n.object.id} · {typeof n.value === 'number' ? n.value : '未初始化'}
                </text>
                <text y="14" textAnchor="middle">
                  {n.reachable ? '入口连通' : '当前未连通'}
                </text>
              </g>
            ))}
          </svg>
        ) : (
          <p data-testid="node-empty">
            当前没有存活Node。分配前为空，释放后只保留墓碑；后退可恢复。
          </p>
        )}
      </div>
      <ul className="node-records">
        {diagram.nodes.map((n) => (
          <li
            key={n.object.id}
            data-testid="node-record"
            data-object-id={n.object.id}
            data-value={typeof n.value === 'number' ? n.value : 'uninitialized'}
            data-reachable={n.reachable}
          >
            <h4>
              {n.object.id} · value={memoryValueText(n.value, state)} · 存活
            </h4>
            <p>
              {virtualAddress(n.object.baseAddress)}，{n.object.byteLength}教学字节；
              {n.reachable ? '从主入口连通' : '当前未从主入口连通（可能待链接或已断开）'}
            </p>
            <ul>
              {n.fields.map((f) => (
                <li
                  key={f.name}
                  data-testid="node-field"
                  data-name={f.name}
                  data-kind={f.kind}
                  data-target={f.value?.objectId ?? ''}
                  data-offset={f.value?.byteOffset ?? ''}
                  data-lower={f.value?.lowerBound ?? ''}
                  data-upper={f.value?.upperBound ?? ''}
                >
                  {f.name}：{f.label}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <details className="sort-method">
        <summary>当前真实指针与变量</summary>
        <p>主入口与递归同名形参按帧区分；原始未初始化值与typed-null指针不同。</p>
        <ul className="node-pointer-list">
          {diagram.pointers.map((p) => (
            <li
              key={p.object.id}
              data-testid="node-pointer"
              data-object-id={p.object.id}
              data-kind={p.kind}
              data-target={p.value?.objectId ?? ''}
            >
              <b>{p.object.name}</b> · {p.object.id}/{p.object.frameId}/{p.object.scopeId}：
              {p.label}
            </li>
          ))}
        </ul>
        <ul className="variable-grid">
          {state.objects
            .filter((o) => o.alive && o.typeName === 'int')
            .map((o) => (
              <li
                className="variable-value"
                key={o.id}
                data-testid="node-variable"
                data-object-id={o.id}
              >
                <span>
                  {o.name}
                  <small>
                    {' '}
                    {o.id} · {o.frameId} · {o.scopeId}
                  </small>
                </span>
                <b>{memoryValueText(memorySlots(o, result.types)[0].value, state)}</b>
              </li>
            ))}
        </ul>
      </details>
      <details className="sort-method">
        <summary>已释放Node墓碑（{diagram.ended.length}）</summary>
        <p>死亡对象没有当前值槽，不把上一时刻的数据冒充当前节点。</p>
        <ul>
          {diagram.ended.map((o) => (
            <li key={o.id} data-testid="node-tombstone" data-object-id={o.id}>
              {o.id} · {o.typeName} · {virtualAddress(o.baseAddress)} · 已释放，无当前值
            </li>
          ))}
        </ul>
      </details>
      <p className="muted">
        cin已读{state.control.inputCursor}整数槽；源码consumed={diagram.consumed ?? '待初始化'}
        。清理过程可能留下指向墓碑的局部/字段引用，以原内存面板状态为准。
      </p>
    </section>
  );
}
