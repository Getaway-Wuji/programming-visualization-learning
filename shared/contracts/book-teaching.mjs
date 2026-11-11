import { compareTeachingVersions, isTeachingEditorial } from './teaching-editorial.mjs';

export const BOOK_TEACHING_LIMITS = Object.freeze({ bytes: 1048576, nodes: 200, body: 65536 });
export const BOOK_TEACHING_LANGUAGES = Object.freeze(['c', 'cpp', 'rust2018', 'mysql']);
const fail = () => { throw new Error('E_BOOK_TEACHING'); };
const keys = (value, names) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...names].sort().join(',')) fail();
};
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const groupPattern = /^(?:ch(?:0[1-9]|1[0-7]|A|B)|unit-(?:0\d|1\d|2[0-5]))$/u;
export function validateBookTeachingEntry(value) {
  keys(value, ['language', 'group', 'file', 'bytes', 'sha256', 'baselineFile', 'baselineSha256', 'nodes']);
  if (!BOOK_TEACHING_LANGUAGES.includes(value.language) || !groupPattern.test(value.group) ||
      !/^(?:c|cpp|rust2018|mysql)-(?:ch(?:\d{2}|A|B)|unit-\d{2})-\d{1,3}\.\d{1,3}\.\d{1,3}\.json$/u.test(value.file) ||
      !value.file.startsWith(value.language + '-' + value.group + '-') ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > BOOK_TEACHING_LIMITS.bytes ||
      !hash(value.sha256) || !hash(value.baselineSha256) ||
      !Number.isSafeInteger(value.nodes) || value.nodes < 1 || value.nodes > BOOK_TEACHING_LIMITS.nodes ||
      !/^content\/(?:c\/primer6-teaching\/ch(?:\d{2}|A|B)-2\.0\.0|(?:cpp|rust2018|mysql)\/course\/unit-\d{2}-1\.0\.0)\.json$/u.test(value.baselineFile)) fail();
  const expected = value.language === 'c'
    ? `content/c/primer6-teaching/${value.group}-2.0.0.json`
    : `content/${value.language}/course/${value.group}-1.0.0.json`;
  if (value.baselineFile !== expected) fail();
  return value;
}
export function parseBookTeaching(value, entry, editorialRef) {
  validateBookTeachingEntry(entry);
  keys(value, ['formatVersion', 'editorialRef', 'language', 'group', 'baselineSha256', 'nodes']);
  if (value.formatVersion !== 1 || !isTeachingEditorial(value.editorialRef, 'editorial.book-courses') ||
      compareTeachingVersions(value.editorialRef.version, editorialRef.version) > 0 ||
      entry.file !== `${value.language}-${value.group}-${value.editorialRef.version}.json` || value.language !== entry.language ||
      value.group !== entry.group || value.baselineSha256 !== entry.baselineSha256 ||
      !Array.isArray(value.nodes) || value.nodes.length !== entry.nodes) fail();
  const ids = new Set();
  for (const node of value.nodes) {
    keys(node, ['id', 'title', 'originalBodySha256', 'body']);
    if (typeof node.id !== 'string' || node.id.length > 200 || !/^(?:[a-z][a-z0-9.-]+|c6\.app[AB]|c6\.s[AB]\.\d+(?:\.\d+)*)$/u.test(node.id) ||
        ids.has(node.id) || typeof node.title !== 'string' || !node.title.trim() || node.title.length > 500 ||
        !hash(node.originalBodySha256) || !Array.isArray(node.body) || node.body.length < 1 || node.body.length > 100 ||
        node.body.some(text => typeof text !== 'string' || !text.trim() || text.includes('\ufffd') ||
          [...text].some(character => { const code = character.charCodeAt(0); return code < 32 && ![9, 10, 13].includes(code) || code === 127; })) ||
        node.body.join('\n\n').length > BOOK_TEACHING_LIMITS.body) fail();
    ids.add(node.id);
  }
  return value;
}
