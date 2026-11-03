import type { C6CourseChunk, C6CourseManifest } from './c6-course-types';

export type C6ContentErrorCode =
  | 'C6_CONTENT_INVALID'
  | 'C6_CONTENT_REFERENCE'
  | 'C6_CONTENT_SIZE'
  | 'C6_CONTENT_HASH'
  | 'C6_CONTENT_FORBIDDEN'
  | 'C6_CONTENT_CANCELLED'
  | 'C6_CONTENT_TIMEOUT'
  | 'C6_CONTENT_LOAD_FAILED'
  | 'C6_CONTENT_NOT_LOADED';
export class C6ContentError extends Error {
  readonly code: C6ContentErrorCode;
  constructor(code: C6ContentErrorCode);
}
export const C6_CONTENT_LIMITS: Readonly<{
  manifest: 262144;
  chunk: 1048576;
  package: 20971520;
  source: 32768;
}>;
export function c6ContentSha256(bytes: Uint8Array): Promise<string>;
export function validateC6Manifest(value: unknown): C6CourseManifest;
export function validateC6Chunk(
  value: unknown,
  manifest: C6CourseManifest,
  id: string,
): Promise<C6CourseChunk>;
export function parseC6Manifest(
  bytes: Uint8Array,
  expectedSha256: string,
): Promise<C6CourseManifest>;
export function parseC6Chunk(
  bytes: Uint8Array,
  manifest: C6CourseManifest,
  id: string,
): Promise<C6CourseChunk>;
export function validateCompleteC6Course(
  manifest: C6CourseManifest,
  chunks: readonly C6CourseChunk[],
): Promise<
  Readonly<{
    nodes: 650;
    lessons: 404;
    activities: 793;
    examples: 232;
    exercises: 44;
    knowledge: 421;
    referenceOnlyB: true;
  }>
>;
