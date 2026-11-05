import { expect, test, type Page } from '@playwright/test';
import { observedC6Packet } from './c6-observation';

/** Passive request classification. Background EDIT work is accounted for,
 * while exactly one requested real execution must supply the checked packet. */
export async function observedC6Execution(page: Page, kind: 'judge' | 'run') {
  const requests = await page.evaluate(() =>
    window.c6CurrentPackets.map((packet, index) => {
      const request = packet.request
        ? (JSON.parse(new TextDecoder().decode(packet.request)) as {
            editVersion?: string;
            execVersion?: string;
            judgeVersion?: string;
          })
        : null;
      const kind = !request
        ? packet.terminated
          ? 'cancelled-before-request'
          : 'unknown'
        : request.editVersion === '2.0.0' && !request.execVersion && !request.judgeVersion
          ? 'edit'
          : request.execVersion === '1.5.0' && !request.editVersion
            ? request.judgeVersion === '2.0.0'
              ? 'judge'
              : request.judgeVersion === undefined
                ? 'run'
                : 'unknown'
            : 'unknown';
      return { index, kind, moduleSeen: packet.moduleSeen, terminated: packet.terminated };
    }),
  );
  expect(requests.every((request) => request.kind !== 'unknown')).toBe(true);
  expect(
    requests.every((request) => request.kind === 'cancelled-before-request' || request.moduleSeen),
  ).toBe(true);
  const executions = requests.filter(
    (request) => request.kind === 'run' || request.kind === 'judge',
  );
  expect(executions).toHaveLength(1);
  expect(executions[0].kind).toBe(kind);
  const captured = await observedC6Packet(page, executions[0].index);
  expect(captured).toMatchObject({ count: requests.length, moduleSeen: true, terminated: true });
  expect(captured.request).not.toBeNull();
  expect(captured.response).not.toBeNull();
  await test.info().attach('passively-observed-request-kinds', {
    body: JSON.stringify(requests),
    contentType: 'application/json',
  });
  return captured;
}
