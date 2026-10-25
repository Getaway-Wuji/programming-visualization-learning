import profileJson from '../../../content/profile/p0-1.0.0.json?raw';
import type { Ref } from '../storage/model';

export type AvatarShapeId = 'leaf' | 'sprout' | 'block' | 'star';
export interface AvatarPreset {
  readonly presetId: string;
  readonly label: string;
  readonly shapeId: AvatarShapeId;
}
export interface ProfileLevel {
  readonly level: number;
  readonly title: string;
  readonly minimumPoints: string;
}
export interface ProfileConfiguration {
  readonly configRef: Readonly<Ref>;
  readonly avatars: readonly AvatarPreset[];
  readonly levels: readonly ProfileLevel[];
}
export interface LearningLevel extends ProfileLevel {
  readonly nextThreshold: string | null;
  readonly remainingPoints: string;
  /** Whole percentage within the current level; the highest level is 100. */
  readonly progressPercent: number;
}

function requireRule(condition: unknown): asserts condition {
  if (!condition) throw new Error('PROFILE_CONFIGURATION_INVALID');
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
function list(value: unknown): asserts value is unknown[] {
  requireRule(
    Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      Reflect.ownKeys(value).length === value.length + 1,
  );
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireRule(descriptor && 'value' in descriptor && descriptor.enumerable);
  }
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
const reviewedAvatars = [
  ['avatar.basic.01', '嫩叶', 'leaf'],
  ['avatar.basic.02', '芽苗', 'sprout'],
  ['avatar.basic.03', '方块', 'block'],
  ['avatar.basic.04', '星光', 'star'],
] as const;
const reviewedLevels = [
  [1, '学习新芽', '0'],
  [2, '开始探索', '30'],
  [3, '稳步前进', '100'],
  [4, '持续实践', '200'],
  [5, '学习同行', '400'],
] as const;

/** This local capability grants profile choices only, never content or reward rights. */
export function decodeProfileConfiguration(value: unknown): ProfileConfiguration {
  row(value, ['configRef', 'avatars', 'levels']);
  row(value.configRef, ['id', 'version']);
  requireRule(value.configRef.id === 'profile.config.p0' && value.configRef.version === '1.0.0');
  list(value.avatars);
  list(value.levels);
  requireRule(
    value.avatars.length === reviewedAvatars.length &&
      value.levels.length === reviewedLevels.length,
  );
  value.avatars.forEach((avatar, index) => {
    row(avatar, ['presetId', 'label', 'shapeId']);
    const [presetId, label, shapeId] = reviewedAvatars[index];
    requireRule(
      avatar.presetId === presetId && avatar.label === label && avatar.shapeId === shapeId,
    );
  });
  value.levels.forEach((level, index) => {
    row(level, ['level', 'title', 'minimumPoints']);
    const [number, title, minimumPoints] = reviewedLevels[index];
    requireRule(
      level.level === number && level.title === title && level.minimumPoints === minimumPoints,
    );
  });
  return frozen(structuredClone(value) as unknown as ProfileConfiguration);
}
export async function loadProfileConfiguration(): Promise<ProfileConfiguration> {
  return decodeProfileConfiguration(JSON.parse(profileJson));
}

/** Derives display state from an already confirmed posted total; it performs no writes. */
export function deriveLearningLevel(
  totalPoints: string,
  configuration: ProfileConfiguration,
): LearningLevel {
  if (typeof totalPoints !== 'string' || !/^(0|[1-9][0-9]*)$/.test(totalPoints))
    throw new Error('PROFILE_POINTS_INVALID');
  const config = decodeProfileConfiguration(configuration);
  const points = BigInt(totalPoints);
  const index = config.levels.findLastIndex((level) => points >= BigInt(level.minimumPoints));
  const current = config.levels[index];
  const next = config.levels[index + 1];
  const minimum = BigInt(current.minimumPoints);
  const nextPoints = next ? BigInt(next.minimumPoints) : null;
  return frozen({
    ...current,
    nextThreshold: next?.minimumPoints ?? null,
    remainingPoints: nextPoints === null ? '0' : String(nextPoints - points),
    progressPercent:
      nextPoints === null ? 100 : Number(((points - minimum) * 100n) / (nextPoints - minimum)),
  });
}
