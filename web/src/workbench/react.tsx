import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useLearning } from '../learning/react';
import { defaultAppearance, type Appearance } from '../storage/model';

type Layout = Appearance['layout'];
export type WorkbenchKind = keyof Layout['splitRatios'];
type Intent = Partial<Omit<Layout, 'splitRatios'>> & {
  splitRatios?: Partial<Layout['splitRatios']>;
};
export type LayoutGuard = { generation: string; epoch: number; revision: number };
type Draft = LayoutGuard & { intent: Intent };
function merge(layout: Layout, intent: Intent): Layout {
  return { ...layout, ...intent, splitRatios: { ...layout.splitRatios, ...intent.splitRatios } };
}
function useLayoutState() {
  const { state, service } = useLearning();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const active =
    draft?.generation === state.snapshot?.meta.generation && draft?.epoch === state.sessionEpoch
      ? draft
      : null;
  const layout = merge(
    state.snapshot?.appearance.layout ?? defaultAppearance().layout,
    active?.intent ?? {},
  );
  const disabled =
    saving ||
    !state.snapshot ||
    state.status === 'loading' ||
    state.status === 'readonly' ||
    state.appearanceReadOnly ||
    state.recovery?.writable === false;

  async function commit(value: Draft) {
    const current = service.getState();
    if (
      !current.snapshot ||
      current.sessionEpoch !== value.epoch ||
      current.snapshot.meta.generation !== value.generation
    )
      return;
    pending.current = true;
    setSaving(true);
    try {
      // Apply only layout intent to the saved row. A theme preview is never submitted here.
      await service.saveAppearance(
        {
          ...current.snapshot.appearance,
          layout: merge(current.snapshot.appearance.layout, value.intent),
        },
        value.revision,
      );
      const result = service.getState();
      if (
        result.sessionEpoch !== value.epoch ||
        result.snapshot?.meta.generation !== value.generation
      )
        return;
      if (result.status === 'ready' && result.lastSaved) {
        setDraft(null);
        setFailed(false);
      } else setFailed(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  function capture(): LayoutGuard | undefined {
    const current = service.getState();
    return current.snapshot
      ? {
          generation: current.snapshot.meta.generation,
          epoch: current.sessionEpoch,
          revision: current.snapshot.meta.revision,
        }
      : undefined;
  }
  async function change(intent: Intent, guard = capture()) {
    if (disabled || pending.current || !state.snapshot) return;
    if (
      !guard ||
      guard.generation !== state.snapshot.meta.generation ||
      guard.epoch !== state.sessionEpoch
    )
      return;
    const value: Draft = {
      ...guard,
      intent: {
        ...active?.intent,
        ...intent,
        splitRatios: { ...active?.intent.splitRatios, ...intent.splitRatios },
      },
    };
    setDraft(value);
    // A failed save remains temporary until an explicit retry or discard.
    if (!active || !failed) await commit(value);
  }
  async function retry() {
    if (!active || pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      await service.refresh();
    } finally {
      pending.current = false;
      setSaving(false);
    }
    const current = capture();
    if (current?.epoch === active.epoch && current.generation === active.generation)
      await commit({ ...active, revision: current.revision });
  }
  function discard() {
    if (pending.current) return;
    setDraft(null);
    setFailed(false);
    void service.refresh();
  }
  return { layout, change, capture, disabled, saving, failed: !!active && failed, retry, discard };
}
const LayoutContext = createContext<ReturnType<typeof useLayoutState> | null>(null);
export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const value = useLayoutState();
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}
export function useWorkbench() {
  const value = useContext(LayoutContext);
  if (!value) throw new Error('WorkbenchProvider is required.');
  return value;
}
