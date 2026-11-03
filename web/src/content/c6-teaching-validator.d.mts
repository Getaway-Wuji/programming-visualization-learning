import type {
  C6TeachingChunk,
  C6TeachingChunkId,
  C6TeachingManifest,
  C6TeachingSource,
} from './c6-teaching-types';

export const C6_TEACHING_LIMITS: Readonly<{
  manifest: 262144;
  chunk: 1048576;
  package: 20971520;
  source: 32768;
}>;
export class C6TeachingContentError extends Error {
  readonly code: string;
  constructor(code: string);
}
export function c6TeachingSha256(bytes: Uint8Array): Promise<string>;
export function validateC6TeachingManifest(value: unknown): C6TeachingManifest;
export function validateC6TeachingChunk(
  value: unknown,
  manifest: C6TeachingManifest,
  id: C6TeachingChunkId,
): Promise<C6TeachingChunk>;
export function parseC6TeachingManifest(
  bytes: Uint8Array,
  expectedSha256: string,
): Promise<C6TeachingManifest>;
export function parseC6TeachingChunk(
  bytes: Uint8Array,
  manifest: C6TeachingManifest,
  id: C6TeachingChunkId,
): Promise<C6TeachingChunk>;
export function validateCompleteC6Teaching(
  manifest: C6TeachingManifest,
  chunks: readonly C6TeachingChunk[],
): Promise<
  Readonly<{
    nodes: 650;
    lessons: 404;
    teachingBodies: 505;
    teachingProgramSlots: 576;
    teachingPrograms: 386;
    activities: 389;
    examples: 232;
    exercises: 44;
    knowledge: 421;
    referenceNodes: 111;
  }>
>;
export function parseC6TeachingSource(bytes: Uint8Array): C6TeachingSource;
