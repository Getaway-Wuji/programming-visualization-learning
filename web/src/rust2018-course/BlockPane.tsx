import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import { withoutWorkspaceAudio } from '../blocks/workspace';
import { rustFromBlocks, rustToolbox } from './blocks';

const toolbox = {
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: '程序', contents: rustToolbox.contents.slice(0, 1) },
    { kind: 'category', name: '语句', contents: rustToolbox.contents.slice(1, 4) },
    { kind: 'category', name: '值与运算', contents: rustToolbox.contents.slice(4) },
  ],
};

export default function BlockPane({
  initial,
  disabled,
  apply,
  onDirty,
}: {
  initial: Blockly.serialization.blocks.State | undefined;
  disabled: boolean;
  apply: (source: string) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const dirty = useRef(onDirty);
  const [error, setError] = useState('');
  useEffect(() => {
    dirty.current = onDirty;
  }, [onDirty]);
  useEffect(() => {
    const view = withoutWorkspaceAudio(() =>
      Blockly.inject(host.current!, {
        toolbox,
        trashcan: true,
        sounds: false,
        media: import.meta.env.BASE_URL + 'blockly/13.4.0/media/',
        renderer: 'zelos',
        zoom: { controls: true, wheel: false, startScale: 0.85, maxScale: 1.3, minScale: 0.3 },
        move: { scrollbars: true, drag: true, wheel: true },
      }),
    );
    workspace.current = view;
    Blockly.Events.disable();
    try {
      if (initial) Blockly.serialization.blocks.append({ ...initial, x: 16, y: 16 }, view);
    } finally {
      Blockly.Events.enable();
    }
    const changes = new Set<string>([
      Blockly.Events.BLOCK_CREATE,
      Blockly.Events.BLOCK_DELETE,
      Blockly.Events.BLOCK_CHANGE,
      Blockly.Events.BLOCK_MOVE,
    ]);
    const change = (event: Blockly.Events.Abstract) => {
      if (event.workspaceId === view.id && !event.isUiEvent && changes.has(event.type))
        dirty.current(true);
    };
    view.addChangeListener(change);
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        Blockly.svgResize(view);
        view.zoomToFit();
        if (view.scale > 0.85) view.setScale(0.85);
        view.scrollCenter();
      });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host.current!);
    fit();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      view.dispose();
      workspace.current = null;
    };
  }, [initial]);
  async function commit() {
    try {
      if (!workspace.current || disabled) return;
      setError('');
      await apply(rustFromBlocks(workspace.current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '积木未应用。');
    }
  }
  return (
    <div className="python-blocks">
      <p>从工具分类添加积木，连接后应用到同一份代码。</p>
      <div ref={host} className="python-block-canvas" aria-label="Rust Blockly 积木画布" />
      <div className="python-actions rust-actions">
        <button disabled={disabled} onClick={() => void commit()}>
          应用积木到代码
        </button>
        <button
          onClick={() => {
            workspace.current?.getToolbox()?.clearSelection();
            workspace.current?.zoomToFit();
          }}
        >
          适合画布
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
