import {
  PythonExecutionClient,
  acceptedPythonExecution,
} from '../../../web/src/engine/python3-client';
import { PythonPlayer } from '../../../web/src/engine/python3-player';
import { pythonPositions } from '../../../web/src/engine/python3-protocol';
import type { PythonPacket } from '../../../web/src/engine/python3-types';
import type { Python3Harness } from '../python3-harness';

const client = new PythonExecutionClient();
function inspect(packet: PythonPacket) {
  const player = packet.trace ? new PythonPlayer(packet.trace) : null;
  const end = player?.seek(packet.terminal.cursor);
  const initial = player?.seek(0);
  return { terminal: packet.terminal, end, initial };
}
const harness: Python3Harness = {
  async run(source: string, input: string) {
    const response = await client.run(source, input);
    if (response.result.kind !== 'run') throw new Error('Wrong execution kind');
    return {
      ...inspect(response.result.packet),
      usage: response.usage,
      positions: [...pythonPositions(source)],
      proof: acceptedPythonExecution(response),
    };
  },
  async judge(source: string, profile: string) {
    const response = await client.judge(source, profile);
    if (response.result.kind !== 'judge') throw new Error('Wrong execution kind');
    const { cases, status } = response.result;
    return {
      status,
      usage: response.usage,
      cases: cases.map(({ caseKey, stdoutMatches, observationMatches, packet }) => ({
        caseKey,
        stdoutMatches,
        observationMatches,
        ...inspect(packet),
      })),
    };
  },
  async edit(source: string) {
    const response = await client.analyze(source, 'python3-check');
    return { result: response.result, nodeMap: response.nodeMap };
  },
  async cancel() {
    const original = client.run('while True:\n    pass');
    const settled = original.then(
      () => 'E_UNEXPECTED_COMPLETION',
      (error: Error) => error.message,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    client.invalidate();
    const result = await settled;
    const recovery = await harness.run('print(8 // 3)', '');
    return { result, output: recovery.end?.state.output };
  },
};
window.python3Harness = harness;
