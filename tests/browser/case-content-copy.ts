import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import type { Page, Route } from '@playwright/test';

export interface IsolatedCaseContentCopy {
  sourceKind: 'test-isolated-application-case-config-copy';
  publicationEvidence: false;
  programId: string;
  originalSource: string;
  modifiedSource: string;
  originalBundleSha256: string;
  modifiedBundleSha256: string;
  bundleUrl?: string;
  configurationBinding?: {
    originalSha256: string;
    modifiedSha256: string;
    originalBytes: number;
    modifiedBytes: number;
    literalRanges: { start: number; end: number }[];
  };
}
interface CaseConfiguration {
  caseViewVersion: string;
  purpose: string;
  catalogs: { program: { id: string; sourceExample: string } }[];
}
interface Literal {
  start: number;
  end: number;
  value: string;
  configuration: CaseConfiguration;
  inlinedCopies?: { start: number; end: number }[];
}
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const currentCaseBytes = readFileSync('content/c/primer6-learning/cases-1.0.0.json', 'utf8');
const currentCaseHash = 'a389fea06289ffa3da40ff9f0f28296e498d6d5be54dc0d206885bec8d57d3be';
if (hash(currentCaseBytes) !== currentCaseHash || Buffer.byteLength(currentCaseBytes) !== 37098)
  throw new Error('Reviewed current case fixture changed');

/** Inspect the actual JS syntax rather than guessing escaped minifier output. */
function caseConfigurationLiteral(source: string): Literal | null {
  if (!source.includes('caseViewVersion')) return null;
  const found: Literal[] = [];
  const pending: unknown[] = [parse(source, { sourceType: 'module' })];
  while (pending.length) {
    const entry = pending.pop();
    if (!entry || typeof entry !== 'object') continue;
    const node = entry as {
      type?: string;
      start?: number;
      end?: number;
      value?: unknown;
      expressions?: unknown[];
      quasis?: { value: { cooked: string | null } }[];
    };
    const value =
      node.type === 'StringLiteral' && typeof node.value === 'string'
        ? node.value
        : node.type === 'TemplateLiteral' && node.expressions?.length === 0
          ? node.quasis?.[0]?.value.cooked
          : null;
    if (value?.includes('caseViewVersion')) {
      let configuration: CaseConfiguration | undefined;
      try {
        configuration = JSON.parse(value) as CaseConfiguration;
      } catch {
        // A property-name literal is not the complete bundled JSON resource.
      }
      if (
        (configuration?.caseViewVersion === '1.0.1' ||
          (configuration?.caseViewVersion === '1.1.0' && value === currentCaseBytes)) &&
        configuration.purpose === 'case-view' &&
        Array.isArray(configuration.catalogs)
      ) {
        if (typeof node.start !== 'number' || typeof node.end !== 'number')
          throw new Error('The bundled case configuration must have exact syntax offsets.');
        found.push({ start: node.start, end: node.end, value, configuration });
      }
    }
    for (const child of Object.values(entry)) {
      if (Array.isArray(child)) pending.push(...child);
      else if (child && typeof child === 'object') pending.push(child);
    }
  }
  const current = found.filter((l) => l.value === currentCaseBytes);
  if ((current.length && current.length !== 3) || (!current.length && found.length > 1))
    throw new Error('Expected one complete bundled case configuration of the selected version.');
  return current.length
    ? { ...current[0], inlinedCopies: current.map(({ start, end }) => ({ start, end })) }
    : (found[0] ?? null);
}

