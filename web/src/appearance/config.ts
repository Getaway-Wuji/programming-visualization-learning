import configurationJson from '../../../content/c/appearance/config-1.0.1.json?raw';

export const APPEARANCE_THEME_IDS = ['minimal', 'cute', 'glass', 'soft', 'cool', 'tech'] as const;
export type AppearanceThemeId = (typeof APPEARANCE_THEME_IDS)[number];
export type AppearanceMode = 'light' | 'dark';
export interface AppearancePalette {
  readonly ground: string;
  readonly surface: string;
  readonly raised: string;
  readonly active: string;
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  readonly control: string;
  readonly accent: string;
  readonly positive: string;
  readonly negative: string;
  readonly warning: string;
}
const profiles = {
  minimal: ['paper', 'sidebar-text', 'academy-sheet', 'flat', 'ink', 'quiet'],
  cute: ['jelly', 'sidebar-text', 'liquid-glass', 'elastic-capsule', 'crystal', 'soft-spring'],
  glass: ['ambient', 'sidebar-text', 'frosted-pane', 'frosted-pill', 'clear', 'float-feedback'],
  soft: ['tactile', 'sidebar-text', 'soft-relief', 'pressed-key', 'relief', 'gentle-press'],
  cool: ['theater', 'sidebar-text', 'sharp-stage', 'sharp-key', 'stage', 'crisp'],
  tech: ['mist', 'sidebar-text', 'airy-relief', 'soft-key', 'airy', 'soft-shift'],
} as const;
const profileKeys = ['shell', 'navigation', 'panel', 'control', 'chart', 'motion'] as const;
export interface AppearanceTheme {
  readonly label: string;
  readonly defaultMode: AppearanceMode;
  /** Base fallbacks only; the fixed profile defines per-component geometry. */
  readonly panelRadius: number;
  readonly controlRadius: number;
  readonly density: 'comfortable' | 'relaxed' | 'compact';
  readonly light: AppearancePalette;
  readonly dark: AppearancePalette;
  readonly profile: Readonly<Record<(typeof profileKeys)[number], string>>;
}
export interface AppearanceConfiguration {
  readonly contractVersion: '1.0.0';
  readonly schemaVersion: '1.0.0';
  readonly configRef: { readonly id: 'appearance.config.p05'; readonly version: '1.0.1' };
  readonly defaultPreset: 'minimal';
  readonly defaultMode: 'light';
  readonly fonts: { readonly ui: string; readonly code: string };
  readonly layout: Readonly<Record<(typeof layoutKeys)[number], number>> & {
    readonly splitRatios: {
      readonly practice: number;
      readonly visualize: number;
      readonly review: number;
    };
  };
  readonly typography: Readonly<Record<(typeof typographyKeys)[number], number>>;
  readonly motion: Readonly<Record<(typeof motionKeys)[number], number>> & {
    readonly automaticEntrance: false;
    readonly continuousDecoration: false;
  };
  readonly contrast: {
    readonly textMin: 4.5;
    readonly largeTextMin: 3;
    readonly focusAndDataMin: 3;
    readonly selectedMarkerMin: 3;
  };
  readonly themes: Readonly<Record<AppearanceThemeId, AppearanceTheme>>;
  readonly backgroundPolicy: {
    readonly preset: 'solid-or-restrained-gradient';
    readonly sceneImages: false;
    readonly photoIllustrations: false;
  };
}
export interface AppearanceConfigurationLoad {
  readonly status: 'ready' | 'fallback';
  readonly configuration: AppearanceConfiguration | null;
  readonly fallbackTheme: AppearanceTheme;
  readonly errorCode:
    null | 'APPEARANCE_CONFIGURATION_INVALID' | 'APPEARANCE_CONFIGURATION_UNAVAILABLE';
}
const paletteKeys = [
  'ground',
  'surface',
  'raised',
  'active',
  'text',
  'muted',
  'border',
  'control',
  'accent',
  'positive',
  'negative',
  'warning',
] as const;
const layoutKeys = [
  'gutter',
  'desktopPadding',
  'mobilePadding',
  'readableTextMax',
  'codePaneMin',
  'chartPaneMin',
  'stackBelow',
  'mobileBelow',
  'controlHeight',
  'touchTargetMin',
  'splitRatioMin',
  'splitRatioMax',
] as const;
const typographyKeys = [
  'title',
  'section',
  'body',
  'controls',
  'meta',
  'code',
  'bodyLineHeight',
  'codeLineHeight',
] as const;
const motionKeys = [
  'quietMs',
  'softSpringMs',
  'crispMs',
  'scanPulseMs',
  'reducedMotionMs',
] as const;
const labels: Record<AppearanceThemeId, string> = {
  minimal: '清爽 · 代码学园',
  cute: '粉晶 · 流体花园',
  glass: '珍珠 · 磨砂书桌',
  soft: '暖光 · 触感工坊',
  cool: '深蓝 · 流光空间',
  tech: '轻雾 · 灵感实验室',
};
const uiFont = "'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif";
const codeFont = "'Cascadia Code', Consolas, 'Liberation Mono', monospace";
function requireRule(condition: unknown): asserts condition {
  if (!condition) throw new Error('APPEARANCE_CONFIGURATION_INVALID');
}
function row(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  requireRule(
    value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype,
  );
  const keys = Reflect.ownKeys(value);
  requireRule(
    keys.length === fields.length &&
      keys.every((key) => typeof key === 'string' && fields.includes(key)),
  );
  requireRule(
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (entry) => 'value' in entry && entry.enumerable,
    ),
  );
}
function integer(value: unknown, min: number, max: number) {
  requireRule(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max);
}
function color(value: unknown): asserts value is string {
  requireRule(typeof value === 'string' && /^#[0-9A-F]{6}$/.test(value));
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function palette(value: unknown) {
  row(value, paletteKeys);
  paletteKeys.forEach((key) => color(value[key]));
  for (const background of ['ground', 'surface', 'raised'] as const) {
    requireRule(contrastRatio(value.text as string, value[background] as string) >= 4.5);
    requireRule(contrastRatio(value.muted as string, value[background] as string) >= 4.5);
  }
  requireRule(contrastRatio(value.control as string, value.surface as string) >= 3);
}

/** Decodes appearance rights only. No content, program, reward or arbitrary CSS is accepted. */
export function decodeAppearanceConfiguration(value: unknown): AppearanceConfiguration {
  row(value, [
    'contractVersion',
    'schemaVersion',
    'configRef',
    'defaultPreset',
    'defaultMode',
    'fonts',
    'layout',
    'typography',
    'motion',
    'contrast',
    'themes',
    'backgroundPolicy',
  ]);
  requireRule(value.contractVersion === '1.0.0' && value.schemaVersion === '1.0.0');
  row(value.configRef, ['id', 'version']);
  requireRule(
    value.configRef.id === 'appearance.config.p05' && value.configRef.version === '1.0.1',
  );
  requireRule(value.defaultPreset === 'minimal' && value.defaultMode === 'light');
  row(value.fonts, ['ui', 'code']);
  requireRule(value.fonts.ui === uiFont && value.fonts.code === codeFont);
  row(value.layout, [...layoutKeys, 'splitRatios']);
  const layout = value.layout;
  layoutKeys.forEach((key) => integer(layout[key], 0, 1920));
  requireRule(layout.gutter === 16 && layout.desktopPadding === 24 && layout.mobilePadding === 16);
  requireRule(
    layout.readableTextMax === 760 && layout.codePaneMin === 340 && layout.chartPaneMin === 420,
  );
  requireRule(layout.stackBelow === 1100 && layout.mobileBelow === 640);
  requireRule(layout.controlHeight === 36 && layout.touchTargetMin === 44);
  requireRule(layout.splitRatioMin === 30 && layout.splitRatioMax === 70);
  row(layout.splitRatios, ['practice', 'visualize', 'review']);
  requireRule(
    layout.splitRatios.practice === 50 &&
      layout.splitRatios.visualize === 35 &&
      layout.splitRatios.review === 35,
  );
  row(value.typography, typographyKeys);
  for (const key of typographyKeys) {
    const number = value.typography[key];
    if (key === 'bodyLineHeight' || key === 'codeLineHeight')
      requireRule(
        typeof number === 'number' && Number.isFinite(number) && number >= 1.5 && number <= 2,
      );
    else integer(number, 12, 36);
  }
  row(value.motion, [...motionKeys, 'automaticEntrance', 'continuousDecoration']);
  const motion = value.motion;
  motionKeys.forEach((key) => integer(motion[key], 0, 600));
  requireRule(
    motion.reducedMotionMs === 0 &&
      motion.automaticEntrance === false &&
      motion.continuousDecoration === false,
  );
  row(value.contrast, ['textMin', 'largeTextMin', 'focusAndDataMin', 'selectedMarkerMin']);
  requireRule(
    value.contrast.textMin === 4.5 &&
      value.contrast.largeTextMin === 3 &&
      value.contrast.focusAndDataMin === 3 &&
      value.contrast.selectedMarkerMin === 3,
  );
  row(value.backgroundPolicy, ['preset', 'sceneImages', 'photoIllustrations']);
  requireRule(
    value.backgroundPolicy.preset === 'solid-or-restrained-gradient' &&
      value.backgroundPolicy.sceneImages === false &&
      value.backgroundPolicy.photoIllustrations === false,
  );
  row(value.themes, APPEARANCE_THEME_IDS);
  for (const id of APPEARANCE_THEME_IDS) {
    const theme = value.themes[id];
    row(theme, [
      'label',
      'defaultMode',
      'panelRadius',
      'controlRadius',
      'density',
      'light',
      'dark',
      'profile',
    ]);
    requireRule(
      theme.label === labels[id] && theme.defaultMode === (id === 'cool' ? 'dark' : 'light'),
    );
    integer(theme.panelRadius, 0, 40);
    integer(theme.controlRadius, 0, 32);
    requireRule(
      theme.density ===
        (id === 'cute' ? 'relaxed' : id === 'cool' || id === 'tech' ? 'compact' : 'comfortable'),
    );
    row(theme.profile, profileKeys);
    profileKeys.forEach((key, index) =>
      requireRule((theme.profile as Record<string, unknown>)[key] === profiles[id][index]),
    );
    palette(theme.light);
    palette(theme.dark);
  }
  return frozen(structuredClone(value) as unknown as AppearanceConfiguration);
}

const fallbackTheme: AppearanceTheme = frozen({
  label: labels.minimal,
  defaultMode: 'light',
  panelRadius: 4,
  controlRadius: 4,
  density: 'comfortable',
  profile: {
    shell: 'paper',
    navigation: 'sidebar-text',
    panel: 'academy-sheet',
    control: 'flat',
    chart: 'ink',
    motion: 'quiet',
  },
  light: {
    ground: '#F3F5F7',
    surface: '#FFFFFF',
    raised: '#F7F8FA',
    active: '#E8EBEF',
    text: '#18212B',
    muted: '#566170',
    border: '#DFE4E9',
    control: '#7C8797',
    accent: '#1D5FBF',
    positive: '#146C43',
    negative: '#B42318',
    warning: '#875600',
  },
  dark: {
    ground: '#101112',
    surface: '#191B1D',
    raised: '#232629',
    active: '#30353B',
    text: '#F2F4F6',
    muted: '#B8C0CA',
    border: '#353A41',
    control: '#7E8A98',
    accent: '#82B1FF',
    positive: '#71D5A3',
    negative: '#FFAAA3',
    warning: '#E9C171',
  },
});
export async function loadAppearanceConfiguration(
  loader: () => Promise<unknown> = async () => JSON.parse(configurationJson) as unknown,
): Promise<AppearanceConfigurationLoad> {
  let candidate: unknown;
  try {
    candidate = await loader();
  } catch {
    return {
      status: 'fallback',
      configuration: null,
      fallbackTheme,
      errorCode: 'APPEARANCE_CONFIGURATION_UNAVAILABLE',
    };
  }
  try {
    return {
      status: 'ready',
      configuration: decodeAppearanceConfiguration(candidate),
      fallbackTheme,
      errorCode: null,
    };
  } catch {
    return {
      status: 'fallback',
      configuration: null,
      fallbackTheme,
      errorCode: 'APPEARANCE_CONFIGURATION_INVALID',
    };
  }
}
/** A broken resource selects only the internal paper view; saved preferences are never mutated. */
export function resolveAppearanceTheme(
  configuration: AppearanceConfiguration | null,
  preset: AppearanceThemeId,
) {
  return configuration
    ? { effectivePreset: preset, theme: configuration.themes[preset] }
    : { effectivePreset: 'minimal' as const, theme: fallbackTheme };
}
function luminance(hex: string) {
  color(hex);
  const [red, green, blue] = [1, 3, 5].map((index) => {
    const component = parseInt(hex.slice(index, index + 2), 16) / 255;
    return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
export function contrastRatio(first: string, second: string): number {
  const left = luminance(first),
    right = luminance(second);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}
export function deriveAppearanceColors(
  colors: AppearancePalette,
  requestedHex: string | null,
  mode: AppearanceMode,
) {
  const rawAccent = requestedHex ?? colors.accent;
  color(rawAccent);
  requireRule(mode === 'light' || mode === 'dark');
  const target = mode === 'dark' ? '#FFFFFF' : '#000000';
  let accent = target;
  for (let step = 0; step <= 100; step++) {
    const fraction = step / 100;
    const candidate =
      '#' +
      [1, 3, 5]
        .map((index) =>
          Math.round(
            parseInt(rawAccent.slice(index, index + 2), 16) * (1 - fraction) +
              parseInt(target.slice(index, index + 2), 16) * fraction,
          )
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
        .toUpperCase();
    if (
      [colors.ground, colors.surface, colors.raised, colors.active].every(
        (background) => contrastRatio(candidate, background) >= 4.5,
      )
    ) {
      accent = candidate;
      break;
    }
  }
  const on = (background: string) =>
    contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#000000')
      ? '#FFFFFF'
      : '#000000';
  return Object.freeze({ rawAccent, accent, accentOn: on(accent), materialOn: on(rawAccent) });
}
