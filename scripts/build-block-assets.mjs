import { readFile, readdir, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(
  await readFile(new URL('node_modules/blockly/package.json', root), 'utf8'),
);
if (packageJson.version !== '13.4.0') throw new Error('Unexpected Blockly version.');
const source = new URL('node_modules/blockly/media/', root);
const target = new URL('web/public/blockly/13.4.0/media/', root);
await mkdir(target, { recursive: true });
const files = [];
for (const name of (await readdir(source)).sort()) {
  if (!/^[a-zA-Z0-9.-]+\.(?:svg|png|gif|cur)$/.test(name)) continue;
  const bytes = await readFile(new URL(name, source));
  await copyFile(new URL(name, source), new URL(name, target));
  files.push({
    file: 'blockly/13.4.0/media/' + name,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
if (files.length !== 12) throw new Error('Review changed Blockly public media.');
await mkdir(new URL('.artifacts/', root), { recursive: true });
await writeFile(
  new URL('.artifacts/block-assets.json', root),
  JSON.stringify({ library: 'blockly', version: '13.4.0', sounds: false, files }, null, 2) + '\n',
);
console.log('Blockly media: 12 exact local assets; no external media host.');
// Blockly synchronously injects two fixed library stylesheets. Authorize their
// exact text, rather than admitting arbitrary inline styles in the QA policy.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const dom = new JSDOM(
  '<!doctype html><html><head></head><body><div id="blockly-host"></div></body></html>',
);
const { document } = dom.window;
try {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const { default: Blockly } = await import('blockly/core');
  const host = document.getElementById('blockly-host');
  Blockly.Css.inject(host, true, '/blockly/13.4.0/media/');
  const renderer = new Blockly.zelos.Renderer('zelos');
  renderer.init(Blockly.Themes.Classic);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(svg);
  renderer.createDom(svg, Blockly.Themes.Classic, host);
  const hashes = [...document.querySelectorAll('style')]
    .map((style) => createHash('sha256').update(style.textContent).digest('base64'))
    .sort();
  const reviewed = [
    'T0FgI68exbsB63wO17aNhklkM8DeXs5ck81H6uODSoM=',
    'nKpTklSEmD9hcJp6oNVyb+XJJBeSqh33WTK0YENycHk=',
  ].sort();
  if (JSON.stringify(hashes) !== JSON.stringify(reviewed))
    throw new Error('Review changed Blockly runtime styles before changing the CSP hashes.');
  await writeFile(
    new URL('.artifacts/block-style-hashes.json', root),
    JSON.stringify(
      {
        library: 'blockly',
        version: '13.4.0',
        media: '/blockly/13.4.0/media/',
        hashes,
        arbitraryInlineStyles: false,
      },
      null,
      2,
    ) + '\n',
  );
  renderer.dispose();
} finally {
  dom.window.close();
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete globalThis.window;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete globalThis.document;
}
