import { useState } from 'react';
import type { MemoryResult, MemoryState } from '../engine/memory-protocol';
import { memoryValueText, slotCount } from '../memory/presentation';
import {
  bindingValues,
  frameBindings,
  sourceLine,
  stackTransition,
  type StackBinding,
} from './presentation';
import './stack.css';

function Bindings({
  values,
  state,
  result,
  title,
}: {
  values: StackBinding[];
  state: MemoryState;
  result: MemoryResult;
  title: string;
}) {
  const [page, setPage] = useState(0);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(values.length / 16) - 1));
  return (
    <section className="stack-binding-group" aria-label={title}>
      <h4>{title}</h4>
      {values.length === 0 ? (
        <p className="muted">当前没有{title}。</p>
      ) : (
        <>
          <div className="stack-table-scroll" tabIndex={0} aria-label={`${title}及当前值`}>
            <table className="stack-table">
              <thead>
                <tr>
                  <th scope="col">名称与作用域</th>
                  <th scope="col">当前值</th>
                  <th scope="col">对象与传递方式</th>
                </tr>
              </thead>
              <tbody>
                {values.slice(currentPage * 16, (currentPage + 1) * 16).map((binding) => (
                  <tr
                    key={`${binding.scopeId}:${binding.name}`}
                    data-testid="stack-binding"
                    data-kind={binding.kind}
                    data-object-id={binding.object.id}
                    data-name={binding.name}
                    data-scope-id={binding.scopeId}
                  >
                    <th scope="row">
                      {binding.name}
                      <small>
                        {binding.scopeId} · {binding.object.typeName}
                      </small>
                    </th>
                    <td>
                      {bindingValues(binding, state, result)}
                      {slotCount(binding.object, result.types) > 16 && (
                        <small>
                          前16槽，共{slotCount(binding.object, result.types)}
                          槽；完整值可在内存视图分页查看。
                        </small>
                      )}
                    </td>
                    <td>
                      {binding.object.id}
                      <small>
                        {binding.kind === 'alias'
                          ? `数组引用 · 原对象属于 ${binding.object.frameId}`
                          : binding.kind === 'parameter'
                            ? '独立值参数'
                            : '当前帧局部对象'}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {values.length > 16 && (
            <div className="inline-actions">
              <button
                className="button button-small"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页绑定
              </button>
              <span>
                第{currentPage + 1}/{Math.ceil(values.length / 16)}页 · 共{values.length}项
              </span>
              <button
                className="button button-small"
                disabled={(currentPage + 1) * 16 >= values.length}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页绑定
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function StackPanel({
  state,
  previous,
  result,
  source,
  cursor,
}: {
  state: MemoryState;
  previous: MemoryState | null;
  result: MemoryResult;
  source: string;
  cursor: number;
}) {
  const [selected, setSelected] = useState('');
  const active = state.frames.at(-1);
  const frame = state.frames.find((frame) => frame.id === selected) ?? active;
  const bindings = frame ? frameBindings(frame, state, result) : [];
  const transition = stackTransition(state, previous);
  const line = frame ? sourceLine(source, frame.callNodeId, result) : null;
  return (
    <section
      className="stack-panel"
      aria-label="调用栈视图"
      data-testid="stack-panel"
      data-cursor={cursor}
      data-active-frame={active?.id ?? ''}
    >
      <div className="stack-current">
        <h3>
          当前活动函数：
          <span data-testid="stack-current-function">{active?.functionName ?? '无活动调用'}</span>
        </h3>
        <p>
          活动帧 <strong data-testid="stack-depth">{state.frames.length}</strong> / 32 ·
          上方为栈顶。每次递归调用都有独立帧。
        </p>
      </div>
      {transition.entered.length > 0 && (
        <p className="stack-transition" data-testid="stack-entered">
          本步进入：
          {transition.entered.map((frame) => `${frame.functionName} · ${frame.id}`).join('、')}
        </p>
      )}
      {transition.returned.length > 0 && (
        <p className="stack-transition" data-testid="stack-returned">
          本步返回：
          {transition.returned.map((frame) => `${frame.functionName} · ${frame.id}`).join('、')}
          。帧已出栈，后退一步可恢复。返回值：
          {state.control.returnValue === null
            ? '无数值返回'
            : memoryValueText(state.control.returnValue, state)}
          。源码高亮仍对应刚完成的返回步骤。
        </p>
      )}
      {!active ? (
        <p className="muted">当前调用栈为空。前进到进入程序的步骤，或后退到结束前查看。</p>
      ) : (
        <div className="stack-layout">
          <ol className="stack-frames" aria-label="活动调用链">
            {[...state.frames].reverse().map((item, index) => (
              <li key={item.id}>
                <button
                  className="stack-frame"
                  aria-pressed={frame?.id === item.id}
                  data-testid="stack-frame"
                  data-frame-id={item.id}
                  data-active={item.id === active.id}
                  onClick={() => setSelected(item.id)}
                >
                  <strong>{item.functionName}</strong>
                  <span>
                    {item.id} · 第{state.frames.length - index}层{' '}
                    {item.id === active.id ? '· 当前' : '· 等待子调用返回'}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {frame && (
            <section className="stack-details" data-testid="stack-details" data-frame-id={frame.id}>
              <h4>
                {frame.functionName} · {frame.id}
              </h4>
              <p className="stack-location">
                {frame.parentFrameId
                  ? `调用者 ${frame.parentFrameId} · 调用位置${line === null ? '不可用' : `第${line}行`}`
                  : '程序入口，无调用者'}{' '}
                · 函数定义第{sourceLine(source, frame.functionNodeId, result)}行
              </p>
              <Bindings
                key={`${frame.id}:parameters`}
                values={bindings.filter((binding) => binding.kind !== 'local')}
                state={state}
                result={result}
                title="参数"
              />
              <Bindings
                key={`${frame.id}:locals`}
                values={bindings.filter((binding) => binding.kind === 'local')}
                state={state}
                result={result}
                title="局部变量"
              />
            </section>
          )}
        </div>
      )}
      <p className="stack-help">
        选择其他帧只查看其参数和局部状态；当前函数、步骤游标和源码高亮保持一致。数组引用使用调用者的原对象，切换视图不重跑。
      </p>
    </section>
  );
}
