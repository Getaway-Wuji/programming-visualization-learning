import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Marked } from 'marked';
import catalog from '../../content/algorithms/visual-lab/catalog.json';
import teaching from '../../content/algorithms/visual-lab/teaching-1.0.0.json';
import cases from '../../content/algorithms/cpp/teaching-1.0.0.json';
import examples from '../../content/advanced/example-teaching-1.0.0.json';
import exampleCatalog from '../../content/advanced/examples-1.0.0.json';
import solutions from '../../content/advanced/example-solutions-1.0.0.json';
import migration from '../../content/advanced/language-migration-1.0.0.json';
import migrationDepth from '../../content/advanced/language-migration-depth-1.0.0.json';
import cTeaching from '../../content/c/primer6-learning/case-teaching-1.0.0.json';
import cCatalog from '../../content/c/primer6-learning/cases-1.0.0.json';

describe('algorithm teaching is bound to the displayed program and example input', () => {
  it('covers the complete catalog once with exact source and default-input identities', () => {
    expect(teaching.formatVersion).toBe(1);
    expect(teaching.version).toBe('1.0.0');
    expect(teaching.entries.map((entry) => entry.slug).sort()).toEqual(
      catalog.map((entry) => entry.slug).sort(),
    );
    for (const entry of teaching.entries) {
      const spec = catalog.find((row) => row.slug === entry.slug)!;
      expect(entry.title).toBe(spec.title);
      expect(entry.defaults).toEqual(spec.defaults);
      expect(entry.sourceFile).toBe(`content/algorithms/visual-lab/${entry.slug}.cpp`);
      expect(createHash('sha256').update(readFileSync(entry.sourceFile)).digest('hex')).toBe(
        entry.sourceSha256,
      );
      expect(entry.body.every((text) => typeof text === 'string' && text.trim().length > 0)).toBe(
        true,
      );
    }
  });

  it('keeps every walkthrough table well formed and uses no external media or raw HTML', () => {
    const markdown = new Marked();
    for (const entry of [
      ...teaching.entries,
      ...cases.entries,
      ...examples.entries,
      ...cTeaching.entries,
    ]) {
      markdown.walkTokens(markdown.lexer(entry.body.join('\n\n')), (token) => {
        expect(token.type).not.toBe('html');
        expect(token.type).not.toBe('image');
        if (token.type === 'table') {
          for (const row of token.rows) expect(row).toHaveLength(token.header.length);
        }
      });
    }
  });

  it('binds the seven C case explanations to their actual sources and initial input', () => {
    expect(createHash('sha256').update(readFileSync(cTeaching.catalogFile)).digest('hex')).toBe(
      cTeaching.catalogSha256,
    );
    expect(cTeaching.entries.map((entry) => entry.caseId).sort()).toEqual(
      cCatalog.catalogs.map((entry) => entry.subject.id).sort(),
    );
    for (const entry of cTeaching.entries) {
      const actual = cCatalog.catalogs.find((row) => row.subject.id === entry.caseId)!;
      expect(entry.title).toBe(actual.subject.title);
      expect(entry.exampleInput).toEqual(actual.program.exampleInput);
      expect(createHash('sha256').update(actual.program.sourceExample).digest('hex')).toBe(
        entry.sourceSha256,
      );
    }
  });

  it('uses the actual two solution sources and default inputs for all three comparison guides', () => {
    expect(examples.entries.map((entry) => entry.caseId).sort()).toEqual(
      exampleCatalog.examples.map((entry) => entry.id).sort(),
    );
    for (const entry of examples.entries) {
      const spec = exampleCatalog.examples.find((row) => row.id === entry.caseId)!;
      const pair = solutions.examples.find((row) => row.exampleRef.id === entry.caseId)!;
      expect(entry.exampleInput).toEqual(spec.defaults);
      expect(entry.programSources.map((row) => row.file).sort()).toEqual(
        pair.solutions.map((row) => row.sourceFile).sort(),
      );
      for (const source of entry.programSources)
        expect(createHash('sha256').update(readFileSync(source.file)).digest('hex')).toBe(
          source.sha256,
        );
    }
  });

  it('adds outcomes to existing migration topics and corrects the exact Python integer note', () => {
    const baseline = migrationDepth.baseline;
    expect(createHash('sha256').update(readFileSync(baseline.file)).digest('hex')).toBe(
      baseline.sha256,
    );
    for (const id of Object.keys(migrationDepth.outcomes))
      expect(migration.topics.some((topic) => topic.id === id)).toBe(true);
    const correction = migrationDepth.noteCorrection;
    const topic = migration.topics.find((topic) => topic.id === correction.topic)!;
    expect(topic.snippets.python.notes[correction.index]).toBe(correction.before);
  });

  it('binds all independent C++ case walkthroughs to their actual source and default examples', () => {
    const files = [
      'iterative-sorts',
      'recursive-sorts',
      'bucket-sort',
      'classics',
      'stack-queue',
      'linked-nodes',
      'sieve-sequences',
      'kmp',
    ];
    const specs = files.flatMap((name) => {
      const catalog = JSON.parse(readFileSync(`content/algorithms/cpp/${name}-1.0.0.json`, 'utf8'));
      return catalog.cases ?? [catalog.case];
    });
    expect(cases.entries.map((entry) => entry.caseId).sort()).toEqual(
      specs.map((entry) => entry.id).sort(),
    );
    for (const entry of cases.entries) {
      const spec = specs.find((row) => row.id === entry.caseId)!;
      expect(entry.title).toBe(spec.title);
      expect(entry.sourceFile).toBe(spec.sourceFile);
      expect(entry.exampleInput).toEqual(spec.defaultInput ?? spec.defaultDraft ?? spec.defaults);
      expect(createHash('sha256').update(readFileSync(entry.sourceFile)).digest('hex')).toBe(
        entry.sourceSha256,
      );
    }
  });
});
