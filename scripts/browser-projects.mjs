const requested = process.env.CROSS_BROWSER_PROJECTS ?? 'chrome';
if (!['all', 'chrome', 'edge', 'firefox-automation'].includes(requested))
  throw new Error('CROSS_BROWSER_PROJECTS must be all, chrome, edge or firefox-automation.');
export const browserScope =
  requested === 'all' ? ['chrome', 'edge', 'firefox-automation'] : [requested];
/** @type {import('@playwright/test').Project[]} */
export const browserProjects = browserScope.map((name) => ({
  name,
  use:
    name === 'firefox-automation'
      ? { browserName: 'firefox' }
      : { browserName: 'chromium', channel: name === 'edge' ? 'msedge' : 'chrome' },
}));