function currentBindingLiterals(source: string) {
  const hashes: { start: number; end: number }[] = [],
    sizes: { start: number; end: number }[] = [];
  const pending: unknown[] = [parse(source, { sourceType: 'module' })];
  while (pending.length) {
    const entry = pending.pop();
    if (!entry || typeof entry !== 'object') continue;
    type Candidate = {
      type?: string;
      value?: unknown;
      start?: number;
      end?: number;
      expressions?: unknown[];
      quasis?: { value: { cooked: string | null } }[];
    };
    const value = (node?: Candidate) =>
      node?.type === 'StringLiteral'
        ? node.value
        : node?.type === 'TemplateLiteral' && node.expressions?.length === 0
          ? node.quasis?.[0].value.cooked
          : null;
    const node = entry as Candidate & {
      init?: Candidate;
      operator?: string;
      right?: Candidate;
      left?: {
        type?: string;
        property?: { name?: string };
        object?: {
          type?: string;
          callee?: { type?: string; property?: { name?: string } };
          arguments?: Candidate[];
        };
      };
    };
    const hashBinding =
      node.type === 'VariableDeclarator' && value(node.init) === currentCaseHash ? node.init : null;
    const sizeBinding =
      node.type === 'BinaryExpression' &&
      node.operator === '!==' &&
      node.right?.value === 37098 &&
      node.left?.type === 'MemberExpression' &&
      node.left.property?.name === 'length' &&
      node.left.object?.type === 'CallExpression' &&
      node.left.object.callee?.type === 'MemberExpression' &&
      node.left.object.callee.property?.name === 'encode' &&
      value(node.left.object.arguments?.[0]) === currentCaseBytes
        ? node.right
        : null;
    const binding = hashBinding ?? sizeBinding;
    if (binding) {
      if (typeof binding.start !== 'number' || typeof binding.end !== 'number')
        throw new Error('Missing exact binding offsets');
      (hashBinding ? hashes : sizes).push({ start: binding.start, end: binding.end });
    }
    for (const child of Object.values(entry)) {
      if (Array.isArray(child)) pending.push(...child);
      else if (child && typeof child === 'object') pending.push(child);
    }
  }
  if (hashes.length !== 1 || sizes.length !== 1)
    throw new Error('Expected exact current SHA and byte-count data bindings');
  return { hash: hashes[0], size: sizes[0] };
}

/** Test-only application copy: change one public template and no execution code.
 * It is deliberately not evidence that this modified configuration was published.
 */
export function copyBundledCaseProgram(
  source: string,
  programId: string,
  change: (original: string) => string,
): { source: string; copy: IsolatedCaseContentCopy } | null {
  const literal = caseConfigurationLiteral(source);
  if (!literal) return null;
  const matches = literal.configuration.catalogs.filter((entry) => entry.program.id === programId);
  if (matches.length !== 1)
    throw new Error('Expected exactly one public template in the case copy.');
  const program = matches[0].program;
  const originalSource = program.sourceExample;
  const modifiedSource = change(originalSource);
  if (typeof modifiedSource !== 'string' || modifiedSource === originalSource)
    throw new Error('An isolated case copy must actually change its intended public template.');
  program.sourceExample = modifiedSource;
  const configuration = JSON.stringify(literal.configuration);
  const replacements = (literal.inlinedCopies ?? [{ start: literal.start, end: literal.end }]).map(
    (range) => ({ ...range, text: JSON.stringify(configuration) }),
  );
  let configurationBinding: IsolatedCaseContentCopy['configurationBinding'];
  if (literal.value === currentCaseBytes) {
    const bindings = currentBindingLiterals(source);
    const modifiedSha256 = hash(configuration),
      modifiedBytes = Buffer.byteLength(configuration);
    replacements.push(
      { ...bindings.hash, text: JSON.stringify(modifiedSha256) },
      { ...bindings.size, text: String(modifiedBytes) },
    );
    configurationBinding = {
      originalSha256: currentCaseHash,
      modifiedSha256,
      originalBytes: 37098,
      modifiedBytes,
      literalRanges: replacements.map(({ start, end }) => ({ start, end })),
    };
  }
  let modifiedBundle = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    modifiedBundle =
      modifiedBundle.slice(0, replacement.start) +
      replacement.text +
      modifiedBundle.slice(replacement.end);
  return {
    source: modifiedBundle,
    copy: {
      sourceKind: 'test-isolated-application-case-config-copy',
      publicationEvidence: false,
      programId,
      originalSource,
      modifiedSource,
      originalBundleSha256: hash(source),
      modifiedBundleSha256: hash(modifiedBundle),
      ...(configurationBinding ? { configurationBinding } : {}),
    },
  };
}

/** Keep the real production UI, Rust, Worker, decoder and trajectory untouched.
 * Keep interception during restoration so an immutable test copy cannot be reused from cache.
 */
export async function isolateCaseProgram(
  page: Page,
  programId: string,
  change: (original: string) => string,
) {
  const scripts = /\/assets\/[^/?]+\.js(?:\?.*)?$/;
  let copy: IsolatedCaseContentCopy | undefined;
  let restored = false;
  const handler = async (route: Route) => {
    const response = await route.fetch();
    if (restored) {
      await route.fulfill({ response });
      return;
    }
    const source = await response.text();
    const modified = copyBundledCaseProgram(source, programId, change);
    if (!modified) {
      await route.fulfill({ response });
      return;
    }
    copy = { ...modified.copy, bundleUrl: route.request().url() };
    const headers = { ...response.headers() };
    delete headers['content-length'];
    delete headers['content-encoding'];
    await route.fulfill({ response, headers, body: modified.source });
  };
  await page.route(scripts, handler);
  return {
    getCopy: () => copy,
    restore: async () => {
      restored = true;
    },
  };
}
