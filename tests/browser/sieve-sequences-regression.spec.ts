import { test, expect } from '@playwright/test';
import { caseSetIds, caseSetSamples } from '../fixtures/case-set';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import { waitForPhase2Archive } from './phase2-ready';
import { native } from './scheduler-helpers';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';
import { PlayerModel } from '../../web/src/player/model';

/** Current DB8 regression, separate from the immutable pre-17 fifteen-store test. */
for (const id of caseSetIds) {
  test(`18.4 current archive and genuine C case remain reversible: ${id}`, async ({
    page,
  }, info) => {
    const sample = caseSetSamples.find((s) => s.caseId === id && s.walk)!;
    await observeCaseSetExecution(page);
    await page.goto('/#/visualize/' + id);
    await waitForPhase2Archive(page);
    const storage = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('c-viz-learning');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const value = { version: db.version, stores: Array.from(db.objectStoreNames).sort() };
      db.close();
      return value;
    });
    expect(storage.version).toBe(8);
    expect(storage.stores).toHaveLength(16);
    expect(storage.stores).toContain('customDrafts');
    const before = await native(page),
      panel = page.getByTestId('case-execution');
    for (const [key, value] of Object.entries(sample.values))
      await page
        .getByTestId('input-field-' + key)
        .fill(Array.isArray(value) ? value.join(', ') : String(value));
    await panel.getByRole('button', { name: '应用输入并准备', exact: true }).click();
    await expect(panel).toHaveAttribute('data-state', 'ready');
    await panel.getByRole('button', { name: '运行示例', exact: true }).click();
    await expect(panel).toHaveAttribute('data-state', 'completed');
    await expect(page.getByTestId('execution-output')).toHaveText(sample.stdout);
    const packet = await observedCaseSetExecute(page);
    expect(packet).toMatchObject({ moduleSeen: true, responseOk: true, terminated: true });
    const requestBytes = Buffer.from(packet.requestBytes!),
      resultBytes = Buffer.from(packet.responseBytes!);
    const request = JSON.parse(requestBytes.toString()) as ExecuteRequest;
    expect(request.subjectRef?.id).toBe(id);
    expect(request.input.values).toEqual(sample.values);
    expect(request.source.text).toBe(
      await panel.getByRole('textbox', { name: '当前执行的 C 代码', exact: true }).inputValue(),
    );
    const result = await decodeResult(Uint8Array.from(resultBytes).buffer, request);
    expect(result.terminal.status).toBe('completed');
    const model = new PlayerModel();
    expect(model.acceptValidated(model.begin(result.identity), result)).toBe(true);
    for (let k = 1; k <= result.trace!.steps.length; k++) expect(model.seek(k)).toBe(true);
    expect(model.snapshot().state!.output).toBe(sample.stdout);
    for (let k = result.trace!.steps.length - 1; k >= 0; k--) expect(model.seek(k)).toBe(true);
    expect(model.snapshot().state).toEqual(result.trace!.initialState);
    const controls = page.getByTestId('player-controls');
    await controls.getByRole('combobox', { name: '步骤显示', exact: true }).selectOption('all');
    await controls.getByRole('button', { name: '前进', exact: true }).click();
    await expect(controls).toHaveAttribute('data-cursor', '1');
    await controls.getByRole('button', { name: '后退', exact: true }).click();
    await expect(controls).toHaveAttribute('data-cursor', '0');
    expect(await native(page)).toEqual(before);
    for (const [name, bytes] of [
      ['request', requestBytes],
      ['result', resultBytes],
    ] as const)
      await info.attach(name, { body: bytes, contentType: 'application/json' });
    await info.attach('archive-and-reversal', {
      body: JSON.stringify({
        storage,
        sample: sample.key,
        steps: result.trace!.steps.length,
        allAtomicReversed: true,
        noLearningSideEffects: true,
      }),
      contentType: 'application/json',
    });
  });
}
