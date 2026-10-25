import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { workspaceDir } from './process.mjs';

const BALANCED_GUID = '381b4222-f694-41f0-9685-ff5bb260df2e';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const within = (root, path) => {
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

/** Synchronously collect one read-only native snapshot inside this run's evidence
 * directory. Names are exactly 'start' and 'end'; existing evidence is refused.
 * The PowerShell process receives a workspace-relative path and never changes
 * host settings, certificate stores, display mode, power plans or applications. */
export function capturePerformanceHost(outputDirectory, name) {
  if (!['start', 'end'].includes(name)) throw new Error('Host snapshot name must be start or end');
  if (typeof outputDirectory !== 'string' || !outputDirectory.length)
    throw new Error('An evidence output directory is required');
  const evidenceRoot = realpathSync(join(workspaceDir, '.artifacts/11.4'));
  const directory = resolve(workspaceDir, outputDirectory);
  if (!within(resolve(workspaceDir, '.artifacts/11.4'), directory))
    throw new Error('Host snapshots must stay in a run directory inside .artifacts/11.4');
  mkdirSync(directory, { recursive: true });
  const actualDirectory = realpathSync(directory);
  if (!within(evidenceRoot, actualDirectory))
    throw new Error('Resolved host snapshot directory escapes .artifacts/11.4');
  const destination = join(actualDirectory, `host-${name}.json`);
  if (existsSync(destination))
    throw new Error('Use a new host snapshot path; evidence is immutable');
  const workspaceRelativeOutput = relative(workspaceDir, destination);
  if (isAbsolute(workspaceRelativeOutput) || workspaceRelativeOutput.startsWith('..'))
    throw new Error('Host capture output must be workspace-relative');
  execFileSync(
    'pwsh.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(workspaceDir, 'scripts/performance-host.ps1'),
      '-OutputPath',
      workspaceRelativeOutput,
    ],
    { cwd: workspaceDir, encoding: 'utf8', windowsHide: true, timeout: 60000 },
  );
  return JSON.parse(readFileSync(destination, 'utf8').replace(/^\uFEFF/, ''));
}

