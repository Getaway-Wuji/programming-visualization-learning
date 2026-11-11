import type { PythonArticle, PythonManifest } from '../../web/src/python3/content-types';
import type { PythonRef } from '../../web/src/engine/python3-types';

export const python3CourseBudgets: Readonly<
  Record<'manifest' | 'chunk' | 'total' | 'source', number>
>;
export function parsePython3CourseManifest(
  bytes: Uint8Array,
  release: {
    packageRef: PythonRef;
    manifestFile: string;
    manifestBytes: number;
    manifestSha256: string;
    editorialRef?: { id: string; version: string };
  },
): Promise<PythonManifest>;
export function parsePython3CourseChunk(
  bytes: Uint8Array,
  manifest: PythonManifest,
  articleOrder: number,
): Promise<PythonArticle>;
