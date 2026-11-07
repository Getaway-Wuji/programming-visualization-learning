import { Rust2018Client, currentRustExecution } from '../../../web/src/engine/rust2018-client';
import {
  decodeRustResponse,
  rustRequest,
  type Rust2018Response,
} from '../../../web/src/engine/rust2018-protocol';
import { Rust2018Player } from '../../../web/src/engine/rust2018-player';
import { rust2018Build } from '../../../web/src/generated/rust2018/engine-build';
import init, { execute_rust2018 } from '../../../web/src/generated/rust2018/c_viz_rust2018';
import { canonicalC6Json } from '../../../web/src/engine/c6-protocol';
import { loadRustLesson, loadRustManifest } from '../../../web/src/rust2018-course/repository';

const client = new Rust2018Client();

function inspect(response: Rust2018Response) {
  if (!response.replay)
    return {
      response,
      initial: null,
      end: null,
      rewound: null,
      receipt: currentRustExecution(response),
    };
  const player = new Rust2018Player(response.replay);
  const initial = structuredClone(player.state);
  for (let cursor = 1; cursor <= player.length; cursor++) player.seek(cursor);
  const end = structuredClone(player.state);
  for (let cursor = player.length - 1; cursor >= 0; cursor--) player.seek(cursor);
  return {
    response,
    initial,
    end,
    rewound: structuredClone(player.state),
    receipt: currentRustExecution(response),
  };
}

const harness = {
  async content() {
    const signal = new AbortController().signal;
    const index = await loadRustManifest(signal);
    const nodes = [];
    for (const row of index.catalog) {
      const { lesson } = await loadRustLesson(row.id, signal);
      nodes.push({ id: lesson.id, mode: lesson.example?.mode, activity: lesson.activity?.mode });
    }
    return { counts: index.counts, nodes };
  },
  async run(source: string, input = '') {
    return inspect(await client.run(source, input));
  },
  async judge(source: string, profile: string, reviewCase: number) {
    return inspect(await client.judge(source, profile, reviewCase));
  },
  analyze: (source: string) => client.analyze(source),
  async cancel() {
    const seed = await client.run('fn main(){}', '');
    const pending = client.run('fn main(){loop{}}', '').then(
      () => 'completed',
      (error: Error) => error.message,
    );
    client.invalidate();
    return {
      outcome: await pending,
      stale: currentRustExecution(seed),
      recovered: inspect(await client.run('fn main(){println!("ready");}', '')),
    };
  },
  async forgedReverse() {
    const source = 'fn main(){let mut n=1;n=n+2;println!("{}",n);}';
    const response = await client.run(source, '');
    const receipt = currentRustExecution(response);
    if (!receipt || !response.replay) throw new Error('Expected real Rust receipt');
    const copied = structuredClone(response);
    const changed = copied.replay?.trace.steps
      .flatMap((step) => step.changes)
      .find((change) => change.component === 'output');
    if (!changed) throw new Error('Expected output change');
    changed.before = 'forged';
    const buffer = new TextEncoder().encode(JSON.stringify(copied)).buffer;
    try {
      await decodeRustResponse(buffer, receipt.request, rust2018Build.wasmSha256, () => {});
      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  request: rustRequest,
  async rawError(value: unknown) {
    await init();
    try {
      execute_rust2018(
        new TextEncoder().encode(canonicalC6Json(value)),
        rust2018Build.wasmSha256,
        1000,
      );
      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
};

declare global {
  interface Window {
    rust2018Harness: typeof harness;
  }
}
window.rust2018Harness = harness;
