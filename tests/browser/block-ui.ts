import { expect, type Page } from '@playwright/test';

export const blockWorkspace = (page: Page) =>
  page.getByRole('region', { name: '积木工作区', exact: true });

/** Read ordinary option labels/IDs, then operate the same accessible controls as a learner. */
export async function blockOptions(page: Page, pattern: RegExp): Promise<string[]> {
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
