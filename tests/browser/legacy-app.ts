import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { Page } from '@playwright/test';

/** Real immutable pre-RESET app, used only to create genuine historical inputs. */
export async function routeHistoricalApp(page: Page, origin: string) {
  const root = resolve('.artifacts/21.5/legacy-production');
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.continue();
    const file = resolve(
      root,
      '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)),
    );
    if (!file.startsWith(root + sep) || !existsSync(file)) return route.abort();
    await route.fulfill({
      body: readFileSync(file),
      contentType: mime[extname(file)] ?? 'application/octet-stream',
    });
  });
}
