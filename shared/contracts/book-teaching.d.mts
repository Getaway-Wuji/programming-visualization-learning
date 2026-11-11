export type BookTeachingLanguage = 'c' | 'cpp' | 'rust2018' | 'mysql';
export interface BookTeachingEntry {
  language: BookTeachingLanguage;
  group: string;
  file: string;
  bytes: number;
  sha256: string;
  baselineFile: string;
  baselineSha256: string;
  nodes: number;
}
export interface BookTeachingChunk {
  formatVersion: 1;
  editorialRef: { id: 'editorial.book-courses'; version: string };
  language: BookTeachingLanguage;
  group: string;
  baselineSha256: string;
  nodes: { id: string; title: string; originalBodySha256: string; body: string[] }[];
}
export const BOOK_TEACHING_LIMITS: Readonly<{ bytes: number; nodes: number; body: number }>;
export const BOOK_TEACHING_LANGUAGES: readonly BookTeachingLanguage[];
export function validateBookTeachingEntry(value: unknown): BookTeachingEntry;
export function parseBookTeaching(value: unknown, entry: BookTeachingEntry, editorialRef: { version: string }): BookTeachingChunk;
