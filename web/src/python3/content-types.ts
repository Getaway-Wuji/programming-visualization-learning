import type { PythonRef } from '../engine/python3-types';

export interface PythonArticleEntry {
  articleSourceOrder: number;
  sourceNodeId: string;
  platformRef: PythonRef;
  parent: string;
  orderInGroup: number;
  titleDisplay: string;
  file: string;
  bytes: number;
  sha256: string;
}

export interface PythonManifest {
  engine: { buildSha256: string };
  packageRef: PythonRef;
  chunks: PythonArticleEntry[];
  sections: { order: number; sourceNodeId: string; titleOriginal: string | null }[];
  supplementarySidebarLinks: {
    groupOrder: number;
    sourceParent: string;
    title: string;
    url: string;
  }[];
}

export interface PythonCourseNode {
  sourceNodeId: string;
  parent: string;
  tag: string;
  order: number;
  titleDisplay: string;
  sourceRef: string;
  anchor?: string | null;
  platformRef: PythonRef;
  status: 'authored' | 'context-only' | 'reference-only';
  goal?: string;
  body?: string[];
  leaf?: boolean;
  activityId?: string | null;
  exampleId?: string | null;
  questionId?: string | null;
}

export type PythonExample =
  | { id: string; status: 'reading-only'; reason: string; prompt: string; result: string }
  | {
      id: string;
      status: 'runnable-required';
      reason: string;
      source: string;
      sourceSha256: string;
      cases: { name: string; input: string; stdout: string; diagnostic?: string }[];
    };

export type PythonActivity =
  | { id: string; kind: 'optional-self-check'; exampleId: string; prompt: string; reveal: string }
  | {
      id: string;
      kind: 'rust-judge';
      lessonId: string;
      profileRef: PythonRef;
      title: string;
      task: string;
      observation: string;
      hints: string[];
      caseCount: 4;
    };

export interface PythonArticle {
  rootNodeId: string;
  nodes: PythonCourseNode[];
  examples: PythonExample[];
  activities: PythonActivity[];
  references: { title: string; url: string }[];
  diagrams?: { title: string; steps: string[] }[];
  supplementalSources?: { title: string; url: string }[];
}
