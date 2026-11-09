import { MysqlClient, currentMysqlExecution } from '../../../web/src/engine/mysql-client';
import { MysqlPlayer } from '../../../web/src/engine/mysql-player';
import type { MysqlResponse, MysqlSession } from '../../../web/src/engine/mysql-types';
import {
  loadMysqlExercises,
  loadMysqlLesson,
  loadMysqlManifest,
  loadMysqlSource,
} from '../../../web/src/mysql-course/repository';

const client = new MysqlClient();
function inspect(response: MysqlResponse) {
  if (!response.replay) throw new Error('Missing actual SQL replay');
  const player = new MysqlPlayer(response.replay),
    initial = player.snapshot();
  for (let cursor = 1; cursor <= player.length; cursor++) player.seek(cursor);
  const end = player.snapshot();
  for (let cursor = player.length - 1; cursor >= 0; cursor--) player.seek(cursor);
  return {
    response,
    initial,
    end,
    rewound: player.snapshot(),
    receipt: currentMysqlExecution(response),
  };
}
const harness = {
  async content() {
    const signal = new AbortController().signal;
    const index = await loadMysqlManifest(signal),
      source = await loadMysqlSource(signal);
    const registry = await loadMysqlExercises(signal),
      nodes = [];
    for (const row of index.catalog) {
      const { lesson } = await loadMysqlLesson(row.id, signal);
      nodes.push({
        id: lesson.id,
        sourceNodeId: lesson.sourceNodeId,
        mode: lesson.example?.mode ?? null,
        activity: lesson.activity?.mode ?? null,
        coverage: lesson.coverage,
        physicalPage: lesson.physicalPage,
      });
    }
    return {
      counts: index.counts,
      coverage: source.coverage,
      nodes,
      profileIds: registry.map((p) => p.id),
    };
  },
  lesson: (id: string) => loadMysqlLesson(id, new AbortController().signal),
  exercises: () => loadMysqlExercises(new AbortController().signal),
  async run(source: string, session: MysqlSession) {
    return inspect(await client.run(source, session));
  },
  async judge(source: string, profile: string, reviewCase: number) {
    return inspect(await client.judge(source, profile, reviewCase));
  },
};
declare global {
  interface Window {
    mysqlContentHarness: typeof harness;
  }
}
window.mysqlContentHarness = harness;
