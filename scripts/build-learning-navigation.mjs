import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const title = (node) =>
  [node.number, node.title].filter((part) => part !== undefined && part !== '').join(' ');
const output = 'web/src/generated/learning-navigation';
mkdirSync(output, { recursive: true });
for (const language of ['python', 'java', 'cpp', 'rust', 'mysql']) {
  const folder = `content/${language === 'python' ? 'python3' : language === 'rust' ? 'rust2018' : language}/course`;
  const manifest = read(`${folder}/manifest-1.0.0.json`);
  const subjects = [];
  const lessons = [];
  if (language === 'python' || language === 'java') {
    for (const chunk of manifest.chunks) {
      const article = read(`${folder}/${chunk.file}`);
      for (const node of article.nodes) {
        const path = `/${language}/article/${chunk.articleSourceOrder}/${node.platformRef.id}`;
        subjects.push([node.platformRef.id, node.titleDisplay, path]);
        if (node.leaf && node.status === 'authored') {
          const example = article.examples.find((row) => row.id === node.exampleId);
          lessons.push([
            node.platformRef.id,
            node.titleDisplay,
            path,
            node.questionId
              ? 'practice'
              : example?.status === 'runnable-required'
                ? 'run'
                : 'reading',
          ]);
        }
      }
      for (const activity of article.activities.filter((row) => row.kind === 'rust-judge'))
        subjects.push([activity.id, activity.title, `/${language}/practice/${activity.id}`]);
    }
  } else {
    const exercises = read(`${folder}/exercises-1.0.0.json`);
    const practice = new Set(exercises.map((row) => row.lesson ?? row.lessonId));
    for (const node of manifest.catalog) {
      const label = title(node);
      const path = `/${language}/lesson/${node.id}`;
      subjects.push([node.id, label, path]);
      if (node.leaf)
        lessons.push([node.id, label, path, practice.has(node.id) ? 'practice' : 'reading']);
    }
    for (const exercise of exercises) {
      const node = manifest.catalog.find(
        (row) => row.id === (exercise.lesson ?? exercise.lessonId),
      );
      assert(node, `${language}: exercise lesson exists`);
      subjects.push([
        exercise.id,
        exercise.title ?? `${title(node)} · 练习`,
        `/${language}/practice/${exercise.id}`,
      ]);
    }
  }
  assert.equal(new Set(lessons.map((row) => row[0])).size, lessons.length);
  assert.equal(new Set(subjects.map((row) => row[0])).size, subjects.length);
  assert(subjects.every(([, label]) => label.trim() && !/\bundefined\b/.test(label)));
  writeFileSync(
    `${output}/${language}.ts`,
    '// Generated from the published course inputs. Teaching bodies remain in their own chunks.\n' +
      `export default ${JSON.stringify({ language, lessons, subjects })} as const;\n`,
  );
  console.log(`${language}: ${lessons.length} learning routes, ${subjects.length} titles.`);
}
