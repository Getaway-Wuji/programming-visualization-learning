import type { ContentDiagnostic, ContentPackage } from './types';
export declare const MAX_CONTENT_BYTES: number;
export declare class ContentError extends Error {
  readonly code: string;
  readonly diagnostics: readonly ContentDiagnostic[];
  constructor(code: string, diagnostics?: readonly ContentDiagnostic[]);
}
export declare function parseContent(bytes: Uint8Array): ContentPackage;
/** An unpublished editorial target; never accepted by the production repository. */
export interface CourseContentDraft extends Omit<ContentPackage, 'packageVersion' | 'purpose'> {
  readonly packageVersion: '1.0.1';
  readonly purpose: 'publishable';
}
/** Offline schema/config review; never authorizes publication. */
export declare function inspectContentDraft(bytes: Uint8Array): ContentPackage | CourseContentDraft;
