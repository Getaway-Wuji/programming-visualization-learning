import { CppCourseClient, currentCppExecution } from '../../../web/src/engine/cpp-course-client';
import type { CppCourseResponse, CppInput } from '../../../web/src/engine/cpp-course-protocol';
import { AdvancedPlayer } from '../../../web/src/engine/advanced-player';
import { loadCppLesson, loadCppManifest } from '../../../web/src/cpp-course/repository';

const client = new CppCourseClient();
function inspect(result: CppCourseResponse) {
  const player = new AdvancedPlayer();
  if (result.replay) player.accept(result.replay);
  const initial = player.snapshot();
  for (let i = 1; i <= initial.length; i++) player.seek(i);
  const end = player.snapshot();
  for (let i = end.cursor - 1; i >= 0; i--) player.seek(i);
  const rewound = player.snapshot();
  return {
    status: result.status,
    diagnostic: result.diagnostic,
    judgement: result.judgement,
    terminal: result.replay?.terminal,
    initial,
    end,
    rewound,
    receipt: currentCppExecution(result),
  };
}

const harness = {
  async content() {
    const signal = new AbortController().signal;
    const manifest = await loadCppManifest(signal);
    const nodes = [];
    for (const row of manifest.catalog) {
      const { lesson } = await loadCppLesson(row.id, signal);
      nodes.push({ id: lesson.id, mode: lesson.example?.mode, activity: lesson.activity?.mode });
    }
    return { counts: manifest.counts, nodes };
  },
  async run(source: string, input: CppInput) {
    return inspect(await client.run(source, input));
  },
  async judge(source: string, profile: string, reviewCase: number, input: CppInput) {
    return inspect(await client.judge(source, profile, reviewCase, input));
  },
  analyze: (source: string) => client.analyze(source),
  async cancel() {
    const input: CppInput = { kind: 'integers', values: [] };
    const seed = await client.run('int main(){}', input);
    const pending = client.run('int main(){while(1){}}', input).then(
      () => 'completed',
      (error: Error) => error.message,
    );
    client.invalidate();
    return {
      outcome: await pending,
      stale: currentCppExecution(seed),
      recovered: inspect(await client.run('int main(){return 7;}', input)),
    };
  },
};
declare global {
  interface Window {
    cppCourseHarness: typeof harness;
  }
}
window.cppCourseHarness = harness;
