import { useState } from 'react';
import type { MemoryResult, MemoryState } from '../engine/memory-protocol';
import {
  MEMORY_PAGE_SIZE,
  memorySlots,
  memoryValueText,
  pointerPresentation,
  slotCount,
  virtualAddress,
} from './presentation';

export function MemoryPanel({
  state,
  previous,
  result,
}: {
  state: MemoryState;
  previous: MemoryState | null;
  result: MemoryResult;
}) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState('');
  const [slotPage, setSlotPage] = useState(0);
  const [includeEnded, setIncludeEnded] = useState(true);
  const objects = state.objects.filter((object) => includeEnded || object.alive);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(objects.length / MEMORY_PAGE_SIZE) - 1));
  const visible = objects.slice(
    currentPage * MEMORY_PAGE_SIZE,
    (currentPage + 1) * MEMORY_PAGE_SIZE,
  );
  const object = visible.find((item) => item.id === selected) ?? visible[0];
  const oldObject = previous?.objects.find((item) => item.id === object?.id);
  const count = object ? slotCount(object, result.types) : 0;
  const currentSlotPage = Math.min(slotPage, Math.max(0, Math.ceil(count / MEMORY_PAGE_SIZE) - 1));
  const slots = object ? memorySlots(object, result.types, currentSlotPage) : [];
  const priorSlots = oldObject ? memorySlots(oldObject, result.types, currentSlotPage) : [];
  return (
    <section className="memory-panel" aria-label="内存视图" data-testid="memory-panel">
      <p className="memory-address-note">
        教学用虚拟地址，非本机真实地址。对象结束后保留标识，后退可恢复。
      </p>
      <div className="memory-summary">
        <span>
          存活对象 <strong>{state.objects.filter((item) => item.alive).length}</strong>
        </span>
        <span>
          已结束 <strong>{state.objects.filter((item) => !item.alive).length}</strong>
        </span>
        <span>
          活动字节 <strong>{state.allocator.liveBytes}</strong> B
        </span>
      </div>
      <label className="memory-check">
        <input
          type="checkbox"
          checked={includeEnded}
          onChange={(event) => {
            setIncludeEnded(event.target.checked);
            setPage(0);
            setSlotPage(0);
          }}
        />
        显示已结束对象
      </label>
      {objects.length === 0 ? (
        <p className="muted">当前没有符合条件的对象。前进到声明或分配步骤后查看。</p>
      ) : (
        <>
          <div className="memory-object-picker">
            <label>
              查看对象{' '}
              <select
                aria-label="查看内存对象"
                value={object?.id ?? ''}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setSlotPage(0);
                }}
              >
                {visible.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.id} · {item.alive ? '存活' : '已结束'}
                  </option>
                ))}
              </select>
            </label>
            {objects.length > MEMORY_PAGE_SIZE ? (
              <div className="inline-actions">
                <button
                  className="button button-small"
                  disabled={currentPage === 0}
                  onClick={() => {
                    setPage(currentPage - 1);
                    setSlotPage(0);
                  }}
                >
                  上一页对象
                </button>
                <span>
                  第 {currentPage + 1} / {Math.ceil(objects.length / MEMORY_PAGE_SIZE)} 页 · 共{' '}
                  {objects.length} 个
                </span>
                <button
                  className="button button-small"
                  disabled={(currentPage + 1) * MEMORY_PAGE_SIZE >= objects.length}
                  onClick={() => {
                    setPage(currentPage + 1);
                    setSlotPage(0);
                  }}
                >
                  下一页对象
                </button>
              </div>
            ) : (
              <span className="muted">共 {objects.length} 个对象</span>
            )}
          </div>
          {object && (
            <article
              className="memory-object"
              data-testid="memory-object"
              data-object-id={object.id}
              data-alive={object.alive}
              data-base-address={object.baseAddress}
            >
              <h3>
                {object.name} <small>{object.id}</small>
              </h3>
              <dl className="memory-properties">
                <div>
                  <dt>类型</dt>
                  <dd>
                    {object.typeName} · {object.length} 个元素
                  </dd>
                </div>
                <div>
                  <dt>教学地址</dt>
                  <dd>{virtualAddress(object.baseAddress)}</dd>
                </div>
                <div>
                  <dt>大小</dt>
                  <dd>{object.byteLength} B</dd>
                </div>
                <div>
                  <dt>存储</dt>
                  <dd>{object.storage === 'heap' ? '动态对象' : '自动对象'}</dd>
                </div>
                <div>
                  <dt>作用域</dt>
                  <dd>{object.scopeId ?? '不随作用域结束'}</dd>
                </div>
                <div>
                  <dt>生命周期</dt>
                  <dd data-testid="memory-lifetime">
                    {object.alive ? '存活' : '已结束'}
                    {oldObject && oldObject.alive !== object.alive
                      ? ' · 本步变化'
                      : !oldObject
                        ? ' · 本步创建'
                        : ''}
                  </dd>
                </div>
              </dl>
              {!object.alive ? (
                <p className="memory-ended">
                  值已随生命周期结束而清除。引用此 {object.id}{' '}
                  的指针属于悬空引用；后退可恢复结束前的值。
                </p>
              ) : (
                <>
                  <div
                    className="memory-table-scroll"
                    tabIndex={0}
                    aria-label="内存值槽，可横向滚动"
                  >
                    <table className="memory-table">
                      <caption>元素与字段 · 偏移以字节计</caption>
                      <thead>
                        <tr>
                          <th scope="col">元素 / 字段</th>
                          <th scope="col">教学地址 / 偏移</th>
                          <th scope="col">类型与当前值</th>
                          <th scope="col">本步变化</th>
                        </tr>
                      </thead>
                      <tbody>
                        {slots.map((slot) => {
                          const old = priorSlots.find(
                            (item) => item.byteOffset === slot.byteOffset,
                          );
                          const changed =
                            !old || JSON.stringify(old.value) !== JSON.stringify(slot.value);
                          const pointer =
                            typeof slot.value === 'object' && slot.value !== null
                              ? slot.value
                              : null;
                          const reference = pointer ? pointerPresentation(pointer, state) : null;
                          return (
                            <tr
                              key={slot.byteOffset}
                              data-testid="memory-slot"
                              data-byte-offset={slot.byteOffset}
                              data-reference={reference?.kind ?? ''}
                              data-changed={changed}
                            >
                              <th scope="row">{slot.name}</th>
                              <td>
                                {slot.address}
                                <br />
                                <small>+{slot.byteOffset} B</small>
                              </td>
                              <td>
                                <small>{slot.typeName}</small>
                                <span className="memory-value">
                                  {memoryValueText(slot.value, state)}
                                </span>
                                {pointer && (
                                  <small>
                                    来源区间 [{pointer.lowerBound}, {pointer.upperBound}) B ·
                                    所指类型 {pointer.pointeeType}
                                  </small>
                                )}
                              </td>
                              <td>
                                {changed ? (
                                  old ? (
                                    <>
                                      <span>{memoryValueText(old.value, previous!)} →</span>
                                      <br />
                                      <strong>{memoryValueText(slot.value, state)}</strong>
                                    </>
                                  ) : (
                                    '新建值槽'
                                  )
                                ) : (
                                  '—'
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {count > MEMORY_PAGE_SIZE && (
                    <div className="inline-actions">
                      <button
                        className="button button-small"
                        disabled={currentSlotPage === 0}
                        onClick={() => setSlotPage(currentSlotPage - 1)}
                      >
                        上一页值槽
                      </button>
                      <span>
                        第 {currentSlotPage + 1} / {Math.ceil(count / MEMORY_PAGE_SIZE)} 页 · 共{' '}
                        {count} 槽
                      </span>
                      <button
                        className="button button-small"
                        disabled={(currentSlotPage + 1) * MEMORY_PAGE_SIZE >= count}
                        onClick={() => setSlotPage(currentSlotPage + 1)}
                      >
                        下一页值槽
                      </button>
                    </div>
                  )}
                </>
              )}
            </article>
          )}
        </>
      )}
    </section>
  );
}

export function MemoryBasicView({ state, result }: { state: MemoryState; result: MemoryResult }) {
  const alive = state.objects.filter((object) => object.alive);
  return (
    <section aria-label="基础视图" data-testid="memory-basic">
      <h3>当前变量与对象</h3>
      {alive.length === 0 ? (
        <p className="muted">当前没有存活对象。</p>
      ) : (
        <ul className="memory-basic-values">
          {alive.slice(0, MEMORY_PAGE_SIZE).map((object) => (
            <li key={object.id}>
              <strong>{object.name}</strong>{' '}
              <small>
                {object.id} · {object.typeName}
              </small>
              <span>
                {memorySlots(object, result.types)
                  .map((slot) => `${slot.name}: ${memoryValueText(slot.value, state)}`)
                  .join('；')}
              </span>
              {slotCount(object, result.types) > MEMORY_PAGE_SIZE && (
                <small>
                  前16槽，共{slotCount(object, result.types)}槽；完整值可在内存视图分页查看。
                </small>
              )}
            </li>
          ))}
        </ul>
      )}
      {alive.length > MEMORY_PAGE_SIZE && (
        <p>前16个存活对象，共{alive.length}个；完整对象可在内存视图分页查看。</p>
      )}
    </section>
  );
}
