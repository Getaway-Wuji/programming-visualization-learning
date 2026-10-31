import { useState } from 'react';
import type {
  AdvancedResult,
  AdvancedState,
  AdvancedObject,
  AdvancedValue,
} from '../engine/advanced-protocol';
export function valueText(v: AdvancedValue, state: AdvancedState): string {
  if (v === null) return '未初始化';
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  if (v.objectId === null) return '空指针';
  const object = state.objects.find((o) => o.id === v.objectId);
  return `${v.objectId} + ${v.byteOffset} → ${object ? '0x' + (object.baseAddress + v.byteOffset).toString(16).toUpperCase() : '—'}${object?.alive ? '' : '（已结束）'}`;
}
function Slots({
  object,
  state,
  result,
}: {
  object: AdvancedObject;
  state: AdvancedState;
  result: AdvancedResult;
}) {
  const [page, setPage] = useState(0);
  const type = result.types.find((t) => t.name === object.typeName)!;
  const fields =
    type.kind === 'struct' ? type.fields : [{ name: '', byteOffset: 0, typeName: type.name }];
  const count = object.length * fields.length;
  const at = Math.min(page, Math.max(0, Math.ceil(count / 16) - 1));
  return (
    <>
      <div className="custom-table-scroll">
        <table>
          <thead>
            <tr>
              <th>槽位</th>
              <th>虚拟地址</th>
              <th>当前值</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.min(16, count - at * 16) }, (_, i) => {
              const n = at * 16 + i;
              const element = Math.floor(n / fields.length);
              const field = fields[n % fields.length];
              const offset = element * type.byteSize + field.byteOffset;
              const cell = object.cells.find((c) => c.byteOffset === offset);
              const ft = result.types.find((t) => t.name === field.typeName)!;
              const val = cell
                ? valueText(cell.value, state)
                : object.zeroInitialized
                  ? ft.kind === 'pointer'
                    ? '空指针'
                    : '0'
                  : '未初始化';
              return (
                <tr key={offset}>
                  <th>
                    {object.name}
                    {object.length > 1 ? `[${element}]` : ''}
                    {field.name ? '.' + field.name : ''}
                  </th>
                  <td>0x{(object.baseAddress + offset).toString(16).toUpperCase()}</td>
                  <td>{object.alive ? val : '对象已结束'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {count > 16 && (
        <div className="inline-actions">
          <button className="button button-small" disabled={!at} onClick={() => setPage(at - 1)}>
            上一页槽位
          </button>
          <span>
            {at + 1}/{Math.ceil(count / 16)}
          </span>
          <button
            className="button button-small"
            disabled={(at + 1) * 16 >= count}
            onClick={() => setPage(at + 1)}
          >
            下一页槽位
          </button>
        </div>
      )}
    </>
  );
}
function objectValue(o: AdvancedObject, state: AdvancedState, result: AdvancedResult) {
  const type = result.types.find((t) => t.name === o.typeName)!;
  if (type.kind === 'struct') return '结构体，内存视图可查看字段';
  if (o.cells[0]) return valueText(o.cells[0].value, state);
  return o.zeroInitialized ? (type.kind === 'pointer' ? '空指针' : '0') : '未初始化';
}
export function CustomViews({
  state,
  result,
  mode,
}: {
  state: AdvancedState;
  result: AdvancedResult;
  mode: string;
}) {
  const [selected, setSelected] = useState('');
  const [includeEnded, setIncludeEnded] = useState(false);
  const objects = state.objects.filter((o) => includeEnded || o.alive);
  const object = objects.find((o) => o.id === selected) ?? objects.at(-1);
  if (mode === 'stack')
    return (
      <section aria-label="调用栈视图">
        <p>当前 {state.frames.length} 个活动帧；显示执行完成此步后的状态。</p>
        <ol className="custom-frames">
          {[...state.frames].reverse().map((f) => (
            <li key={f.id}>
              <strong>
                {f.functionName} · {f.id}
              </strong>
              {f.id === state.control.activeFrameId && ' · 当前帧'}
              <ul>
                {state.objects
                  .filter((o) => o.frameId === f.id && o.alive)
                  .map((o) => (
                    <li key={o.id}>
                      {o.name} · {o.typeName} ·{' '}
                      {o.length > 1 ? `${o.length} 槽` : objectValue(o, state, result)}
                    </li>
                  ))}
                {state.scopes
                  .filter((sc) => sc.frameId === f.id)
                  .flatMap((sc) => sc.aliases)
                  .map((a) => (
                    <li key={a.name}>
                      {a.name} · 数组引用 → {a.objectId}（调用者对象）
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ol>
        {!state.frames.length && <p>当前没有活动调用帧。后退可恢复已返回的帧。</p>}
      </section>
    );
  if (mode === 'memory')
    return (
      <section aria-label="内存视图">
        <p>
          教学用虚拟地址，非本机真实地址。存活 {state.objects.filter((o) => o.alive).length}{' '}
          个对象，{state.allocator.liveBytes} B。
        </p>
        <label className="memory-check">
          <input
            type="checkbox"
            checked={includeEnded}
            onChange={(e) => setIncludeEnded(e.target.checked)}
          />
          显示已结束对象
        </label>
        {objects.length ? (
          <>
            <label>
              查看对象{' '}
              <select
                aria-label="查看内存对象"
                value={object?.id ?? ''}
                onChange={(e) => setSelected(e.target.value)}
              >
                {objects.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.id} · {o.alive ? '存活' : '已结束'}
                  </option>
                ))}
              </select>
            </label>
            {object && <Slots key={object.id} object={object} state={state} result={result} />}
          </>
        ) : (
          <p>当前没有存活对象。前进至声明步骤查看。</p>
        )}
      </section>
    );
  return (
    <section aria-label="基础视图">
      <div className="custom-table-scroll">
        <table>
          <thead>
            <tr>
              <th>对象</th>
              <th>类型</th>
              <th>当前值</th>
            </tr>
          </thead>
          <tbody>
            {!state.objects.some((o) => o.alive) && (
              <tr>
                <td colSpan={3}>当前无存活对象，后退可恢复。</td>
              </tr>
            )}
            {state.objects
              .filter((o) => o.alive)
              .slice(-32)
              .map((o) => (
                <tr key={o.id}>
                  <th>
                    {o.name} <small>{o.id}</small>
                  </th>
                  <td>
                    {o.typeName}
                    {o.length > 1 ? `[${o.length}]` : ''}
                  </td>
                  <td>{o.length > 1 ? '可在内存视图逐槽查看' : objectValue(o, state, result)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {state.objects.filter((o) => o.alive).length > 32 && (
        <p>此处显示最近32个存活对象，完整对象可在内存视图选择。</p>
      )}
      <h3>程序输出</h3>
      <pre className="custom-output" data-testid="custom-output">
        {state.output || '（尚无输出）'}
      </pre>
      <p>已读取 {state.control.inputCursor} 项输入。</p>
    </section>
  );
}
