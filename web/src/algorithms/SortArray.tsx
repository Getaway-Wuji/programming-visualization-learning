import type { CSSProperties } from 'react';
import type { AlgorithmObject, AlgorithmStep } from '../engine/algorithm-protocol';
import { slotValue, writtenSlots } from './presentation';

export const valueText = (value: number | null) => (value === null ? '未初始化' : String(value));
export function SortArray({
  object,
  length,
  step,
  buckets = false,
  auxiliary = false,
}: {
  object: AlgorithmObject;
  length: number;
  step: AlgorithmStep | null;
  buckets?: boolean;
  auxiliary?: boolean;
}) {
  const values = Array.from({ length }, (_, index) => slotValue(object, index)),
    writes = writtenSlots(step, object);
  const scale = Math.max(1, ...values.map((value) => Math.abs(value ?? 0)));
  const style = { '--array-cell-min': '56px', '--array-plot-height': '120px' } as CSSProperties;
  return (
    <section
      className="trace-array"
      data-testid="sort-array"
      data-name={object.name}
      data-object-id={object.id}
      data-logical-length={length}
    >
      <h3>
        {buckets
          ? '计数桶 · 当前剩余次数'
          : auxiliary
            ? '辅助数组 · scratch'
            : '原数组 · 当前逻辑项'}
      </h3>
      <p className="muted">
        {buckets
          ? '下标0～40分别对应整数−20～20；回填会扣减次数。'
          : `逻辑长度${length}，物理容量${object.length}；未使用槽不算输入。`}{' '}
        写入以边框与文字同时标明。
      </p>
      {length === 0 ? (
        <p>空数组，不显示物理占位项。</p>
      ) : (
        <>
          <p className="array-chart-guide">
            <span>按下标从左到右、逐行阅读，各行同一比例。</span>
            <span>
              上 +{scale} · 零线0 · 下 −{scale}
            </span>
          </p>
          <div
            className="array-chart-scroll"
            style={style}
            tabIndex={0}
            aria-label={buckets ? '41个真实计数桶' : '当前真实数组柱状图'}
          >
            <ol className="array-chart">
              {values.map((value, index) => (
                <li
                  className="array-cell"
                  key={index}
                  data-testid="sort-cell"
                  data-index={index}
                  data-value={value ?? 'uninitialized'}
                  data-write={writes.has(index)}
                >
                  <span className="array-value">{valueText(value)}</span>
                  <span className="bar-plot" aria-hidden="true">
                    <span
                      className={`value-bar ${value === null ? 'value-unknown' : value < 0 ? 'value-negative' : 'value-positive'}${value === 0 ? ' value-zero' : ''}`}
                      style={{
                        height:
                          value === null
                            ? '16px'
                            : `${Math.max(2, (Math.abs(value) / scale) * 52)}px`,
                      }}
                    />
                  </span>
                  <span className="array-index">
                    {buckets ? `${index - 20} [${index}]` : `[${index}]`}
                  </span>
                  <span className="access-label">{writes.has(index) ? '写入' : '—'}</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
