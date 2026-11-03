import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLearning } from '../learning/react';
import { encodeSnapshot } from '../snapshot-export/document';
import type { SnapshotDocument } from '../snapshot-export/types';
import { NOTE_LIMITS } from './types';
import { encodeC6Snapshot, type C6SnapshotDocument } from '../c6-learning/snapshot';

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
  constructor(
    private readonly extra: () => { count: number; bytes: number } = () => ({ count: 0, bytes: 0 }),
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.documents;
  add = (document: SnapshotDocument) => {
    if (this.documents.length + this.extra().count >= NOTE_LIMITS.snapshots)
      throw Error('本次笔记最多8份快照，请先移除部分快照。');
    if (this.documents.some((d) => d.snapshotId === document.snapshotId))
      throw Error('该快照已加入。');
    const copy = structuredClone(document);
    const bytes =
      this.extra().bytes +
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
export class C6SnapshotTray {
  private documents: readonly C6SnapshotDocument[] = [];
  private listeners = new Set<() => void>();
  constructor(private readonly legacy: () => readonly SnapshotDocument[]) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.documents;
  add = (document: C6SnapshotDocument) => {
    if (this.documents.length + this.legacy().length >= NOTE_LIMITS.snapshots)
      throw Error('本次笔记最多8份快照，请先移除部分快照。');
    if (this.documents.some((d) => d.snapshotId === document.snapshotId))
      throw Error('该快照已加入。');
    const copy = structuredClone(document);
    const size =
      encodeC6Snapshot(copy).length +
      this.documents.reduce((n, d) => n + encodeC6Snapshot(d).length, 0) +
      this.legacy().reduce((n, d) => n + encodeSnapshot(d).length, 0);
    if (size > NOTE_LIMITS.snapshotBytes) throw Error('本次快照合计超过8MiB，请先移除部分快照。');
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
const C6Context = createContext<C6SnapshotTray | null>(null);
function Session({ children }: { children: ReactNode }) {
  const [trays] = useState(() => {
    const legacy: SnapshotTray = new SnapshotTray(() => ({
      count: current.getSnapshot().length,
      bytes: current.getSnapshot().reduce((n, d) => n + encodeC6Snapshot(d).length, 0),
    }));
    const current: C6SnapshotTray = new C6SnapshotTray(() => legacy.getSnapshot());
    return { legacy, current };
  });
  return (
    <Context.Provider value={trays.legacy}>
      <C6Context.Provider value={trays.current}>{children}</C6Context.Provider>
    </Context.Provider>
  );
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
export function useC6NoteSnapshots() {
  const tray = useContext(C6Context);
  if (!tray) throw Error('NotesProvider required');
  return { tray, documents: useSyncExternalStore(tray.subscribe, tray.getSnapshot) };
}
