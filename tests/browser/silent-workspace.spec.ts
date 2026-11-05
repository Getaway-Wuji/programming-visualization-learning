import { expectEditorValue } from './editor-value';
import { openIndependentRepair } from './current-course-helpers';
import { expect, test, type Page } from '@playwright/test';
import {
  blockOptions,
  blockWorkspace,
  openBlockKeyboardEditor,
  selectBlock,
  showPracticeBlocks,
} from './block-ui';

interface SilentAudioAudit {
  supported: boolean;
  calls: number;
  documentToken: string;
  wrapped: typeof AudioContext | null;
  expected: PropertyDescriptor | null;
}
declare global {
  interface Window {
    __silentAudioAudit: SilentAudioAudit;
  }
}

async function audioState(page: Page) {
  return page.evaluate(() => {
    const audit = window.__silentAudioAudit;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext');
    return {
      supported: audit.supported,
      calls: audit.calls,
      documentToken: audit.documentToken,
      restored:
        !!descriptor &&
        !!audit.expected &&
        descriptor.value === audit.wrapped &&
        descriptor.get === audit.expected.get &&
        descriptor.set === audit.expected.set &&
        descriptor.enumerable === audit.expected.enumerable &&
        descriptor.configurable === audit.expected.configurable &&
        descriptor.writable === audit.expected.writable,
    };
  });
}

test('silent native Blockly mounts and remounts without constructing AudioContext or retaining an API mask', async ({
  page,
}, info) => {
  // A transparent Proxy observes the actual native API. Calling it still calls
  // the real constructor; it does not fake audio or make a slow old build pass.
  await page.addInitScript(() => {
    const nativeDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext');
    const NativeAudioContext = window.AudioContext;
    const audit: SilentAudioAudit = {
      supported: typeof NativeAudioContext === 'function',
      calls: 0,
      documentToken: crypto.randomUUID(),
      wrapped: null,
      expected: null,
    };
    if (audit.supported) {
      const wrapped = new Proxy(NativeAudioContext, {
        construct(target, argumentsList, newTarget) {
          audit.calls++;
          return Reflect.construct(target, argumentsList, newTarget);
        },
      });
      Object.defineProperty(window, 'AudioContext', {
        value: wrapped,
        configurable: nativeDescriptor?.configurable ?? true,
        enumerable: nativeDescriptor?.enumerable ?? false,
        writable:
          nativeDescriptor && 'writable' in nativeDescriptor ? nativeDescriptor.writable : true,
      });
      audit.wrapped = wrapped;
      audit.expected = Object.getOwnPropertyDescriptor(window, 'AudioContext')!;
    }
    window.__silentAudioAudit = audit;
  });

  await openIndependentRepair(page, 'exercise.c.bug-semicolon');
  await showPracticeBlocks(page);
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  await openBlockKeyboardEditor(page);
  const initial = await audioState(page);
  expect(initial).toMatchObject({ supported: true, calls: 0, restored: true });

  const workspace = blockWorkspace(page);
  const outputs = await blockOptions(page, /^\d+\. 输出 ·/);
  expect(outputs).toHaveLength(1);
  await workspace
    .locator(`[data-id=${JSON.stringify(outputs[0])}] > .blocklyPath`)
    .first()
    .click({ position: { x: 20, y: 12 } });
  await expectEditorValue(
    workspace.getByRole('combobox', { name: '积木列表', exact: true }),
    outputs[0],
  );
  await workspace
    .getByRole('textbox', { name: '输出格式', exact: true })
    .fill('%d silent-audit\\n');
  await expect(
    workspace.locator('.blocklyText').filter({ hasText: 'silent-audit' }).first(),
  ).toBeVisible();

  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: '本地设置', exact: true })
    .click();
  await page.getByTestId('theme-cute').click();
  await page.getByTestId('save-appearance').click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance-draft', 'false');
  await page.goBack();
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  await selectBlock(page, outputs[0]);
  await expectEditorValue(
    blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }),
    '%d silent-audit\\n',
  );
  const afterTheme = await audioState(page);
  expect(afterTheme).toEqual(initial);

  // Hash navigation uses the same document and native APIs, while switching the
  // exercise actually disposes and remounts Blockly, its flyout and trashcan.
  await openIndependentRepair(page, 'exercise.c.bug-parenthesis');
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  const afterExercise = await audioState(page);
  expect(afterExercise).toEqual(initial);
  await openBlockKeyboardEditor(page);
  await expect(
    blockWorkspace(page).getByRole('combobox', { name: '积木列表', exact: true }),
  ).toBeVisible();
  await info.attach('native-audio-descriptor-and-remounts', {
    body: JSON.stringify({ initial, afterTheme, afterExercise }),
    contentType: 'application/json',
  });
});
