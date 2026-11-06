import type { JavaArticle, JavaManifest } from '../../web/src/java/content-types';
import type { JavaRef } from '../../web/src/engine/java-types';

export const javaCourseBudgets: Readonly<
  Record<'manifest' | 'chunk' | 'total' | 'source', number>
>;
export function parseJava3CourseManifest(
  bytes: Uint8Array,
  release: {
    packageRef: JavaRef;
    manifestFile: string;
    manifestBytes: number;
    manifestSha256: string;
  },
): Promise<JavaManifest>;
export function parseJava3CourseChunk(
  bytes: Uint8Array,
  manifest: JavaManifest,
  articleOrder: number,
): Promise<JavaArticle>;
