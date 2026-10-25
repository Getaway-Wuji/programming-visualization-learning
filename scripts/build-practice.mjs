import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { format } from 'prettier';
import { inspectContentDraft } from '../web/src/content/validator.mjs';
const root = new URL('../', import.meta.url);
const bytes = await readFile(new URL('content/c/p0/course-1.0.1.json', root));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const sourceSha256 = sha(bytes);
if (sourceSha256 !== '713133313e65ba9ea000daa18d5feaea84beeb65f296b8102edc5de114fa2611')
  throw new Error('Register a new practice release after reviewing changed course bytes.');
const content = inspectContentDraft(bytes);
const select = (entities, refs) =>
  entities.filter((entry) =>
    refs.some((ref) => ref.id === entry.id && ref.version === entry.version),
  );
const programs = select(
  content.programs,
  content.exercises.map((entry) => entry.programRef),
);
const practice = {
  practiceVersion: '1.0.0',
  sourceSha256,
  packageRef: { id: content.packageId, version: content.packageVersion },
  exercises: content.exercises,
  programs,
  inputSpecs: select(
    content.inputSpecs,
    programs.map((entry) => entry.inputRef),
  ),
  judgeProfiles: select(
    content.judgeProfiles,
    content.exercises.map((entry) => entry.judgeRef),
  ),
};
const output = Buffer.from(JSON.stringify(practice, null, 2) + '\n');
const destination = new URL('web/public/content/practice/', root);
await mkdir(destination, { recursive: true });
await writeFile(new URL('course-practice-1.0.0.json', destination), output);
const manifest = {
  practiceVersion: '1.0.0',
  file: 'content/practice/course-practice-1.0.0.json',
  sha256: sha(output),
  bytes: output.length,
  sourceSha256,
  capabilities: ['temporary-judgement', 'temporary-review'],
  fullContentPublication: false,
  learningEvents: false,
};
await writeFile(new URL('manifest.json', destination), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(
  new URL('web/src/content/practice-release.generated.ts', root),
  await format(
    '// Generated from independently reviewed practice material.\nexport const practiceRelease = ' +
      JSON.stringify(manifest) +
      ' as const;\n',
    { parser: 'typescript', singleQuote: true, printWidth: 100 },
  ),
);
console.log('09.3 practice release: six exercises / 24 cases; temporary judgement only.');
