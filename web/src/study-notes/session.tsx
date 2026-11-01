import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLearning } from '../learning/react';
import { encodeSnapshot } from '../snapshot-export/document';
import type { SnapshotDocument } from '../snapshot-export/types';
import { NOTE_LIMITS } from './types';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export class SnapshotTray {
  private documents: readonly SnapshotDocument[] = [];
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.documents;
  add = (document: SnapshotDocument) => {
    if (this.documents.length >= NOTE_LIMITS.snapshots)
      throw Error('本次笔记最多8份快照，请先移除部分快照。');
    if (this.documents.some((d) => d.snapshotId === document.snapshotId))
      throw Error('该快照已加入。');
    const copy = structuredClone(document);
    const bytes =
      encodeSnapshot(copy).byteLength +
      this.documents.reduce((sum, d) => sum + encodeSnapshot(d).byteLength, 0);
    if (bytes > NOTE_LIMITS.snapshotBytes) throw Error('本次快照合计超过8MiB，请先移除部分快照。');
    this.documents = [...this.documents, freeze(copy)];
    this.listeners.forEach((l) => l());
  };
  remove = (id: string) => {
    this.documents = this.documents.filter((d) => d.snapshotId !== id);
    this.listeners.forEach((l) => l());
  };
  clear = () => {
    this.documents = [];
    this.listeners.forEach((l) => l());
  };
}
const Context = createContext<SnapshotTray | null>(null);
function Session({ children }: { children: ReactNode }) {
  const [tray] = useState(() => new SnapshotTray());
  return <Context.Provider value={tray}>{children}</Context.Provider>;
}
export function NotesProvider({ children }: { children: ReactNode }) {
  const { state } = useLearning();
  return (
    <Session key={`${state.sessionEpoch}:${state.snapshot?.meta.generation ?? 'loading'}`}>
      {children}
    </Session>
  );
}
export function useNoteSnapshots() {
  const tray = useContext(Context);
  if (!tray) throw Error('NotesProvider required');
  return { tray, documents: useSyncExternalStore(tray.subscribe, tray.getSnapshot) };
}
