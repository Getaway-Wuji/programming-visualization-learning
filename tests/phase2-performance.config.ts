import { readFileSync } from 'node:fs';
import { createHash, X509Certificate } from 'node:crypto';
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const certificate = new X509Certificate(readFileSync('.artifacts/11.4/conditions-local-tls.cer'));
const pin = createHash('sha256')
  .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('base64');
export default defineConfig({
  testDir: './browser',
  testMatch: 'phase2-performance.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 600000,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: fileURLToPath(
          new URL(`../.artifacts/16.10/${process.env.TASK_EVIDENCE_LABEL}.json`, import.meta.url),
        ),
      },
    ],
  ],
  outputDir: fileURLToPath(
    new URL(`../.artifacts/16.10/${process.env.TASK_EVIDENCE_LABEL}-output`, import.meta.url),
  ),
  use: {
    channel: 'chrome',
    headless: false,
    baseURL: 'https://127.0.0.1:4190',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    serviceWorkers: 'block',
    ignoreHTTPSErrors: false,
    launchOptions: {
      args: [
        '--disable-extensions',
        '--force-device-scale-factor=1',
        '--no-first-run',
        `--ignore-certificate-errors-spki-list=${pin}`,
      ],
    },
  },
  webServer: {
    command: `node scripts/serve-performance.mjs --log-prefix .artifacts/11.4/${process.env.TASK_EVIDENCE_LABEL}-network`,
    port: 4190,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    reuseExistingServer: false,
    timeout: 60000,
  },
});
