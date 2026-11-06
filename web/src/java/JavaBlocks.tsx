import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import { withoutWorkspaceAudio } from '../blocks/workspace';
import { javaFromBlocks, javaToolbox } from './blocks';

export function JavaBlocks({
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
        toolbox: javaToolbox,
        trashcan: true,
        sounds: false,
        media: import.meta.env.BASE_URL + 'blockly/13.4.0/media/',
        renderer: 'zelos',
        zoom: { controls: true, wheel: false, startScale: 0.85 },
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
    const observer = new ResizeObserver(() => Blockly.svgResize(view));
    observer.observe(host.current!);
    return () => {
      observer.disconnect();
      view.dispose();
      workspace.current = null;
    };
  }, [initial]);
  async function commit() {
    try {
      if (!workspace.current || disabled) return;
      setError('');
      await apply(javaFromBlocks(workspace.current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '积木未应用。');
    }
  }
  return (
    <div className="python-blocks">
      <p>拖动积木连接程序，确认后应用到同一份代码。</p>
      <div ref={host} className="python-block-canvas" aria-label="Java Blockly 积木画布" />
      <button disabled={disabled} onClick={() => void commit()}>
        应用积木到代码
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
