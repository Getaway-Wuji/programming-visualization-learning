/** 09.1 offline editorial audit. This script grants no publication or exercise pass. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectContentDraft, parseContent } from '../web/src/content/validator.mjs';
import type { CourseContentDraft } from '../web/src/content/validator.mjs';
import type { ContentEntity, ContentPackage, SourceReference } from '../web/src/content/types';

export const workspace = fileURLToPath(new URL('../', import.meta.url));
export const coursePath = resolve(workspace, 'content/c/p0/course-1.0.1.json');
export const collections = [
  'languages',
  'subsets',
  'chapters',
  'lessons',
  'knowledgePoints',
  'inputSpecs',
  'programs',
  'judgeProfiles',
  'exercises',
  'cases',
  'blocks',
  'rewardSources',
] as const;
const revisedCollections = new Set(['chapters', 'lessons', 'exercises', 'cases']);
export const sha256 = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');

export interface EmbeddedExample {
  lessonId: string;
  index: number;
  source: string;
  stdout: string;
  error: string | null;
}
interface TeachingExpectations {
  purpose: 'editorial-test-expectations';
  checks: Omit<EmbeddedExample, 'source'>[];
}
export function embeddedExamples(content: CourseContentDraft): EmbeddedExample[] {
  const expectations = JSON.parse(
    readFileSync(resolve(workspace, 'content/c/p0/teaching-checks.json'), 'utf8'),
  ) as TeachingExpectations;
  assert.equal(expectations.purpose, 'editorial-test-expectations');
  const actual = content.lessons.flatMap((lesson) =>
    [...lesson.teaching.explanation.matchAll(/```c\n([\s\S]*?)\n```/gu)].map((match, index) => ({
      lessonId: lesson.id,
      index,
      source: match[1],
    })),
  );
  assert.equal(actual.length, 11);
  assert.equal(expectations.checks.length, actual.length);
  const keys = (items: { lessonId: string; index: number }[]) =>
    items.map((item) => `${item.lessonId}/${item.index}`);
  assert.deepEqual(
    keys(actual),
    keys(expectations.checks),
    'Every complete embedded example has one explicit oracle.',
  );
  return actual.map((item, index) => {
    assert.match(item.source, /int main\(void\)/u);
    assert.match(item.source, /return 0;/u);
    return { ...expectations.checks[index], ...item };
  });
}
function checkSource(source: SourceReference) {
  assert.ok(source.document.trim() && source.locator.trim());
  assert.ok(!isAbsolute(source.document), 'Public source references use workspace-relative paths.');
  // The 02.1 historical references name files below 项目文档; new editorial sources use root paths.
  const filename = source.document.startsWith('../架构决策/')
    ? resolve(workspace, '项目文档/契约', source.document)
    : resolve(workspace, source.document);
  const rel = relative(workspace, filename);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel));
  assert.ok(existsSync(filename), `Source document must exist: ${source.document}`);
  const anchor = source.locator.split('；')[0];
  assert.ok(
    readFileSync(filename, 'utf8').includes(anchor),
    `Source locator must resolve: ${anchor}`,
  );
}
export function verifyCourseContent(bytes: Uint8Array = readFileSync(coursePath)) {
  const content = inspectContentDraft(bytes);
  assert.equal(content.packageVersion, '1.0.1');
  assert.equal(content.purpose, 'publishable');
  assert.ok(content.packageVersion === '1.0.1');
  const original = parseContent(
    readFileSync(resolve(workspace, '项目文档/契约/02.1-内容样例.json')),
  );
  const bumped: string[] = [];
  const unchanged: string[] = [];
  for (const collection of collections) {
    assert.equal(content[collection].length, original[collection].length);
    for (const entity of content[collection]) {
      const previous: ContentEntity | undefined = original[collection].find(
        (item) => item.id === entity.id,
      );
      assert.ok(previous);
      if (revisedCollections.has(collection)) {
        assert.equal(entity.version, '1.0.1');
        assert.notDeepEqual(entity, previous);
        bumped.push(entity.id);
      } else {
        assert.deepEqual(entity, previous, 'Same ID and version must remain byte-value identical.');
        unchanged.push(entity.id);
      }
    }
  }
  for (const lesson of content.lessons) {
    assert.ok(lesson.teaching.objectives.length >= 2);
    assert.ok(lesson.teaching.commonMistakes.length >= 2);
    assert.ok(lesson.teaching.boundaryNotes.length >= 2);
    assert.ok(lesson.teaching.explanation.length >= 400);
    assert.ok(lesson.knowledgeRefs.length && lesson.teaching.exampleProgramRefs.length);
    checkSource(lesson.teaching.source);
  }
  for (const item of content.cases) checkSource(item.teaching.source);
  for (const program of content.programs) checkSource(program.reference);
  assert.equal(content.exercises.flatMap((item) => item.tests).length, 24);
  const examples = embeddedExamples(content);
  return {
    content,
    summary: {
      evidenceVersion: '09.1-editorial-review@1',
      passed: true,
      packageRef: { id: content.packageId, version: content.packageVersion },
      courseSha256: sha256(bytes),
      counts: Object.fromEntries(collections.map((key) => [key, content[key].length])),
      bumpedEntityCount: bumped.length,
      unchangedEntityCount: unchanged.length,
      bumped,
      unchanged,
      fixedExerciseTests: 24,
      completeEmbeddedExamples: examples.length,
      publicationVerified: false,
      judgeImplemented: false,
      nextPublicationGate:
        '10.1—10.3 complete Blockly asset/generation audit and explicit atomic release decision',
    },
  };
}

/** Fixed public reference outputs are editorial oracles, never product result providers. */
export const referenceStdout: Readonly<Record<string, string>> = {
  'program.c.echo': '7\n',
  'program.c.two-x-plus-three': '17\n',
  'program.c.nonnegative': '0\n',
  'program.c.two-loop-sums': '15\n15\n',
  'program.c.increment-at-index': '1\n',
  'program.c.array-sum': '4\n',
  'program.c.assignment': '5\n',
  'program.c.bubble-sort': '1 2 3\n',
  'program.c.selection-sort': '1 2 3\n',
  'program.c.binary-search-first': '1\n',
};

export function originalContent(): ContentPackage {
  return parseContent(readFileSync(resolve(workspace, '项目文档/契约/02.1-内容样例.json')));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyCourseContent();
  const output = resolve(
    process.argv[2] ?? resolve(workspace, '.artifacts/09.1/editorial-review.json'),
  );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result.summary, null, 2) + '\n');
  process.stdout.write(
    `09.1: 82 entities, 24 fixed tests and 11 complete embedded examples passed offline editorial checks; publication remains blocked.\n${output}\n`,
  );
}
