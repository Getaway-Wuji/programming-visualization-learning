import { createHash } from 'node:crypto';
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
}
const hash = (source: string) => createHash('sha256').update(source).digest('hex');

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
        configuration?.caseViewVersion === '1.0.1' &&
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
  if (found.length > 1) throw new Error('Expected one complete bundled case configuration.');
  return found[0] ?? null;
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
  const encoded = JSON.stringify(JSON.stringify(literal.configuration));
  const modifiedBundle = source.slice(0, literal.start) + encoded + source.slice(literal.end);
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
