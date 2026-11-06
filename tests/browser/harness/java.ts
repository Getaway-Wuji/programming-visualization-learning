import {
  JavaExecutionClient,
  acceptedJavaExecution,
  currentJavaExecution,
} from '../../../web/src/engine/java-client';
import { JavaPlayer } from '../../../web/src/engine/java-player';
import type { JavaPacket } from '../../../web/src/engine/java-types';

import type { JavaHarness } from '../java-harness';

const client = new JavaExecutionClient();
const main = (body: string) =>
  'public class Main { public static void main(String[] args) { ' + body + ' } }';

function inspect(packet: JavaPacket) {
  const player = packet.trace ? new JavaPlayer(packet.trace) : null;
  const end = player?.seek(packet.terminal.cursor);
  const nearEnd = player?.seek(Math.max(0, packet.terminal.cursor - 1));
  const initial = player?.seek(0);
  return { terminal: packet.terminal, end, nearEnd, initial };
}

const harness: JavaHarness = {
  async run(source: string, input: string) {
    const response = await client.run(source, input);
    if (response.result.kind !== 'run') throw new Error('E_WRONG_KIND');
    return {
      ...inspect(response.result.packet),
      usage: response.usage,
      proof: acceptedJavaExecution(response),
    };
  },
  async judge(source: string, profile: string) {
    const response = await client.judge(source, profile);
    if (response.result.kind !== 'judge') throw new Error('E_WRONG_KIND');
    return {
      status: response.result.status,
      usage: response.usage,
      cases: response.result.cases.map(({ packet, ...group }) => ({
        ...group,
        ...inspect(packet),
      })),
    };
  },
  async edit(source: string) {
    const response = await client.analyze(source, 'java-check');
    return { result: response.result, nodeMap: response.nodeMap };
  },
  async cancel() {
    const seed = await client.run(main('System.out.println(1);'));
    const current = Boolean(currentJavaExecution(seed));
    const pending = client.run(main('while (true) {}')).then(
      () => 'E_UNEXPECTED_COMPLETION',
      (error: Error) => error.message,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    client.invalidate();
    const stale = currentJavaExecution(seed);
    const result = await pending;
    const recovery = await harness.run(main('System.out.println(8 / 3);'), '');
    return { result, output: recovery.end?.state.output, current, stale };
  },
};
window.javaHarness = harness;
