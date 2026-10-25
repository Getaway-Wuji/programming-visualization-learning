import assert from 'node:assert/strict';

/** Accept only the task-local certificate's public key in this newly launched
 * browser. Broad context HTTPS-error suppression prevents real disk caching in
 * the measured Chromium versions, so it must remain disabled. No OS trust store
 * or normal user profile is changed. */
export function performanceBrowserOptions(browserName, serverMetadata) {
  assert.ok(['chrome', 'edge'].includes(browserName), 'Use installed Chrome or Edge');
  const spkiSha256 = serverMetadata.certificate.publicKeySpkiSha256;
  assert.match(spkiSha256, /^[A-Za-z0-9+/]{43}=$/, 'Expected one SHA-256 SPKI pin');
  return {
    launchOptions: {
      channel: browserName === 'edge' ? 'msedge' : 'chrome',
      headless: false,
      args: [
        '--disable-extensions',
        '--force-device-scale-factor=1',
        '--no-first-run',
        `--ignore-certificate-errors-spki-list=${spkiSha256}`,
      ],
    },
    contextOptions: {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: false,
      serviceWorkers: 'block',
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      colorScheme: 'light',
      reducedMotion: 'no-preference',
    },
    certificateAcceptance: {
      spkiSha256,
      certificateSha256: serverMetadata.certificate.sha256,
      broadContextIgnoreHTTPSErrors: false,
      boundary:
        'Only the matching task-local certificate public key bypasses errors in the owned browser process. A fresh temporary profile/context is used; no certificate installation or global trust changes. This does not prove public deployment certificate trust.',
      calibrationEvidence:
        '.artifacts/11.4/network-spki-stress-second/report.json; scoped-SPKI Chrome/Edge real warm-cache comparison, retained separate from formal UI timing',
    },
  };
}
