import type { AlgorithmState, AlgorithmStep } from '../engine/algorithm-protocol';
import type { BucketLayout } from './content';
import { bucketRows } from './bucket-presentation';
import { valueText } from './SortArray';

export function BucketState({
  state,
  step,
  layout,
}: {
  state: AlgorithmState;
  step: AlgorithmStep | null;
  layout: BucketLayout;
}) {
  const rows = bucketRows(state, step, layout),
    frame = state.frames.find((f) => f.id === state.control.activeFrameId),
    sizes = state.objects.find((o) => o.name === layout.sizesObject);
  return (
    <section className="bucket-stage" data-testid="bucket-stage" data-frame-id={frame?.id ?? ''}>
      <h3>五个桶 · 当前真实存储</h3>
      <p>
        桶号=(值+20)/10。每桶30槽，按输入顺序放入；桶内严格大于key才右移，再按桶号回填。下方数量与槽值来自当前步骤。
      </p>
      <p className="muted">
        执行帧：{frame ? `${frame.functionName}（${frame.id}）` : '无'}；当前存活分配
        {state.allocator.liveBytes}教学字节。使用自动数组，无堆节点或递归。
      </p>
      {rows ? (
        <>
          <div className="bucket-rows">
            {rows.map((row) => (
              <section
                className="bucket-row"
                key={row.bucket}
                data-testid="bucket-row"
                data-bucket={row.bucket}
                data-size={row.size ?? 'uninitialized'}
                data-object-id={row.objectId}
              >
                <div className="bucket-heading">
                  <h4>
                    桶{row.bucket} · {row.range[0]}～{row.range[1]}
                  </h4>
                  <span data-testid="bucket-size" data-write={row.sizeWrite}>
                    {row.size === null
                      ? '数量尚未初始化'
                      : `${row.size} / ${layout.bucketCapacity}项`}
                    {row.sizeWrite ? ' · 数量写入' : ''}
                  </span>
                </div>
                {row.cells.length ? (
                  <ol className="bucket-slots">
                    {row.cells.map((cell) => (
                      <li
                        key={cell.index}
                        data-testid="bucket-cell"
                        data-index={cell.physicalIndex}
                        data-value={cell.value ?? 'uninitialized'}
                        data-write={cell.write}
                        data-pending={cell.pending}
                      >
                        <b>{valueText(cell.value)}</b>
                        <small>
                          桶内{cell.index} · [{cell.physicalIndex}]
                        </small>
                        <span>
                          {cell.pending ? '本步已写，尚未计数' : cell.write ? '槽值写入' : '—'}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted">
                    {row.size === null ? '数量存储尚未就绪。' : '空桶；30个预留槽不算输入。'}
                  </p>
                )}
              </section>
            ))}
          </div>
          <details className="sort-method" open>
            <summary>物理辅助存储与教学地址</summary>
            <p>
              bucketData[150]未用槽保持未初始化；bucketSizes[5]单独清零。辅助数组共620字节，原values[30]另占120字节，尚有常数标量。合并后桶仍保留至main退出。
            </p>
            <p className="muted">
              以下为教学虚拟地址，非宿主真实地址；区间右端为下一槽起点，不属于本桶。布局来自真实对象基址和4字节int槽。
            </p>
            {sizes ? (
              <p
                data-testid="bucket-sizes-object"
                data-object-id={sizes.id}
                data-base-address={sizes.baseAddress}
              >
                数量数组{sizes.name}（{sizes.id}）：{sizes.length}槽 / {sizes.length * 4}
                教学字节，虚拟区间[{sizes.baseAddress}, {sizes.baseAddress + sizes.length * 4})。
                {sizes.defaultValue === null
                  ? '尚未整体初始化。'
                  : '已按源码零初始化，当前值见各桶数量。'}
              </p>
            ) : (
              <p>数量数组尚未声明，不能将数量视为0。</p>
            )}
            <div className="sort-memory" tabIndex={0} aria-label="五桶物理段布局">
              <table>
                <caption>对象{rows[0].objectId} · 五段独立30槽</caption>
                <thead>
                  <tr>
                    <th>桶</th>
                    <th>物理槽</th>
                    <th>虚拟地址区间</th>
                    <th>数量 / 容量</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.bucket}
                      data-testid="bucket-layout"
                      data-start-address={row.baseAddress}
                      data-end-address={row.endAddress}
                    >
                      <td>桶{row.bucket}</td>
                      <td>
                        bucketData[{row.offset}..{row.offset + layout.bucketCapacity - 1}]
                      </td>
                      <td>
                        [{row.baseAddress}, {row.endAddress})
                      </td>
                      <td>
                        {row.size ?? '未初始化'} / {layout.bucketCapacity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p data-testid="bucket-absent">
          当前没有存活的桶数据数组；前进到声明之后，或从程序结束处后退查看。
        </p>
      )}
    </section>
  );
}
