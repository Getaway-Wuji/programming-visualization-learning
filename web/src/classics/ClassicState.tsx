import type { MemoryResult, MemoryState } from '../engine/memory-protocol';
import type { ClassicCase } from './content';
import { classicMainObjects, hanoiView } from './presentation';
import { memorySlots, memoryValueText } from '../memory/presentation';
export function ClassicState({
  state,
  result,
  spec,
}: {
  state: MemoryState;
  result: MemoryResult;
  spec: ClassicCase;
}) {
  const main = classicMainObjects(state),
    hanoi = spec.kind === 'hanoi' ? hanoiView(state, result.types) : null;
  return (
    <section aria-label="当前真实数值" data-testid="classic-values">
      {hanoi && (
        <section data-testid="hanoi-state" data-n={hanoi.n ?? ''} data-ready={hanoi.layoutReady}>
          <h3>当前盘位置</h3>
          <p>
            柱号0/1/2；盘号越大盘越大。只按真实positions排列，moveState候选字段与次数的独立赋值不提前补齐。
          </p>
          {!hanoi.positions ? (
            <p>当前无存活positions数组；从终态后退可恢复。</p>
          ) : !hanoi.layoutReady ? (
            <p data-testid="hanoi-uninitialized">
              positions尚未初始化，暂不画盘；下方保留真实未初始化槽。
            </p>
          ) : hanoi.layoutIssue ? (
            <p role="alert">真实盘位置超出柱号范围，请查看原始存储。</p>
          ) : (
            <div className="hanoi-pegs">
              {hanoi.pegs.map((peg) => (
                <section
                  className="hanoi-peg"
                  key={peg.peg}
                  data-testid="hanoi-peg"
                  data-peg={peg.peg}
                >
                  <h4>柱{peg.peg}</h4>
                  <ol aria-label={`柱${peg.peg}从底到顶`}>
                    {peg.disks.map((d) => (
                      <li
                        key={d.index}
                        data-testid="hanoi-disk"
                        data-index={d.index}
                        data-size={d.size}
                        data-peg={d.peg}
                        style={{ width: `${35 + d.size * 12}%` }}
                      >
                        盘{d.size}
                      </li>
                    ))}
                  </ol>
                  {peg.disks.length === 0 && <span className="muted">空</span>}
                </section>
              ))}
            </div>
          )}
          {hanoi.moveState && (
            <p data-testid="hanoi-move-fields">
              源码moveState（次数/from/to/盘索引）：
              {hanoi.rawMoves.map((s) => memoryValueText(s.value, state)).join(' / ')}
              。候选字段可能正更新，不额外计算下一移动。
            </p>
          )}
        </section>
      )}
      <h3>main当前真实变量与存储</h3>
      {main.length === 0 ? (
        <p>main当前无存活对象，后退可恢复；当前输出仍保留。</p>
      ) : (
        <ul className="variable-grid">
          {main.map((o) => (
            <li
              className="variable-value"
              key={o.id}
              data-testid="classic-object"
              data-object-id={o.id}
              data-name={o.name}
            >
              <span>
                {o.name}
                <small>
                  {' '}
                  {o.id} · {o.scopeId}
                </small>
              </span>
              <div>
                {memorySlots(o, result.types).map((slot) => (
                  <span
                    className="classic-slot"
                    key={slot.byteOffset}
                    data-testid="classic-slot"
                    data-offset={slot.byteOffset}
                    data-value={typeof slot.value === 'number' ? slot.value : 'uninitialized'}
                  >
                    {o.length > 1 ? `[${slot.ordinal}] ` : ''}
                    {memoryValueText(slot.value, state)}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">
        cin实际已读{state.control.inputCursor}
        项。这里没有前端计算的算法答案；各层参数、局部和别名可切到调用栈查看。
      </p>
    </section>
  );
}
