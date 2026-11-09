import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  completedLanguageLessons,
  languages,
  loadLanguageNavigation,
  recentLearningLanguage,
  type TextLanguage,
} from '../../web/src/learning/languages';
import { createMeta, emptySnapshot, type Progress } from '../../web/src/storage/model';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const totals: Record<TextLanguage, number> = {
  python: 766,
  java: 390,
  cpp: 295,
  rust: 299,
  mysql: 300,
};

describe('the generated language navigation is an accurate projection of published teaching inputs', () => {
  for (const language of Object.keys(totals) as TextLanguage[]) {
    it(`${language} preserves every real teaching leaf, its source order, route and executable mode`, async () => {
      const navigation = await loadLanguageNavigation(language);
      const folder = `content/${language === 'python' ? 'python3' : language === 'rust' ? 'rust2018' : language}/course`;
      const manifest = read(`${folder}/manifest-1.0.0.json`);
      const expected: [string, string, string, string][] = [];
      for (const chunk of manifest.chunks) {
        const unit = read(`${folder}/${chunk.file}`);
        for (const node of unit.nodes) {
          if (!node.leaf || (node.status && node.status !== 'authored')) continue;
          const article = language === 'python' || language === 'java';
          const example = article
            ? unit.examples.find((example: { id: string }) => example.id === node.exampleId)
            : node.example;
          const activity = article
            ? unit.activities.find((activity: { id: string }) => activity.id === node.activityId)
            : node.activity;
          const runnable = example?.status === 'runnable-required' || example?.mode === 'wasm';
          const practice = activity?.kind === 'rust-judge' || activity?.mode === 'judge';
          const id = article ? node.platformRef.id : node.id;
          expected.push([
            id,
            article ? node.titleDisplay : [node.number, node.title].filter(Boolean).join(' '),
            article
              ? `/${language}/article/${chunk.articleSourceOrder}/${id}`
              : `/${language}/lesson/${id}`,
            practice ? 'practice' : runnable ? 'run' : 'reading',
          ]);
        }
      }
      expect(navigation.lessons).toEqual(expected);
      expect(navigation.lessons).toHaveLength(totals[language]);
      expect(new Set(navigation.lessons.map(([id]) => id)).size).toBe(totals[language]);
      expect(navigation.lessons.filter(([, , , mode]) => mode === 'practice')).toHaveLength(12);
      const subjects = new Map(navigation.subjects.map(([id, title, path]) => [id, [title, path]]));
      for (const [id, title, path] of expected) expect(subjects.get(id)).toEqual([title, path]);
      for (const [, title, path] of navigation.subjects) {
        expect(title).not.toContain('undefined');
        expect(path.startsWith('/' + language + '/')).toBe(true);
      }
      expect(languages.find((entry) => entry.id === language)?.total).toBe(expected.length);
    });
  }
});

function snapshot() {
  return emptySnapshot(
    createMeta({
      generation: '00000000-0000-4000-8000-000000000027',
      createdAt: '2026-11-09T00:00:00.000Z',
      timeZone: 'Asia/Shanghai',
      activePackageRef: { id: 'content.c.p0', version: '1.0.0' },
    }),
  );
}
function progress(
  id: string,
  at: string,
  eventType: 'lesson.completed' | 'lesson.study-confirmed' = 'lesson.completed',
): Progress {
  return {
    eventType,
    result: eventType === 'lesson.completed' ? 'completed' : 'confirmed',
    subjectRef: { id, version: '1.0.0' },
    packageRef: { id: 'content.mysql.book', version: '1.0.0' },
    learningRevision: 1,
    firstAt: at,
    lastAt: at,
  } as Progress;
}

describe('home language and reading summaries use actual chronological activity', () => {
  it('defaults to C for an empty or unrelated history and selects the latest recognized activity rather than array order', () => {
    const state = snapshot();
    expect(recentLearningLanguage(null)).toBe('c');
    expect(recentLearningLanguage(state)).toBe('c');
    state.progress = [progress('unknown.external', '2026-11-09T03:00:00.000Z')];
    expect(recentLearningLanguage(state)).toBe('c');
    state.progress.push(
      progress('mysql.lesson.1.1.1', '2026-11-09T02:00:00.000Z'),
      progress('py3.section.older', '2026-11-09T01:00:00.000Z'),
    );
    expect(recentLearningLanguage(state)).toBe('mysql');
    state.progress.push(
      progress('java.lesson.latest', '2026-11-09T02:30:00.000Z', 'lesson.study-confirmed'),
    );
    expect(recentLearningLanguage(state)).toBe('java');
  });
  it('counts each completed language leaf once and does not promote reading confirmations or another language to completed progress', () => {
    const state = snapshot();
    state.progress = [
      progress('mysql.lesson.1.1.1', '2026-11-09T01:00:00.000Z'),
      progress('mysql.lesson.1.1.1', '2026-11-09T02:00:00.000Z'),
      progress('mysql.lesson.1.1.2', '2026-11-09T02:00:00.000Z', 'lesson.study-confirmed'),
      progress('java.lesson.another', '2026-11-09T02:00:00.000Z'),
    ];
    expect([...completedLanguageLessons(state, 'mysql')]).toEqual(['mysql.lesson.1.1.1']);
    expect([...completedLanguageLessons(state, 'java')]).toEqual(['java.lesson.another']);
    expect(completedLanguageLessons(state, 'rust').size).toBe(0);
  });
});
