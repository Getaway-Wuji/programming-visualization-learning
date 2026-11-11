import type { JavaRef } from '../engine/java-types';

export interface JavaArticleEntry {
  editorialRef?: { id: string; version: string };
  articleSourceOrder: number;
  sourceNodeId: string;
  platformRef: JavaRef;
  parent: string;
  orderInGroup: number;
  titleDisplay: string;
  file: string;
  bytes: number;
  sha256: string;
}

export interface JavaManifest {
  editorialRef?: { id: string; version: string };
  media?: { file: string; bytes: number; sha256: string }[];
  teachingSources?: {
    kind: 'user-supplied-pdf';
    title: string;
    sha256: string;
    physicalPageRanges: [number, number][];
    articleOrders: number[];
  }[];
  engine: { buildSha256: string };
  packageRef: JavaRef;
  chunks: JavaArticleEntry[];
  sections: { order: number; sourceNodeId: string; titleOriginal: string | null }[];
  supplementarySidebarLinks: {
    groupOrder: number;
    sourceParent: string;
    title: string;
    url: string;
  }[];
}

export interface JavaCourseNode {
  sourceNodeId: string;
  parent: string;
  tag: string;
  order: number;
  titleDisplay: string;
  sourceRef: string;
  anchor?: string | null;
  platformRef: JavaRef;
  status: 'authored' | 'context-only' | 'reference-only';
  goal?: string;
  body?: string[];
  leaf?: boolean;
  activityId?: string | null;
  exampleId?: string | null;
  questionId?: string | null;
}

export type JavaExample =
  | { id: string; status: 'reading-only'; reason: string; prompt: string; result: string }
  | {
      id: string;
      status: 'runnable-required';
      reason: string;
      source: string;
      sourceSha256: string;
      cases: { name: string; input: string; stdout: string; diagnostic?: string }[];
    };

export type JavaActivity =
  | { id: string; kind: 'optional-self-check'; exampleId: string; prompt: string; reveal: string }
  | {
      id: string;
      kind: 'rust-judge';
      lessonId: string;
      profileRef: JavaRef;
      title: string;
      task: string;
      observation: string;
      hints: string[];
      caseCount: 4;
    };

export interface JavaArticle {
  editorialRef?: { id: string; version: string };
  rootNodeId: string;
  nodes: JavaCourseNode[];
  examples: JavaExample[];
  activities: JavaActivity[];
  references: { title: string; url: string }[];
  diagrams?: { title: string; steps: string[] }[];
  supplementalSources?: { title: string; url: string }[];
}
