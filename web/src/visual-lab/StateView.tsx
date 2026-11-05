import type { AdvancedObject, AdvancedResult, AdvancedState } from '../engine/advanced-protocol';
import type { VisualDraft } from './input';
import type { VisualSpec } from './catalog';

function object(state: AdvancedState, name: string): AdvancedObject | undefined {
  const candidates = state.objects.filter((o) => o.name === name && o.typeName === 'int');
  return (
    candidates.findLast((o) => o.alive && o.frameId === state.control.activeFrameId) ??
    candidates.findLast((o) => o.alive) ??
    candidates[0]
  );
}
const mainScalar = (state: AdvancedState, name: string, fallback = 0) =>
  cell(
    state.objects.find((o) => o.name === name && o.typeName === 'int'),
    0,
  ) ?? fallback;
function cell(o: AdvancedObject | undefined, index: number): number | null {
  const value = o?.cells.find((c) => c.byteOffset === index * 4)?.value;
  return typeof value === 'number' ? value : o?.zeroInitialized ? 0 : null;
}
const scalar = (state: AdvancedState, name: string, fallback = 0) =>
  cell(object(state, name), 0) ?? fallback;
const array = (state: AdvancedState, name: string, count?: number) => {
  const o = object(state, name);
  return o
    ? Array.from({ length: Math.min(o.length, Math.max(0, count ?? o.length)) }, (_, i) =>
        cell(o, i),
      )
    : [];
};
const names: Record<string, string> = {
  a: '数据',
  b: '匹配串',
  dp: '状态表',
  count: '计数',
  buffer: '辅助数组',
  prefix: '前缀表',
  distance: '距离 / 最小边权',
  parent: '父节点',
  seen: '已访问',
  indegree: '入度',
  queue: '队列',
  rank: '秩',
  next: '后继',
  prev: '前驱',
  head: '桶首节点',
  left: '左孩子',
  right: '右孩子',
  red: '红色标记',
  weight: '重量 / 边权',
  value: '价值',
  from: '起点',
  to: '终点',
  chosen: '已选边',
  index: '块最大值',
  terminal: '单词结束',
  link: '字符连接',
  height: '盘数',
};
const shown = (value: number | null) => (value === null ? '—' : value === 10000 ? '∞' : value);

