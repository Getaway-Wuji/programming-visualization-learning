import type { AdvancedState } from '../engine/advanced-protocol';
import { projectAlgorithmArrays, type AdvancedAlgorithmSpec } from './content';
export function AlgorithmArrays({
  spec,
  values,
  state,
}: {
  spec: AdvancedAlgorithmSpec;
  values: number[];
  state: AdvancedState;
}) {
  return (
    <section aria-label="算法真实状态图" className="advanced-array-state">
      <h3>当前数组状态</h3>
      {spec.inputKind === 'bound' && (
        <p>
          composite中1表示已排除，0只表示当前候选；筛选结束后才能从2以上候选读取素数。marks是实际核心标记次数，0/1边界排除不计入。
        </p>
      )}
      {projectAlgorithmArrays(spec, values, state).map((a) => (
        <section
          key={a.name}
          data-testid="algorithm-array"
          data-name={a.name}
          data-present={a.present}
          data-extent={a.extent ?? 'unknown'}
        >
          <h4>
            {a.name} · {a.label}
          </h4>
          {a.present ? (
            <>
              <p>
                物理容量{a.capacity}，当前逻辑长度{a.extent ?? '尚未声明count'}。
              </p>
              {a.values.length ? (
                <ol className="advanced-array-grid">
                  {a.values.map((v, i) => (
                    <li key={i} data-index={i} data-marked={a.name === 'composite' && v === 1}>
                      <small>[{i}]</small>
                      <strong>{v === null ? '未初始化' : String(v)}</strong>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>当前没有可读取的逻辑元素。</p>
              )}
            </>
          ) : (
            <p>此数组尚未声明或已结束；前进/后退查看其生命周期。</p>
          )}
        </section>
      ))}
    </section>
  );
}
