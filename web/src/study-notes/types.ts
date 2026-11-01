import type { Ref } from '../storage/model';
import type { SnapshotDocument } from '../snapshot-export/types';

export const NOTE_LIMITS = Object.freeze({
  snapshots: 8,
  snapshotBytes: 8 * 1024 * 1024,
  entries: 200,
  packageBytes: 12 * 1024 * 1024,
});
export const noteKinds = {
  learning: '学习记录',
  mistake: '错题',
  analysis: '解析',
  snapshot: '快照',
} as const;
export type NoteKind = keyof typeof noteKinds;
export interface NoteEntry {
  id: string;
  kind: NoteKind;
  title: string;
  date: string;
  occurredAt: string;
  timeMeaning: 'event' | 'legacy-summary' | 'capture' | 'related-record';
  chapterIds: string[];
  language: 'c' | 'cpp' | null;
  origin: { packageRef: Ref | null; subjectRef: Ref | null; learningRevision: number | null };
  currentRef: Ref | null;
  href: string | null;
  text: string;
  warnings: string[];
  reference: {
    packageRef: Ref;
    contentSha256: string | null;
    registryRef: Ref | null;
    subjectRef: Ref;
    document: string;
    locator: string;
    programRef: Ref | null;
    source: string | null;
  } | null;
  snapshot: SnapshotDocument | null;
}
export interface NoteFilter {
  chapterId: string;
  from: string;
  to: string;
  types: NoteKind[];
}
export interface NotesPackage {
  formatId: 'urn:c-viz:study-notes:1.0.0';
  formatVersion: '1.0.0';
  createdAt: string;
  lease: string;
  timeZone: string;
  filter: NoteFilter;
  entries: NoteEntry[];
}
