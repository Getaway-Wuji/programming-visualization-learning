import { useCallback, useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import {
  BLOCK_LABELS,
  BLOCK_TYPES,
  registerTeachingBlocks,
  teachingToolbox,
  type TeachingBlockKind,
} from './definitions';
import type { BlockProgram } from './model';
import { blockInteractionPlugins, type BlockInteractionState } from './interaction';
import {
  inputBlocks,
  loadBlockProgram,
  loadBlockWorkspaceDraft,
  protocolBlockId,
  readBlockWorkspace,
  saveBlockWorkspaceDraft,
  withoutWorkspaceAudio,
  type BlockWorkspaceDraft,
  type WorkspaceIssue,
} from './workspace';
import './blocks.css';
import './block-interaction.css';

export interface BlockWorkspaceProps {
  value: BlockProgram;
  onChange(
    program: BlockProgram | null,
    issues: WorkspaceIssue[],
    draft: BlockWorkspaceDraft,
  ): void;
  draft?: BlockWorkspaceDraft;
  activeBlockIds?: readonly string[];
  disabled?: boolean;
  allowedKinds?: readonly TeachingBlockKind[];
  selectedBlockId?: string;
  diagnosticFocus?: { blockId: string; request: number };
  onSelect?(blockId: string | null): void;
  onSnapshot?(draft: BlockWorkspaceDraft, logicalMove?: boolean): void;
}
const FIELD_LABELS: Record<string, string> = {
  NAME: '变量名称',
  VALUE: '整数值',
  INITIALIZE: '设置初值',
  OP: '运算符',
  HAS_ELSE: '包含否则分支',
  LENGTH: '数组长度',
  VALUES: '数组初值列表',
  FORMAT: '输出格式',
};
const SLOT_LABELS: Record<string, string> = {
  BODY: '执行语句',
  INITIAL: '初值',
  VALUE: '值',
  OPERAND: '操作数',
  LEFT: '左操作数',
  RIGHT: '右操作数',
  CONDITION: '条件',
  THEN: '成立分支',
  ELSE: '否则分支',
  INIT: 'for 初始化',
  UPDATE: 'for 更新',
  INDEX: '数组下标',
};
function label(block: Blockly.Block): string {
  const kind = block.type.replace(/^cv_/, '') as TeachingBlockKind;
  const details = ['NAME', 'VALUE', 'OP', 'FORMAT']
    .map((name) => block.getFieldValue(name) as unknown)
    .filter((value) => typeof value === 'string' && value !== '')
    .join(' · ');
  return `${BLOCK_LABELS[kind] ?? '不支持的积木'}${details ? ` · ${details}` : ''}`;
}

/** Real Blockly canvas plus an ordinary, keyboard-accessible editor for the same blocks. */
export function BlockWorkspace({
  value,
  onChange,
  draft,
  activeBlockIds = [],
  disabled = false,
  allowedKinds = BLOCK_TYPES,
  selectedBlockId,
  diagnosticFocus,
  onSelect,
  onSnapshot,
}: BlockWorkspaceProps) {
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const lastProgram = useRef(value);
  const initial = useRef({ value, draft });
  const callback = useRef(onChange);
  const allowed = useRef(allowedKinds);
  const selectionCallback = useRef(onSelect);
  const snapshotCallback = useRef(onSnapshot);
  const expectedInputs = useRef(inputBlocks(value));
  const notify = useRef<() => void>(() => {});
  const readSignature = useRef('');
  const acceptedDraft = useRef<BlockWorkspaceDraft | null>(null);
  const projectedSelection = useRef<string | null>(null);
  const [editor, setEditor] = useState<Blockly.WorkspaceSvg | null>(null);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [addKind, setAddKind] = useState<TeachingBlockKind>('integer');
  const [parentId, setParentId] = useState('');
  const [slotName, setSlotName] = useState('');
  const [notice, setNotice] = useState('');
  const [issues, setIssues] = useState<WorkspaceIssue[]>([]);
  const locateBlock = useCallback((blockId: string) => {
    const current = workspace.current;
    const block = current?.getAllBlocks(false).find((item) => protocolBlockId(item.id) === blockId);
    if (!current || !block) return;
    block.select();
    current.centerOnBlock(block.id);
    setSelectedId(block.id);
    host.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    host.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (diagnosticFocus) locateBlock(diagnosticFocus.blockId);
  }, [diagnosticFocus, locateBlock]);
  const [interaction, setInteraction] = useState<BlockInteractionState>('idle');
  useEffect(() => {
    callback.current = onChange;
    selectionCallback.current = onSelect;
    snapshotCallback.current = onSnapshot;
  }, [onChange, onSelect, onSnapshot]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    registerTeachingBlocks();
    let disposed = false;
    const editor = withoutWorkspaceAudio(() =>
      Blockly.inject(element, {
        toolbox: teachingToolbox(allowed.current),
        media: `${import.meta.env.BASE_URL}blockly/13.4.0/media/`,
        renderer: 'zelos',
        trashcan: true,
        scrollbars: true,
        sounds: false,
        move: { drag: true, scrollbars: true, wheel: true },
        zoom: { controls: true, wheel: false, startScale: 0.8, maxScale: 1.5, minScale: 0.35 },
        plugins: blockInteractionPlugins((state) => {
          if (!disposed) setInteraction(state);
        }),
      }),
    );
    workspace.current = editor;
    setEditor(editor);
    let queued = false;
    if (initial.current.draft) loadBlockWorkspaceDraft(editor, initial.current.draft);
    else loadBlockProgram(editor, initial.current.value);
    const initialRead = readBlockWorkspace(editor, expectedInputs.current);
    acceptedDraft.current = saveBlockWorkspaceDraft(editor);
    snapshotCallback.current?.(acceptedDraft.current, false);
    readSignature.current = JSON.stringify(initialRead);
    setIssues(initialRead.issues);
    notify.current = () => {
      if (disposed) return;
      const result = readBlockWorkspace(editor, expectedInputs.current);
      const nextDraft = saveBlockWorkspaceDraft(editor);
      if (
        new TextEncoder().encode(JSON.stringify(nextDraft)).byteLength > 1048576 ||
        editor.getAllBlocks(false).length > 32768 ||
        result.issues.some((issue) => issue.code === 'BLOCK_LIMIT')
      ) {
        if (acceptedDraft.current) loadBlockWorkspaceDraft(editor, acceptedDraft.current);
        setNotice('本次编辑超过工作区容量，已保留编辑前的完整草稿。请减少积木数量或嵌套。');
        setRevision((previous) => previous + 1);
        return;
      }
      const layoutChanged = JSON.stringify(nextDraft) !== JSON.stringify(acceptedDraft.current);
      acceptedDraft.current = nextDraft;
      const nextSignature = JSON.stringify(result);
      setRevision((previous) => previous + 1);
      if (nextSignature === readSignature.current) {
        if (layoutChanged) snapshotCallback.current?.(nextDraft, true);
        return;
      }
      readSignature.current = nextSignature;
      if (result.program) lastProgram.current = result.program;
      setIssues(result.issues);
      callback.current(result.program, result.issues, nextDraft);
    };
    const listener = (event: Blockly.Events.Abstract) => {
      // Canvas blur must not discard the keyboard editor's existing target.
      // Explicit empty selection and deletion still clear it in their own handlers.
      if (
        !disposed &&
        event.type === Blockly.Events.SELECTED &&
        'newElementId' in event &&
        typeof event.newElementId === 'string' &&
        editor.getBlockById(event.newElementId)
      )
        setSelectedId(event.newElementId);
      const dragEnded = 'isStart' in event && event.isStart === false;
      if (
        (event.isUiEvent && !dragEnded) ||
        event.type === Blockly.Events.FINISHED_LOADING ||
        disposed ||
        queued
      )
        return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!disposed && !editor.isDragging()) notify.current();
      });
    };
    editor.addChangeListener(listener);
    const observer = new ResizeObserver(() => Blockly.svgResize(editor));
    observer.observe(element);
    setRevision((previous) => previous + 1);
    setSelectedId(editor.getTopBlocks(true)[0]?.id ?? '');
    return () => {
      disposed = true;
      observer.disconnect();
      editor.removeChangeListener(listener);
      editor.dispose();
      workspace.current = null;
      notify.current = () => {};
    };
  }, []);
  useEffect(() => {
    allowed.current = allowedKinds;
    if (editor) editor.updateToolbox(teachingToolbox(allowedKinds));
  }, [editor, allowedKinds]);
  useEffect(() => {
    if (!editor) return;
    let signature = '';
    let frame = 0;
    const apply = () => {
      const styles = getComputedStyle(document.documentElement);
      const get = (name: string, fallback: string) =>
        styles.getPropertyValue(name).trim() || fallback;
      const values = [
        get('--p05-surface', '#FFFFFF'),
        get('--p05-raised', '#F3F5F7'),
        get('--p05-text', '#17212B'),
        get('--p05-control', '#7C8797'),
        get('--p05-accent', '#1D5FBF'),
      ];
      const next = values.join('|');
      if (next === signature) return;
      signature = next;
      editor.setTheme(
        // Keep the already reviewed renderer CSS class. Component colours are
        // applied by Blockly's theme manager; a new theme name would inject a
        // third inline stylesheet and break the strict two-hash CSP.
        Blockly.Theme.defineTheme('classic', {
          name: 'classic',
          base: Blockly.Themes.Classic,
          componentStyles: {
            workspaceBackgroundColour: values[0],
            toolboxBackgroundColour: values[1],
            toolboxForegroundColour: values[2],
            flyoutBackgroundColour: values[0],
            flyoutForegroundColour: values[2],
            flyoutOpacity: 1,
            scrollbarColour: values[3],
            scrollbarOpacity: 0.6,
            insertionMarkerColour: values[4],
            insertionMarkerOpacity: 0.6,
            cursorColour: values[4],
          },
        }),
      );
    };
    apply();
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme', 'data-appearance'],
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [editor]);
  useEffect(() => {
    if (value === lastProgram.current || !workspace.current) return;
    if (JSON.stringify(value) === JSON.stringify(lastProgram.current)) {
      lastProgram.current = value;
      return;
    }
    expectedInputs.current = inputBlocks(value);
    loadBlockProgram(workspace.current, value);
    acceptedDraft.current = saveBlockWorkspaceDraft(workspace.current);
    readSignature.current = JSON.stringify(
      readBlockWorkspace(workspace.current, expectedInputs.current),
    );
    lastProgram.current = value;
    setIssues([]);
    setRevision((previous) => previous + 1);
  }, [value]);
  useEffect(() => {
    const editor = workspace.current;
    if (!editor) return;
    for (const block of editor.getAllBlocks(false))
      block.setHighlighted(activeBlockIds.includes(protocolBlockId(block.id)));
  }, [activeBlockIds, revision]);
  useEffect(() => {
    if (!selectedBlockId || !editor) return;
    const selected = editor
      .getAllBlocks(false)
      .find((block) => protocolBlockId(block.id) === selectedBlockId);
    // React's previous projection must not override a new native/keyboard
    // selection while the document callback is still publishing that choice.
    if (selected && Blockly.common.getSelected()?.id !== selected.id) {
      projectedSelection.current = selected.id;
      selected.select();
    }
  }, [editor, selectedBlockId]);
  useEffect(() => {
    if (projectedSelection.current === selectedId) {
      projectedSelection.current = null;
      return;
    }
    selectionCallback.current?.(selectedId ? protocolBlockId(selectedId) : null);
  }, [selectedId]);

  const blocks = editor?.getAllBlocks(true) ?? [];
  const selected = editor?.getBlockById(selectedId) ?? null;
  const parent = editor?.getBlockById(parentId) ?? null;
  const fields =
    selected?.inputList
      .flatMap((input) => input.fieldRow)
      .filter((field) => field.name && field.EDITABLE && field.isVisible()) ?? [];
  const slots =
    parent?.inputList
      .filter((input) => input.connection)
      .map((input) => ({
        name: input.name,
        label:
          SLOT_LABELS[input.name] ??
          (/^ARG/.test(input.name) ? `输出整数 ${Number(input.name.slice(3)) + 1}` : input.name),
        occupied: !!input.connection?.targetBlock(),
      })) ?? [];
  if (parent?.nextConnection)
    slots.push({
      name: '$next',
      label: '下一条语句',
      occupied: !!parent.nextConnection.targetBlock(),
    });

  const changeField = (fieldName: string, text: string) => {
    if (!selected || disabled || !selected.isEditable()) return;
    selected.setFieldValue(text, fieldName);
    notify.current();
  };
  const add = () => {
    if (!editor || disabled) return;
    if (!allowed.current.includes(addKind)) {
      setNotice('该积木尚未解锁，请在“积木权限”中查看学习入口。');
      return;
    }
    if (addKind === 'main' && blocks.some((block) => block.type === 'cv_main')) {
      setNotice('工作区只能有一个主程序。');
      return;
    }
    const block = editor.newBlock(`cv_${addKind}`);
    block.initSvg();
    block.render();
    block.moveBy(40 + (blocks.length % 5) * 24, 40 + (blocks.length % 7) * 24);
    block.select();
    setSelectedId(block.id);
    setNotice('已添加积木，请连接到合适的插槽。');
    notify.current();
  };
  const connect = () => {
    if (!editor || !selected || !parent || disabled) return;
    const target =
      slotName === '$next' ? parent.nextConnection : parent.getInput(slotName)?.connection;
    const source = selected.outputConnection ?? selected.previousConnection;
    if (!target || !source) {
      setNotice('请选择一个连接位置；表达式与语句使用不同插槽。');
      return;
    }
    if (target.targetConnection) {
      setNotice('该位置已有积木，请先选择原积木并断开，再连接新积木。');
      return;
    }
    if (!editor.connectionChecker.canConnect(target, source, false)) {
      setNotice('不能这样连接：请检查语句、整数表达式和 for 专用槽的类型，以及是否形成循环连接。');
      return;
    }
    target.connect(source);
    setNotice('积木已连接。');
    notify.current();
  };
  const undo = (redo: boolean) => {
    if (!editor || disabled || editor.isDragging()) return;
    editor.undo(redo);
    notify.current();
  };

  return (
    <section className="block-workspace" aria-label="积木工作区">
      <p className="block-help">
        从左侧分类拖入积木，右侧同步显示生成的 C 代码。键盘操作可展开下方“逐块编辑与键盘连接”。
      </p>
      <div className="block-workspace-tools">
        <div role="group" aria-label="积木编辑操作" className="block-history-actions">
          <button
            type="button"
            className="button button-small"
            disabled={disabled || interaction !== 'idle' || !editor?.getUndoStack().length}
            onClick={() => undo(false)}
            title="撤销上一次编辑（Ctrl+Z）"
          >
            撤销
          </button>
          <button
            type="button"
            className="button button-small"
            disabled={disabled || interaction !== 'idle' || !editor?.getRedoStack().length}
            onClick={() => undo(true)}
            title="重做上一次编辑（Ctrl+Shift+Z）"
          >
            重做
          </button>
        </div>
        <p className="block-drag-feedback" role="status" aria-live="polite" aria-atomic="true">
          {interaction === 'preview'
            ? '已找到连接位置，松开即可拼接。'
            : interaction === 'edge'
              ? '正在移动画布，移回中间即可停止。'
              : interaction === 'dragging'
                ? '靠近匹配插槽，出现连接轮廓后松开。'
                : '拖动到匹配的插槽即可拼接。'}
        </p>
      </div>
      <div
        className={`block-canvas${disabled ? ' block-canvas-disabled' : ''}`}
        inert={disabled}
        ref={host}
        tabIndex={-1}
        aria-label="可拖拽积木画布"
      />
      <details className="block-accessible" data-testid="block-keyboard-editor">
        <summary>逐块编辑与键盘连接</summary>
        <div className="block-edit-grid">
          <label>
            积木列表
            <select
              aria-label="积木列表"
              value={selected ? selectedId : ''}
              disabled={disabled}
              onChange={(event) => {
                setSelectedId(event.target.value);
                editor?.getBlockById(event.target.value)?.select();
                setNotice('');
              }}
            >
              <option value="">请选择积木</option>
              {blocks.map((block, index) => (
                <option key={block.id} value={block.id}>
                  {index + 1}. {label(block)}
                </option>
              ))}
            </select>
          </label>
          <label>
            添加类型
            <select
              aria-label="添加积木类型"
              value={addKind}
              disabled={disabled}
              onChange={(event) => setAddKind(event.target.value as TeachingBlockKind)}
            >
              {BLOCK_TYPES.map((kind) => (
                <option key={kind} value={kind} disabled={!allowedKinds.includes(kind)}>
                  {BLOCK_LABELS[kind]}
                  {allowedKinds.includes(kind) ? '' : '（未解锁）'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={add}
            disabled={disabled || !allowedKinds.includes(addKind)}
          >
            添加积木
          </button>
        </div>
        {selected && (
          <fieldset disabled={disabled} className="block-fields">
            <legend>编辑所选：{label(selected)}</legend>
            {!selected.isEditable() && (
              <p>课程输入来源：名称、长度和值由测试组绑定。删除后不能提交，请保留该积木。</p>
            )}
            {fields.map((field) => {
              const name = field.name!;
              const fieldLabel = FIELD_LABELS[name] ?? name;
              const current = String(field.getValue());
              if (field instanceof Blockly.FieldDropdown)
                return (
                  <label key={name}>
                    {fieldLabel}
                    <select
                      aria-label={fieldLabel}
                      value={current}
                      disabled={!selected.isEditable()}
                      onChange={(event) => changeField(name, event.target.value)}
                    >
                      {field.getOptions(false).map((option) => (
                        <option key={option[1]} value={option[1]}>
                          {typeof option[0] === 'string' ? option[0] : option[1]}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              if (field instanceof Blockly.FieldCheckbox)
                return (
                  <label key={name}>
                    <input
                      type="checkbox"
                      aria-label={fieldLabel}
                      checked={current === 'TRUE'}
                      disabled={!selected.isEditable()}
                      onChange={(event) =>
                        changeField(name, event.target.checked ? 'TRUE' : 'FALSE')
                      }
                    />
                    {fieldLabel}
                  </label>
                );
              return (
                <label key={name}>
                  {fieldLabel}
                  {name === 'FORMAT' || name === 'VALUES' ? (
                    <textarea
                      aria-label={fieldLabel}
                      rows={2}
                      value={current}
                      disabled={!selected.isEditable()}
                      onChange={(event) => changeField(name, event.target.value)}
                    />
                  ) : (
                    <input
                      aria-label={fieldLabel}
                      value={current}
                      disabled={!selected.isEditable()}
                      onChange={(event) => changeField(name, event.target.value)}
                    />
                  )}
                </label>
              );
            })}
            <div className="block-actions">
              <button
                type="button"
                disabled={!selected.getParent()}
                onClick={() => {
                  selected.unplug(false);
                  setNotice('积木已断开；请重新连接或删除。');
                  notify.current();
                }}
              >
                断开选中积木
              </button>
              <button
                type="button"
                onClick={() => {
                  selected.dispose(true);
                  setSelectedId('');
                  setNotice('已删除所选积木及其内部积木。');
                  notify.current();
                }}
              >
                删除选中积木
              </button>
            </div>
          </fieldset>
        )}
        <fieldset disabled={disabled || !selected} className="block-connect">
          <legend>连接所选积木</legend>
          <label>
            连接到积木
            <select
              aria-label="连接到积木"
              value={parent ? parentId : ''}
              onChange={(event) => {
                setParentId(event.target.value);
                setSlotName('');
              }}
            >
              <option value="">请选择目标积木</option>
              {blocks
                .filter((block) => block.id !== selectedId)
                .map((block, index) => (
                  <option key={block.id} value={block.id}>
                    {index + 1}. {label(block)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            连接位置
            <select
              aria-label="连接位置"
              value={slotName}
              onChange={(event) => setSlotName(event.target.value)}
            >
              <option value="">请选择插槽</option>
              {slots.map((slot) => (
                <option key={slot.name} value={slot.name}>
                  {slot.label}
                  {slot.occupied ? '（已有积木）' : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={!parent || !slotName} onClick={connect}>
            连接选中积木
          </button>
        </fieldset>
        <p className="block-notice" role="status">
          {notice}
        </p>
      </details>
      {issues.length > 0 && (
        <div className="block-errors" role="alert">
          <p>当前积木尚不能生成程序：</p>
          <ul>
            {issues.map((issue, index) => (
              <li key={`${issue.blockId}-${issue.code}-${index}`}>
                {issue.message} <code>{issue.code}</code>
                {issue.blockId && (
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => locateBlock(issue.blockId!)}
                  >
                    定位积木 {issue.blockId}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
