import type { AlgorithmPlayer } from '../engine/algorithm-player';
import type { AlgorithmResult } from '../engine/algorithm-protocol';
import type { StructureCase } from './content';
import { scalarValue, structureView, outcomeText } from './presentation';
import { slotValue } from '../algorithms/presentation';
const valueText = (v: number | null) => (v === null ? '未初始化' : String(v));
export function StructureState({
  view,
  result,
  spec,
}: {
  view: ReturnType<AlgorithmPlayer['snapshot']>;
  result: AlgorithmResult;
  spec: StructureCase;
}) {
  const state = view.state;
  if (!state) return <p>当前没有可回放状态。</p>;
  const step = view.cursor ? (result.trace?.steps[view.cursor - 1] ?? null) : null,
    projection = structureView(state, step, spec),
    frame = state.frames.find((f) => f.id === state.control.activeFrameId);
  const cells = spec.kind === 'stack' ? [...projection.cells].reverse() : projection.cells;
  return (
    <>
      <div className="step-counters">
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
            <strong data-testid={`structure-counter-${key}`}>{value}</strong>
          </span>
        ))}
      </div>
      <p className="muted">
        计数含输入、初始化、条件和同值写；槽值无差异不代表没有赋值。动作处理数另读源码processed。
      </p>
      <section
        className="structure-data"
        data-testid="structure-data"
        data-object-id={projection.data?.id ?? ''}
        data-size={projection.quantity ?? 'uninitialized'}
        data-top={projection.top ?? ''}
        data-head={projection.head ?? ''}
        data-tail={projection.tail ?? ''}
      >
        <h3>{spec.kind === 'stack' ? '当前数组栈' : '当前环形队列'}</h3>
        <dl className="structure-summary">
          <div>
            <dt>有效项 / 容量</dt>
            <dd data-testid="structure-size">
              {projection.quantity ?? '待初始化'} / {spec.capacity}
            </dd>
          </div>
          <div>
            <dt>完整处理命令</dt>
            <dd data-testid="structure-processed">{projection.processed ?? '待初始化'}</dd>
          </div>
          <div>
            <dt>最近源码结果</dt>
            <dd data-testid="structure-outcome" data-code={projection.outcome ?? ''}>
              {projection.outcome === null
                ? '尚未初始化'
                : (outcomeText[projection.outcome] ?? `未知码${projection.outcome}`)}
            </dd>
          </div>
        </dl>
        <p>
          {spec.kind === 'stack'
            ? `top=${projection.top ?? '待初始化'}，表示有效项数及下一入位置；top=5为容量端点，没有物理槽[5]。下图从高下标到[0]阅读。`
            : `head=${projection.head ?? '待初始化'}、tail=${projection.tail ?? '待初始化'}是单调序号；物理槽取模5，当前数量由tail−head投影。空差0、满差5，即使物理头尾相同也可区分。`}
        </p>
        <p className="muted">
          读候选槽：{projection.reader === null ? '无' : `[${projection.reader}]`}；写候选槽：
          {projection.writer === null ? '无' : `[${projection.writer}]`}
          。空时不读、满时不写，实际结果以C++的outcome为准。
        </p>
        {projection.layoutIssue && (
          <p role="alert">真实边界字段不满足此案例布局，未补齐或截断；请核对当前变量与源码。</p>
        )}
        {projection.data ? (
          <>
            <ol
              className={`structure-slots structure-slots-${spec.kind}`}
              aria-label="五个真实物理槽"
            >
              {cells.map((cell) => (
                <li
                  key={cell.index}
                  data-testid="structure-cell"
                  data-index={cell.index}
                  data-value={cell.value ?? 'uninitialized'}
                  data-valid={cell.valid === null ? 'unknown' : String(cell.valid)}
                  data-write={cell.write}
                  data-address={cell.virtualAddress}
                >
                  <span className="structure-index">[{cell.index}]</span>
                  <b>{valueText(cell.value)}</b>
                  <span>
                    {cell.valid === null
                      ? '有效范围待初始化'
                      : cell.valid
                        ? '有效项'
                        : cell.value === null
                          ? '未用槽'
                          : '已写，当前非有效'}
                  </span>
                  <small>
                    {cell.write ? '本步槽值写入' : '—'}
                    {cell.index === projection.reader ? ' · 读候选' : ''}
                    {cell.index === projection.writer ? ' · 写候选' : ''}
                  </small>
                </li>
              ))}
            </ol>
            <p>
              已写但非有效的槽可能是刚写尚未发布的值，或出操作留下的残值；不把它计入结构。
              {spec.kind === 'circular-queue' ? '物理[4]之后回[0]，序号继续增长。' : ''}
            </p>
            <p data-testid="structure-logical">
              {spec.kind === 'stack' ? '有效项（底→顶）' : '有效项（先出→后出）'}：
              {projection.logical === null
                ? '边界尚未就绪'
                : projection.logical.length
                  ? projection.logical
                      .map((item) => `${valueText(item.value)} [${item.index}]`)
                      .join(' → ')
                  : '空'}
            </p>
            <details className="sort-method">
              <summary>物理存储与运行帧</summary>
              <p data-testid="structure-layout">
                对象{projection.data.id}，data[{projection.data.length}]=
                {projection.data.length * 4}教学字节，虚拟地址[{projection.data.baseAddress},{' '}
                {projection.data.baseAddress + projection.data.length * 4}
                )。未用槽未初始化，出操作不清零；这些是教学地址，非宿主真实地址。
              </p>
              <p>
                执行帧：{frame ? `${frame.functionName}（${frame.id}）` : '无'}；当前存活分配
                {state.allocator.liveBytes}教学字节。本例仅main，不把数据结构栈当作调用栈。
              </p>
            </details>
          </>
        ) : (
          <p data-testid="structure-absent">
            当前没有存活的数据数组；前进到声明后或从结束处后退查看。
          </p>
        )}
      </section>
      <section>
        <h3>当前真实变量</h3>
        <ul className="variable-grid">
          {state.objects
            .filter((o) => o.kind === 'int')
            .map((o) => (
              <li
                className="variable-value"
                key={o.id}
                data-testid="structure-variable"
                data-name={o.name}
              >
                <span>
                  {o.name}
                  <small>
                    {' '}
                    {o.id} · {o.scopeId}
                  </small>
                </span>
                <b>{valueText(slotValue(o, 0))}</b>
              </li>
            ))}
        </ul>
        <p className="muted">
          cin实际已读{state.control.inputCursor}个整数槽；源码consumed=
          {scalarValue(state, 'consumed') ?? '待初始化'}。独立赋值之间可暂时不同，不提前补齐。
        </p>
      </section>
      <section>
        <h3>当前实际输出</h3>
        <p className="muted">
          IN/OUT为成功入/出，FULL/EMPTY为已满/空时拒绝，END为程序结束；不是每条操作都成功。
        </p>
        <pre
          className="structure-output"
          tabIndex={0}
          aria-label="当前实际程序输出"
          data-testid="structure-output"
        >
          {state.output || '（无输出）'}
        </pre>
      </section>
    </>
  );
}