export function LabState({
  spec,
  state: nullableState,
  result,
  cursor,
  changeStart,
  draft,
}: {
  spec: VisualSpec;
  state: AdvancedState | null;
  result: AdvancedResult | null;
  cursor: number;
  changeStart?: number;
  draft: VisualDraft;
}) {
  if (!nullableState) return <div className="lab-empty">运行后，逐步观察数据变化。</div>;
  const state = nullableState;
  const changes =
    result?.trace?.steps.slice(changeStart ?? cursor - 1, cursor).flatMap((step) => step.changes) ??
    [];
  const changed = (name: string, i: number) =>
    changes.some(
      (c) =>
        c.op === 'cell' &&
        c.objectId === object(state, name)?.id &&
        c.byteOffset === i * 4 &&
        c.before !== c.after,
    );
  const n = scalar(state, 'n');
  const size = scalar(state, 'size', n);
  const current = scalar(state, 'current', -1);
  // A grouped swap highlights only the array locations written by that group.
  // Loop counters describe control flow, and may point at unrelated elements.
  const activeIndices =
    changeStart !== undefined
      ? changes.flatMap((change) =>
          change.op === 'cell' && change.objectId === object(state, 'a')?.id
            ? [change.byteOffset / 4]
            : [],
        )
      : ['i', 'j', 'mid', 'cut', 'at', 'current'].map((key) => scalar(state, key, -1));
  function row(name: string, count?: number, characters = false) {
    const cells = array(state, name, count);
    if (!cells.length) return null;
    return (
      <div className="lab-array-group" key={name}>
        <h3>{names[name] ?? name}</h3>
        <div className="lab-array-scroll">
          <div className="lab-array">
            {cells.map((value, i) => (
              <div
                className="lab-cell"
                data-write={changed(name, i)}
                data-active={name === 'a' && activeIndices.includes(i)}
                key={i}
              >
                <strong>
                  {characters && value !== null && value >= 97 && value <= 122
                    ? String.fromCharCode(value)
                    : shown(value)}
                </strong>
                <small>{i}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  function graph() {
    const count = Math.min(8, n || Number(draft.number) || 0);
    const points = Array.from({ length: count }, (_, i) => ({
      x: 210 + 145 * Math.cos((2 * Math.PI * i) / count - Math.PI / 2),
      y: 170 + 122 * Math.sin((2 * Math.PI * i) / count - Math.PI / 2),
    }));
    const edges: { from: number; to: number; weight: number | null; selected: boolean }[] = [];
    const matrix = array(state, 'graph');
    const parent = array(state, 'parent', n);
    const directed = ['topological', 'floyd'].includes(spec.slug);
    if (spec.slug === 'kruskal') {
      const from = array(state, 'from', scalar(state, 'edges'));
      const to = array(state, 'to', from.length),
        weights = array(state, 'weight', from.length),
        chosen = array(state, 'chosen', from.length);
      from.forEach((u, i) => {
        if (u !== null && to[i] !== null && points[u] && points[to[i]!])
          edges.push({ from: u, to: to[i]!, weight: weights[i], selected: chosen[i] === 1 });
      });
    } else if (spec.kind === 'parents') {
      array(state, 'parent', count).forEach((p, i) => {
        if (p !== null && p !== i && points[p])
          edges.push({ from: i, to: p, weight: null, selected: changed('parent', i) });
      });
    } else {
      for (let u = 0; u < count; u++)
        for (let v = 0; v < count; v++)
          if (matrix[u * count + v] && (directed || u < v))
            edges.push({
              from: u,
              to: v,
              weight: matrix[u * count + v],
              selected: parent[v] === u || (!directed && parent[u] === v),
            });
    }
    const seen = array(state, 'seen', count),
      distance = array(state, 'distance', count);
    return (
      <svg
        viewBox="0 0 420 350"
        className="lab-graph"
        role="img"
        aria-label={spec.kind === 'parents' ? '当前集合连接' : '当前图与访问状态'}
      >
        <defs>
          <marker
            id="lab-arrow"
            viewBox="0 0 10 10"
            refX="21"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {edges.map((edge, i) => {
          const p = points[edge.from],
            q = points[edge.to];
          return (
            <g key={i} className={edge.selected ? 'lab-edge selected' : 'lab-edge'}>
              <line
                x1={p.x}
                y1={p.y}
                x2={q.x}
                y2={q.y}
                markerEnd={directed || spec.kind === 'parents' ? 'url(#lab-arrow)' : undefined}
              />
              {edge.weight !== null && (
                <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 8}>
                  {edge.weight}
                </text>
              )}
            </g>
          );
        })}
        {points.map((p, i) => (
          <g
            key={i}
            transform={`translate(${p.x},${p.y})`}
            className={`lab-node${seen[i] === 1 ? ' visited' : ''}${current === i ? ' current' : ''}`}
          >
            <circle r="22" />
            <text y="5">{i}</text>
            {distance.length > 0 && (
              <text y="43" className="lab-node-note">
                {shown(distance[i])}
              </text>
            )}
          </g>
        ))}
      </svg>
    );
  }
  function tree() {
    const heap = spec.kind === 'heap';
    const count = Math.min(12, heap ? size : scalar(state, 'size'));
    const a = array(state, 'a', count),
      left = array(state, 'left', count),
      right = array(state, 'right', count),
      red = array(state, 'red', count);
    const points = new Map<number, { x: number; y: number }>();
    const edges: { from: number; to: number; label?: string }[] = [];
    const visited = new Set<number>();
    const walk = (node: number, x: number, y: number, spread: number) => {
      if (node < 0 || node >= count || visited.has(node)) return;
      visited.add(node);
      points.set(node, { x, y });
      const children = heap ? [node * 2 + 1, node * 2 + 2] : [left[node] ?? -1, right[node] ?? -1];
      children.forEach((child, i) => {
        if (child >= 0 && child < count) {
          edges.push({ from: node, to: child });
          walk(child, x + (i === 0 ? -spread : spread), y + 64, spread / 2);
        }
      });
    };
    walk(heap ? 0 : mainScalar(state, 'root', -1), 240, 35, 116);
    return (
      <svg
        viewBox={`0 0 480 ${Math.max(280, ...[...points.values()].map((p) => p.y + 40))}`}
        className="lab-tree"
        role="img"
        aria-label="当前树结构"
      >
        {!points.size && (
          <text x="240" y="130" textAnchor="middle" fill="currentColor">
            空树
          </text>
        )}
        {edges.map((e, i) => {
          const p = points.get(e.from),
            q = points.get(e.to);
          return p && q ? (
            <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="lab-tree-edge" />
          ) : null;
        })}
        {[...points].map(([i, p]) => (
          <g
            key={i}
            transform={`translate(${p.x},${p.y})`}
            className={`lab-node${i === current ? ' current' : ''}${red[i] === 1 ? ' red' : red.length ? ' black' : ''}`}
          >
            <circle r="21" />
            <text y="5">{shown(a[i])}</text>
          </g>
        ))}
      </svg>
    );
  }
  function links() {
    const count = Math.min(12, Math.max(n, size)),
      a = array(state, 'a', count),
      next = array(state, 'next', count),
      prev = array(state, 'prev', count);
    const order: number[] = [];
    let at = scalar(state, 'head', -1);
    while (at >= 0 && at < count && !order.includes(at)) {
      order.push(at);
      at = next[at] ?? -1;
    }
    return (
      <div className="lab-linked-scroll">
        <div className="lab-linked">
          <span className="muted">head →</span>
          {order.map((node) => (
            <div className="lab-linked-item" key={node}>
              <div
                className="lab-link-node"
                data-write={changed('next', node) || changed('prev', node) || changed('a', node)}
              >
                <strong>{shown(a[node])}</strong>
                <small>节点 {node}</small>
                <span>
                  next: {shown(next[node])}
                  {spec.slug === 'doubly-linked-list' ? ` · prev: ${shown(prev[node])}` : ''}
                </span>
              </div>
              <span aria-hidden="true">→</span>
            </div>
          ))}
          <span className="muted">∅</span>
        </div>
      </div>
    );
  }
  function hash() {
    const heads = array(state, 'head', 7),
      next = array(state, 'next', n),
      a = array(state, 'a', n);
    return (
      <div className="lab-hash" aria-label="哈希桶与冲突链">
        {heads.map((head, bucket) => {
          const chain: number[] = [];
          let node = head ?? -1;
          while (node >= 0 && node < n && !chain.includes(node)) {
            chain.push(node);
            node = next[node] ?? -1;
          }
          return (
            <div className="lab-hash-row" key={bucket}>
              <strong>桶 {bucket}</strong>
              <span>→</span>
              {chain.map((index) => (
                <span className="lab-hash-item" key={index} data-active={current === index}>
                  {shown(a[index])}
                  <small>#{index}</small>
                  <span>→</span>
                </span>
              ))}
              <span className="muted">{head === null ? '—' : '∅'}</span>
            </div>
          );
        })}
      </div>
    );
  }
  function trie() {
    const count = Math.min(24, size),
      link = array(state, 'link'),
      terminal = array(state, 'terminal');
    const points = new Map<number, { x: number; y: number }>();
    const edges: { from: number; to: number; letter: string }[] = [];
    const walk = (node: number, x: number, y: number, spread: number) => {
      if (node >= count || points.has(node)) return;
      points.set(node, { x, y });
      for (let c = 0; c < 3; c++) {
        const child = link[node * 3 + c];
        if (child && child < count) {
          edges.push({ from: node, to: child, letter: String.fromCharCode(97 + c) });
          walk(child, x + (c - 1) * spread, y + 58, spread / 2);
        }
      }
    };
    if (count) walk(0, 240, 28, 140);
    return (
      <svg viewBox="0 0 480 350" className="lab-tree" role="img" aria-label="当前字典树">
        {edges.map((e, i) => {
          const a = points.get(e.from),
            b = points.get(e.to);
          return a && b ? (
            <g className="lab-edge" key={i}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              <text x={(a.x + b.x) / 2 + 10} y={(a.y + b.y) / 2}>
                {e.letter}
              </text>
            </g>
          ) : null;
        })}
        {[...points].map(([i, p]) => (
          <g
            className={`lab-node${current === i ? ' current' : ''}`}
            key={i}
            transform={`translate(${p.x},${p.y})`}
          >
            <circle r="17" />
            {terminal[i] === 1 && <circle r="12" />}
            <text y="5">{i}</text>
          </g>
        ))}
      </svg>
    );
  }
  function matrix() {
    const rows = Math.min(9, scalar(state, 'rows')),
      cols = Math.min(9, scalar(state, 'cols')),
      cells = array(state, 'dp', rows * cols);
    if (!rows || !cols) return <div className="lab-empty">准备状态表…</div>;
    return (
      <div className="lab-matrix-scroll">
        <table className="lab-matrix" aria-label="当前动态规划状态表">
          <thead>
            <tr>
              <th></th>
              {Array.from({ length: cols }, (_, i) => (
                <th key={i}>
                  {['lcs', 'edit-distance'].includes(spec.slug)
                    ? (draft.pattern?.[i - 1] ?? '∅')
                    : i}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                <th>
                  {['lcs', 'edit-distance'].includes(spec.slug) ? (draft.text?.[r - 1] ?? '∅') : r}
                </th>
                {Array.from({ length: cols }, (_, c) => (
                  <td
                    key={c}
                    data-write={changed('dp', r * cols + c)}
                    data-active={scalar(state, 'i', -1) === r && scalar(state, 'j', -1) === c}
                  >
                    {shown(cells[r * cols + c] ?? null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  function hanoi() {
    const rods = array(state, 'rods'),
      height = array(state, 'height', 3);
    return (
      <svg
        className="lab-hanoi"
        viewBox="0 0 480 260"
        role="img"
        aria-label="当前三根柱子的盘子位置"
      >
        {[0, 1, 2].map((rod) => (
          <g key={rod}>
            <line
              x1={80 + rod * 160}
              y1="30"
              x2={80 + rod * 160}
              y2="210"
              className="lab-tree-edge"
            />
            <line
              x1={12 + rod * 160}
              y1="212"
              x2={148 + rod * 160}
              y2="212"
              className="lab-tree-edge"
            />
            {Array.from({ length: Math.max(0, height[rod] ?? 0) }, (_, i) => {
              const disk = rods[rod * 5 + i] ?? 0;
              return disk > 0 ? (
                <g key={i}>
                  <rect
                    x={80 + rod * 160 - (disk * 9 + 10)}
                    y={190 - i * 28}
                    width={disk * 18 + 20}
                    height="24"
                    rx="4"
                    className="lab-disk"
                  />
                  <text x={80 + rod * 160} y={207 - i * 28}>
                    {disk}
                  </text>
                </g>
              ) : null;
            })}
            <text x={80 + rod * 160} y="244">
              {rod + 1}
            </text>
          </g>
        ))}
      </svg>
    );
  }
  const scalarNames = [
    'i',
    'j',
    'k',
    'lo',
    'hi',
    'mid',
    'pivot',
    'gap',
    'exp',
    'target',
    'current',
    'front',
    'rear',
    'size',
    'root',
    'answer',
    'total',
    'capacity',
    'found',
  ];
  const barValues = array(state, 'a', n);
  const negativeBars = barValues.some((v) => v !== null && v < 0);
  const barScale = Math.max(1, ...barValues.map((v) => Math.abs(v ?? 0)));
  return (
    <div className="lab-current-state" data-testid="lab-current-state">
      {spec.kind === 'bars' && (
        <div className="lab-bar-scroll">
          <div className="lab-bars">
            {barValues.map((v, i) => (
              <div
                className="lab-bar-column"
                key={i}
                data-write={changed('a', i)}
                data-active={activeIndices.includes(i)}
              >
                <strong>{shown(v)}</strong>
                <div className="lab-bar-track" data-negative={negativeBars}>
                  <span
                    style={{
                      height: `${(Math.abs(v ?? 0) / barScale) * (negativeBars ? 70 : 140)}px`,
                      top: v !== null && v < 0 ? '50%' : undefined,
                      bottom: v !== null && v >= 0 ? (negativeBars ? '50%' : '0') : undefined,
                    }}
                  />
                </div>
                <small>{i}</small>
              </div>
            ))}
          </div>
        </div>
      )}
      {['graph', 'parents'].includes(spec.kind) && graph()}
      {['tree', 'heap'].includes(spec.kind) && tree()}
      {spec.kind === 'links' && links()}
      {spec.kind === 'hash' && hash()}
      {spec.kind === 'trie' && trie()}
      {spec.kind === 'matrix' && matrix()}
      {spec.kind === 'hanoi' && hanoi()}
      {spec.arrays
        .filter(
          (name) =>
            !(spec.kind === 'bars' && name === 'a') &&
            !(spec.kind === 'matrix' && name === 'dp') &&
            !['tree', 'heap', 'links', 'trie', 'hanoi'].includes(spec.kind),
        )
        .map((name) =>
          row(
            name,
            name === 'a'
              ? spec.inputKind === 'strings'
                ? scalar(state, 'm')
                : ['operations'].includes(spec.inputKind)
                  ? 8
                  : spec.inputKind === 'array'
                    ? size
                    : n
              : name === 'b'
                ? n
                : name === 'seen' ||
                    name === 'distance' ||
                    name === 'parent' ||
                    name === 'indegree' ||
                    name === 'rank'
                  ? n || Number(draft.number)
                  : name === 'dp' && spec.slug === 'stairs'
                    ? n + 1
                    : undefined,
            spec.inputKind === 'strings',
          ),
        )}
      <dl className="lab-variables">
        {scalarNames.flatMap((name) => {
          const o = object(state, name);
          return o && o.alive && o.length === 1 && cell(o, 0) !== null
            ? [
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{shown(cell(o, 0))}</dd>
                </div>,
              ]
            : [];
        })}
      </dl>
      <section className="lab-output">
        <h3>输出</h3>
        <pre aria-label="程序输出" data-testid="lab-output">
          {state.output || '—'}
        </pre>
      </section>
    </div>
  );
}
