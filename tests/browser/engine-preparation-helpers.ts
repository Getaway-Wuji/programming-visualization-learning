import { expect, type Page } from '@playwright/test';

/** A deployment-only allowance for visible resource initialization, never for execution assertions. */
export async function waitForEnginePreparation(page: Page) {
  const configured = process.env.DEPLOYMENT_PREPARATION_TIMEOUT_MS;
  const timeout = configured === undefined ? 5000 : Number(configured);
  if (configured !== undefined && ![45000, 90000].includes(timeout))
    throw new Error('Deployment preparation allowance must be explicitly 45000 or 90000 ms.');
  const deadline = Date.now() + timeout;
  const gate = page.getByTestId('engine-preparation');
  await gate.waitFor({ state: 'attached', timeout });
  await expect(gate).toHaveAttribute('data-state', /ready|failed/, {
    timeout: Math.max(1, deadline - Date.now()),
  });
  expect(await gate.getAttribute('data-state')).toBe('ready');
  // The lazily mounted screen can still need its own JS and local draft after the engine is ready.
  // Keep that resource initialization inside this same bounded allowance.
  await expect(gate.locator('.code-editor [role="textbox"]').first()).toBeEditable({
    timeout: Math.max(1, deadline - Date.now()),
  });
}