const uint32 = (value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const int32 = (value) => Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
const validAdapter = (value) =>
  uint32(value?.adapterLowPart) && int32(value?.adapterHighPart) && uint32(value?.id);
const validPixels = (value) =>
  uint32(value?.widthPixels) &&
  value.widthPixels > 0 &&
  uint32(value?.heightPixels) &&
  value.heightPixels > 0;
const adapterKey = (value) => `${value.adapterHighPart}:${value.adapterLowPart}:${value.id}`;
const gcd = (left, right) => {
  while (right !== 0) [left, right] = [right, left % right];
  return left;
};
const rateKey = (value) => {
  const divisor = gcd(value.numerator, value.denominator);
  return `${value.numerator / divisor}/${value.denominator / divisor}`;
};
const schemeGuid = (host) => {
  const explicit = host?.power?.schemeGuid;
  if (typeof explicit === 'string') return GUID.test(explicit) ? explicit.toLowerCase() : null;
  return typeof host?.power?.scheme === 'string'
    ? (host.power.scheme
        .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
        ?.toLowerCase() ?? null)
    : null;
};

function inspectEndpoint(host) {
  const displays = Array.isArray(host?.display?.activeDisplays) ? host.display.activeDisplays : [];
  const rates = displays.length
    ? displays.map((entry) => entry?.hz)
    : Array.isArray(host?.display?.activeRefreshRates)
      ? host.display.activeRefreshRates.map((entry) => entry?.hz)
      : [host?.display?.refreshHz];
  const validIdentity =
    displays.length > 0 &&
    displays.every(
      (entry) => entry?.active === true && validAdapter(entry.source) && validAdapter(entry.target),
    );
  const identities = validIdentity
    ? displays.map((entry) => `${adapterKey(entry.source)}->${adapterKey(entry.target)}`).sort()
    : [];
  const completeDimensions =
    validIdentity &&
    displays.every((entry) => validPixels(entry.source) && validPixels(entry.target));
  const completeRationalRates =
    displays.length > 0 &&
    displays.every(
      (entry) =>
        uint32(entry?.numerator) &&
        entry.numerator > 0 &&
        uint32(entry?.denominator) &&
        entry.denominator > 0 &&
        Number.isFinite(entry.hz) &&
        Math.abs(entry.hz - entry.numerator / entry.denominator) <= 1e-9,
    );
  const uniqueIdentity = identities.length > 0 && new Set(identities).size === identities.length;
  const at = host?.collectedAtUtc ?? host?.collectedAt ?? null;
  const rows =
    validIdentity && completeDimensions && completeRationalRates && uniqueIdentity
      ? displays
          .map((entry) => ({
            identity: `${adapterKey(entry.source)}->${adapterKey(entry.target)}`,
            dimensions: `${entry.source.widthPixels}x${entry.source.heightPixels}->${entry.target.widthPixels}x${entry.target.heightPixels}`,
            refresh: rateKey(entry),
          }))
          .sort((left, right) => left.identity.localeCompare(right.identity))
      : [];
  const checks = {
    present: !!host && typeof host === 'object',
    referenceMachine: host?.model === '83KY' && /275HX/.test(host?.cpu ?? ''),
    acPower: host?.power?.acLineStatus === 1,
    balancedPowerPlan: schemeGuid(host) === BALANCED_GUID,
    referenceRefresh:
      rates.length > 0 &&
      rates.every((rate) => Number.isFinite(rate) && rate >= 59.9 && rate <= 60.1),
    activeDisplayIdentity: validIdentity && uniqueIdentity,
    physicalPixelDimensions: completeDimensions,
    preciseRefreshMetadata: completeRationalRates,
    recordedTime: typeof at === 'string' && Number.isFinite(Date.parse(at)),
  };
  return {
    checks,
    satisfied: Object.values(checks).every(Boolean),
    collectedAt: at,
    observedRefreshHz: rates,
    activeDisplays: rows,
    schemeGuid: schemeGuid(host),
  };
}

/** Qualify BOTH endpoint snapshots. A single old snapshot cannot certify a run.
 * Per-page viewport, foreground state, browser and actual paint remain separate
 * controls; matching endpoints cannot exclude a temporary intervening change. */
export function qualifyPerformanceHost(start, end) {
  const first = inspectEndpoint(start);
  const last = inspectEndpoint(end);
  const rowsEqual = (field) =>
    first.activeDisplays.length > 0 &&
    first.activeDisplays.length === last.activeDisplays.length &&
    first.activeDisplays.every(
      (entry, index) => entry[field] === last.activeDisplays[index][field],
    );
  const checks = {
    startQualified: first.satisfied,
    endQualified: last.satisfied,
    referenceMachine: first.checks.referenceMachine && last.checks.referenceMachine,
    acPower: first.checks.acPower && last.checks.acPower,
    balancedPowerPlan: first.checks.balancedPowerPlan && last.checks.balancedPowerPlan,
    referenceRefresh: first.checks.referenceRefresh && last.checks.referenceRefresh,
    chronologicalSpan:
      first.checks.recordedTime &&
      last.checks.recordedTime &&
      Date.parse(last.collectedAt) > Date.parse(first.collectedAt),
    unchangedActiveDisplayIdentity: rowsEqual('identity'),
    unchangedPhysicalPixelDimensions: rowsEqual('dimensions'),
    unchangedPreciseRefresh: rowsEqual('refresh'),
  };
  return {
    checks,
    satisfied: Object.values(checks).every(Boolean),
    endpoints: { start: first, end: last },
    observedRefreshHz: { start: first.observedRefreshHz, end: last.observedRefreshHz },
    collectedAt: { start: first.collectedAt, end: last.collectedAt },
    boundary:
      'Both recorded endpoints must satisfy the reference machine, AC power, Balanced GUID and approximately 60 Hz, and preserve the active source/target adapter-ID display paths, physical pixel dimensions and exact rational refresh rates. Display identity is an adapter path, not an EDID serial. Two matching endpoints alone cannot exclude transient changes between captures, prove an idle OS, physical frame presentation, per-sample foreground state or public hosting.',
  };
}
