import { describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_THEME_IDS,
  contrastRatio,
  decodeAppearanceConfiguration,
  deriveAppearanceColors,
  loadAppearanceConfiguration,
  resolveAppearanceTheme,
  type AppearanceConfiguration,
  type AppearancePalette,
} from '../../web/src/appearance/config';

const loaded = await loadAppearanceConfiguration();
if (!loaded.configuration) throw new Error(`Bundled appearance failed: ${loaded.errorCode}`);
const config = loaded.configuration;
const copy = (): AppearanceConfiguration => structuredClone(config);

describe('P0.5-02 closed static appearance configuration', () => {
  it('loads six complete profiles without teaching capabilities or design fixture data', () => {
    expect(loaded.status).toBe('ready');
    expect(config.configRef).toEqual({ id: 'appearance.config.p05', version: '1.0.1' });
    expect(Object.keys(config.themes).sort()).toEqual([...APPEARANCE_THEME_IDS].sort());
    expect(new Set(Object.values(config.themes).map((theme) => theme.profile.shell)).size).toBe(6);
    expect(Object.isFrozen(config.themes.tech.dark)).toBe(true);
    expect(Object.isFrozen(config.themes.tech.profile)).toBe(true);
    expect(config).not.toHaveProperty('sampleLearning');
    expect(config).not.toHaveProperty('capabilities');
    expect(config).not.toHaveProperty('runtimePublished');
  });

  it('rejects unknown versions, missing themes and mixed profile rows', () => {
    const missing = copy();
    Reflect.deleteProperty(missing.themes, 'soft');
    const mixed = copy();
    Object.assign(mixed.themes.cute, { profile: mixed.themes.cool.profile });
    for (const candidate of [
      { ...config, contractVersion: '1.1.0' },
      { ...config, schemaVersion: '1.0.1' },
      { ...config, configRef: { ...config.configRef, version: '1.0.2' } },
      { ...config, capabilities: ['exercise.passed'] },
      { ...config, themes: { ...config.themes, future: config.themes.minimal } },
      missing,
      mixed,
    ])
      expect(() => decodeAppearanceConfiguration(candidate)).toThrow(
        'APPEARANCE_CONFIGURATION_INVALID',
      );
  });

  it('rejects arbitrary CSS, images, font URLs and inaccessible static text tokens', () => {
    const cases = [
      { ...config, fonts: { ...config.fonts, ui: 'url(https://example.com/font)' } },
      { ...config, backgroundPolicy: { ...config.backgroundPolicy, sceneImages: true } },
      {
        ...config,
        backgroundPolicy: { ...config.backgroundPolicy, image: 'data:image/svg+xml,x' },
      },
    ];
    for (const token of [
      'red',
      '#abcdef',
      'var(--secret)',
      'url(https://example.com)',
      '#FFFFFF;display:none',
    ]) {
      const candidate = copy();
      Object.assign(candidate.themes.minimal.light, { accent: token });
      cases.push(candidate);
    }
    const unreadable = copy();
    Object.assign(unreadable.themes.minimal.light, { text: '#FFFFFF' });
    cases.push(unreadable);
    for (const candidate of cases)
      expect(() => decodeAppearanceConfiguration(candidate)).toThrow(
        'APPEARANCE_CONFIGURATION_INVALID',
      );
  });

  it('rejects new layout/animation fields and unsafe numeric budgets', () => {
    for (const layout of [
      { ...config.layout, sidebar: 216 },
      { ...config.layout, splitRatioMax: 100 },
      { ...config.layout, codePaneMin: NaN },
      { ...config.layout, controlHeight: 36.5 },
    ])
      expect(() => decodeAppearanceConfiguration({ ...config, layout })).toThrow();
    for (const motion of [
      { ...config.motion, continuousDecoration: true },
      { ...config.motion, automaticEntrance: true },
      { ...config.motion, scanPulseMs: 601 },
      { ...config.motion, reducedMotionMs: 1 },
    ])
      expect(() => decodeAppearanceConfiguration({ ...config, motion })).toThrow();
  });

  it('does not invoke getters or accept inherited, hidden or symbolic fields', () => {
    const get = vi.fn(() => config.themes);
    const accessor = Object.defineProperty({ ...config }, 'themes', { get, enumerable: true });
    const inherited = Object.assign(Object.create({ capability: 'exercise.passed' }), config);
    const hidden = Object.defineProperty(copy(), 'extra', { value: true });
    const symbol = { ...config, [Symbol('extra')]: true };
    const nested = copy();
    Object.defineProperty(nested.themes.cute.profile, 'shell', { get, enumerable: true });
    for (const candidate of [accessor, inherited, hidden, symbol, nested])
      expect(() => decodeAppearanceConfiguration(candidate)).toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it('returns an internal paper fallback on malformed or unavailable configuration without changing preferences', async () => {
    const saved = Object.freeze({ preset: 'cute', color: '#123456', mode: 'dark' });
    const rejected = await loadAppearanceConfiguration(async () => ({
      ...config,
      schemaVersion: '9.0.0',
    }));
    const unavailable = await loadAppearanceConfiguration(async () => {
      throw new Error('private exception');
    });
    expect(rejected).toMatchObject({
      status: 'fallback',
      configuration: null,
      errorCode: 'APPEARANCE_CONFIGURATION_INVALID',
    });
    expect(unavailable).toMatchObject({
      status: 'fallback',
      configuration: null,
      errorCode: 'APPEARANCE_CONFIGURATION_UNAVAILABLE',
    });
    expect(resolveAppearanceTheme(rejected.configuration, saved.preset)).toMatchObject({
      effectivePreset: 'minimal',
      theme: { profile: { shell: 'paper' } },
    });
    expect(saved).toEqual({ preset: 'cute', color: '#123456', mode: 'dark' });
    expect(JSON.stringify(unavailable)).not.toContain('private exception');
    expect(
      contrastRatio(unavailable.fallbackTheme.dark.text, unavailable.fallbackTheme.dark.surface),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe('P0.5-02 readable accent derivation', () => {
  it('matches the standard black/white contrast endpoints', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatio('#123456', '#123456')).toBe(1);
  });

  it('keeps raw colors independent from derived text colors in every palette', () => {
    const originals = [
      '#FFFFFF',
      '#000000',
      '#FF0000',
      '#00FF00',
      '#0000FF',
      '#808080',
      '#DB2777',
      '#6D28D9',
    ];
    for (const id of APPEARANCE_THEME_IDS)
      for (const mode of ['light', 'dark'] as const)
        for (const raw of originals) {
          const palette: AppearancePalette = config.themes[id][mode];
          const before = structuredClone(palette);
          const result = deriveAppearanceColors(palette, raw, mode);
          expect(result.rawAccent).toBe(raw);
          for (const background of [
            palette.ground,
            palette.surface,
            palette.raised,
            palette.active,
          ])
            expect(contrastRatio(result.accent, background)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(result.accentOn, result.accent)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(result.materialOn, result.rawAccent)).toBeGreaterThanOrEqual(4.5);
          expect(palette).toEqual(before);
          expect(Object.isFrozen(result)).toBe(true);
        }
  });

  it('uses a mode-specific default only for null and never modifies the supplied override', () => {
    const overrides = { minimal: '#6D28D9', cute: '#DB2777' };
    expect(deriveAppearanceColors(config.themes.minimal.light, null, 'light').rawAccent).toBe(
      '#1D5FBF',
    );
    expect(deriveAppearanceColors(config.themes.minimal.dark, null, 'dark').rawAccent).toBe(
      '#82B1FF',
    );
    deriveAppearanceColors(config.themes.cute.dark, overrides.cute, 'dark');
    deriveAppearanceColors(config.themes.minimal.light, overrides.minimal, 'light');
    expect(overrides).toEqual({ minimal: '#6D28D9', cute: '#DB2777' });
  });

  it.each(['', 'red', '#fff', '#abcdef', '#ABCDEF00', 'var(--accent)', '#FFFFFF;'])(
    'rejects unsafe/noncanonical color %s',
    (value) => {
      expect(() => deriveAppearanceColors(config.themes.minimal.light, value, 'light')).toThrow();
    },
  );
});
