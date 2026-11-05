import { expect, type Page } from '@playwright/test';

export const blockWorkspace = (page: Page) =>
  page.getByRole('region', { name: '积木工作区', exact: true });

/** Persist an actual display choice in the normal settings screen. */
export async function setBlockPreference(page: Page, value: 'show' | 'hide' | 'auto') {
  const settings = await page.context().newPage();
  try {
    await settings.goto('/#/settings?panel=display');
    const choice = settings.getByRole('combobox', { name: '积木显示', exact: true });
    await expect(choice).toBeEnabled();
    await choice.selectOption(value);
    await expect(choice).toHaveValue(value);
    await expect(settings.locator('.app-shell')).toHaveAttribute(
      'data-learning-storage-status',
      'ready',
    );
  } finally {
    await settings.close();
  }
}

/** Opt older canvas regressions into visible blocks without changing their answer mode. */
export async function showPracticeBlocks(page: Page, { readOnly = true } = {}) {
  const preference = page.getByRole('combobox', { name: '积木显示', exact: true });
  if (await preference.count()) {
    await expect(preference).toBeEnabled();
    if ((await preference.inputValue()) !== 'show') await preference.selectOption('show');
    await expect(preference).toHaveValue('show');
    await expect(preference).toBeEnabled();
  } else if (!(await blockWorkspace(page).locator('.blocklySvg').isVisible())) {
    // Display preferences now live in settings. Use the real shared-browser
    // preference flow without leaving or replacing the current unsaved draft.
    const settings = await page.context().newPage();
    try {
      await settings.goto('/#/settings?panel=display');
      const choice = settings.getByRole('combobox', { name: '积木显示', exact: true });
      await expect(choice).toBeEnabled();
      if ((await choice.inputValue()) !== 'show') await choice.selectOption('show');
      await expect(choice).toHaveValue('show');
      await expect(settings.locator('.app-shell')).toHaveAttribute(
        'data-learning-storage-status',
        'ready',
      );
    } finally {
      await settings.close();
    }
  }
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  if (readOnly) {
    const collapseCode = page.getByRole('button', { name: '收起代码编辑', exact: true });
    if (await collapseCode.isVisible()) await collapseCode.click();
  }
}

/** Historic regression scenarios explicitly opt into the separate correction exercise. */
export async function openCorrectionPractice(page: Page) {
  await showPracticeBlocks(page);
  const button = page.getByTestId('practice-mode').getByRole('button', {
    name: '改错练习',
    exact: true,
  });
  await expect(button).toBeVisible();
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(blockWorkspace(page).locator('.blocklySvg')).toBeVisible();
  await showPracticeBlocks(page);
}

/** Expand only when a test actually uses keyboard editing; preserve the product's closed default. */
export async function openBlockKeyboardEditor(page: Page) {
  const details = blockWorkspace(page).locator('details.block-accessible');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
}

/** Read ordinary option labels/IDs, then operate the same accessible controls as a learner. */
export async function blockOptions(page: Page, pattern: RegExp): Promise<string[]> {
  await openBlockKeyboardEditor(page);
  const list = blockWorkspace(page).getByRole('combobox', { name: '积木列表', exact: true });
  await expect(list).toBeVisible();
  const options = await list.locator('option').evaluateAll((entries) =>
    entries.map((entry) => ({
      value: (entry as HTMLOptionElement).value,
      text: entry.textContent ?? '',
    })),
  );
  return options
    .filter((option) => option.value && pattern.test(option.text))
    .map((option) => option.value);
}

export async function selectBlock(page: Page, id: string) {
  await openBlockKeyboardEditor(page);
  const list = blockWorkspace(page).getByRole('combobox', { name: '积木列表', exact: true });
  expect(
    await list
      .locator('option')
      .evaluateAll((entries) => entries.map((entry) => (entry as HTMLOptionElement).value)),
  ).toContain(id);
  await list.selectOption(id);
  await expect(list).toHaveValue(id);
}

async function integerBlock(page: Page, value: string, occurrence = 0) {
  const ids = await blockOptions(page, new RegExp(`^\\d+\\. 整数 · ${value}$`));
  expect(ids.length).toBeGreaterThan(occurrence);
  await selectBlock(page, ids[occurrence]);
}

/** Independent fixes to the intentionally incomplete public starter, using native edits only. */
export async function correctStarter(page: Page, exerciseId: string) {
  await openCorrectionPractice(page);
  const workspace = blockWorkspace(page);
  if (exerciseId === 'exercise.c.echo') {
    const outputs = await blockOptions(page, /^\d+\. 输出 ·/);
    expect(outputs).toHaveLength(1);
    await selectBlock(page, outputs[0]);
    await workspace.getByRole('textbox', { name: '输出格式', exact: true }).fill('%d\\n');
  } else if (exerciseId === 'exercise.c.two-x-plus-three') {
    await integerBlock(page, '1');
    await workspace.getByRole('textbox', { name: '整数值', exact: true }).fill('2');
  } else if (exerciseId === 'exercise.c.nonnegative') {
    const comparisons = await blockOptions(page, /^\d+\. 比较 ·/);
    expect(comparisons).toHaveLength(1);
    await selectBlock(page, comparisons[0]);
    await workspace.getByRole('combobox', { name: '运算符', exact: true }).selectOption('>=');
  } else if (exerciseId === 'exercise.c.two-loop-sums') {
    const comparisons = await blockOptions(page, /^\d+\. 比较 ·/);
    expect(comparisons).toHaveLength(2);
    for (const id of comparisons) {
      await selectBlock(page, id);
      await workspace.getByRole('combobox', { name: '运算符', exact: true }).selectOption('<=');
    }
  } else if (exerciseId === 'exercise.c.increment-at-index') {
    await integerBlock(page, '0');
    await workspace.getByRole('textbox', { name: '整数值', exact: true }).fill('1');
  } else if (exerciseId === 'exercise.c.array-sum') {
    // The public starter's first integer 1 is the sum initializer, preceding the loop update.
    await integerBlock(page, '1');
    await workspace.getByRole('textbox', { name: '整数值', exact: true }).fill('0');
  } else throw new Error(`No independently reviewed UI fix for ${exerciseId}`);
}

/** Restore the single intentional mistake; useful for proving edit invalidation. */
export async function wrongEcho(page: Page) {
  const outputs = await blockOptions(page, /^\d+\. 输出 ·/);
  expect(outputs).toHaveLength(1);
  await selectBlock(page, outputs[0]);
  await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d');
}
