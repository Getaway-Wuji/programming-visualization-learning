import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { useLearning } from '../learning/react';
import { defaultAppearance, type Appearance, type Settings, type ThemeId } from '../storage/model';
import {
  deriveAppearanceColors,
  loadAppearanceConfiguration,
  resolveAppearanceTheme,
  type AppearanceConfigurationLoad,
} from './config';

interface AppearanceDraft {
  revision: number;
  generation: string;
  epoch: number;
  preset?: ThemeId;
  mode?: Settings['theme'];
  colors: Partial<Record<ThemeId, string | null>>;
}
function mergeAppearance(saved: Appearance, draft: AppearanceDraft | null): Appearance {
  const appearance = structuredClone(saved);
  if (!draft) return appearance;
  if (draft.preset) appearance.preset = draft.preset;
  for (const [id, accentColor] of Object.entries(draft.colors)) {
    appearance.themeOverrides[id as ThemeId] = { accentColor: accentColor ?? null };
  }
  return appearance;
}
function useAppearanceState() {
  const { state, service } = useLearning();
  const [loaded, setLoaded] = useState<AppearanceConfigurationLoad | null>(null);
  const [draft, setDraft] = useState<AppearanceDraft | null>(null);
  const [inputEpoch, setInputEpoch] = useState(0);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const snapshot = state.snapshot;
  const activeDraft =
    draft && draft.generation === snapshot?.meta.generation && draft.epoch === state.sessionEpoch
      ? draft
      : null;
  const saved = snapshot?.appearance ?? defaultAppearance();
  const appearance = mergeAppearance(saved, activeDraft);
  const mode = activeDraft?.mode ?? snapshot?.settings.theme ?? 'light';
  const resolvedMode = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
  const { effectivePreset, theme } = resolveAppearanceTheme(
    loaded?.configuration ?? null,
    appearance.preset,
  );
  const palette = theme[resolvedMode];
  const colors = deriveAppearanceColors(
    palette,
    appearance.themeOverrides[effectivePreset].accentColor,
    resolvedMode,
  );
  const reloadConfiguration = async () => setLoaded(await loadAppearanceConfiguration());
  useEffect(() => {
    let live = true;
    void loadAppearanceConfiguration().then((result) => {
      if (live) setLoaded(result);
    });
    const media = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystemDark(media.matches);
    media.addEventListener('change', changed);
    return () => {
      live = false;
      media.removeEventListener('change', changed);
    };
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.appearance = effectivePreset;
    root.dataset.appearancePreference = appearance.preset;
    root.dataset.appearanceConfig = loaded?.status ?? 'loading';
    root.dataset.appearanceDraft = activeDraft ? 'true' : 'false';
    root.dataset.theme = resolvedMode;
    root.dataset.themePreference = mode;
    root.style.colorScheme = resolvedMode;
    Object.entries(palette).forEach(([name, value]) =>
      root.style.setProperty(`--p05-${name}`, value),
    );
    const aliases = {
      '--ink': palette.text,
      '--text-tone': palette.text,
      '--text-muted': palette.muted,
      '--muted': palette.muted,
      '--surface-tone': palette.surface,
      '--line': palette.border,
      '--green': colors.accent,
      '--green-dark': colors.accent,
      '--lime': palette.active,
      '--focus': colors.accent,
      '--amber': palette.warning,
      '--p05-accent': colors.accent,
      '--p05-accent-raw': colors.rawAccent,
      '--p05-accent-on': colors.accentOn,
      '--p05-material-on': colors.materialOn,
    };
    Object.entries(aliases).forEach(([name, value]) => root.style.setProperty(name, value));
  }, [
    effectivePreset,
    appearance.preset,
    activeDraft,
    loaded?.status,
    palette,
    colors.accent,
    colors.rawAccent,
    colors.accentOn,
    colors.materialOn,
    resolvedMode,
    mode,
  ]);
  const edit = (changes: Partial<Pick<AppearanceDraft, 'preset' | 'mode' | 'colors'>>) => {
    if (!snapshot) return;
    setDraft((current) => {
      const previous =
        current &&
        current.generation === snapshot.meta.generation &&
        current.epoch === state.sessionEpoch
          ? current
          : {
              revision: snapshot.meta.revision,
              generation: snapshot.meta.generation,
              epoch: state.sessionEpoch,
              colors: {},
            };
      return { ...previous, ...changes, colors: { ...previous.colors, ...changes.colors } };
    });
  };
  const discard = () => {
    setDraft(null);
    setInputEpoch((value) => value + 1);
  };
  const save = async () => {
    if (!snapshot || !activeDraft) return;
    const submitted = activeDraft;
    const value = mergeAppearance(snapshot.appearance, submitted);
    await service.saveAppearance(value, submitted.revision, submitted.mode);
    const current = service.getState();
    if (
      current.lastSaved &&
      current.status === 'ready' &&
      current.sessionEpoch === submitted.epoch &&
      current.snapshot?.meta.generation === submitted.generation
    ) {
      setDraft((previous) => (previous === submitted ? null : previous));
    }
  };
  const rebase = async () => {
    if (!activeDraft) return;
    const previous = activeDraft;
    await service.refresh();
    const current = service.getState();
    if (
      current.status === 'ready' &&
      current.snapshot?.meta.generation === previous.generation &&
      current.sessionEpoch === previous.epoch
    ) {
      setDraft((value) =>
        value === previous ? { ...value, revision: current.snapshot!.meta.revision } : value,
      );
    }
  };
  return {
    appearance,
    mode,
    resolvedMode,
    effectivePreset,
    theme,
    colors,
    loaded,
    draft: activeDraft,
    inputEpoch,
    edit,
    discard,
    save,
    rebase,
    reloadConfiguration,
  };
}
const AppearanceContext = createContext<ReturnType<typeof useAppearanceState> | null>(null);
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const value = useAppearanceState();
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('AppearanceProvider is required.');
  return value;
}
