import rawPolicy from '../../../content/c/permissions/block-permissions-1.0.0.json?raw';
import type { Ref, StorageSnapshot } from '../storage/model';
import type { BlockProgram } from './model';
import type { TeachingBlockKind } from './block-kinds';
import { BLOCK_TYPES } from './block-kinds';
import type { BlockWorkspaceDraft } from './workspace';

export interface PermissionRule {
  packageRef: Ref;
  lessonRef: Ref;
  learningRevision: number;
  title: string;
  knowledgeRefs: Ref[];
  blocks: TeachingBlockKind[];
}
export const blockPermissionPolicy = JSON.parse(rawPolicy) as {
  permissionVersion: '1.0.0';
  sources: { path: string; sha256: string }[];
  rules: PermissionRule[];
};
if (
  blockPermissionPolicy.permissionVersion !== '1.0.0' ||
  blockPermissionPolicy.rules.length !== 38 ||
  blockPermissionPolicy.rules.some(
    (rule) =>
      !Number.isSafeInteger(rule.learningRevision) ||
      rule.learningRevision < 1 ||
      rule.blocks.length === 0 ||
      new Set(rule.blocks).size !== rule.blocks.length ||
      rule.blocks.some((kind) => !BLOCK_TYPES.includes(kind)),
  )
)
  throw new Error('BLOCK_PERMISSION_POLICY');
export interface BlockAccess {
  available: boolean;
  permanent: readonly TeachingBlockKind[];
  temporary: readonly TeachingBlockKind[];
  allowed: readonly TeachingBlockKind[];
}
const same = (a: Ref, b: Ref) => a.id === b.id && a.version === b.version;

/** A learning link must exist in the active course, including the original fallback. */
export function blockLearningLesson(packageRef: Ref, kind: TeachingBlockKind) {
  return blockPermissionPolicy.rules.find(
    (rule) => same(rule.packageRef, packageRef) && rule.blocks.includes(kind),
  );
}

/** Durable completion rows are the local grants. Never pass an optimistic projection here. */
export function resolveBlockAccess(
  packageRef: Ref,
  lessonRef: Ref,
  snapshot: StorageSnapshot | null,
): BlockAccess {
  const rule = blockPermissionPolicy.rules.find(
    (entry) => same(entry.packageRef, packageRef) && same(entry.lessonRef, lessonRef),
  );
  const permanent = new Set<TeachingBlockKind>();
  for (const row of snapshot?.progress ?? []) {
    if (row.eventType !== 'lesson.completed' || row.result !== 'completed') continue;
    const grant = blockPermissionPolicy.rules.find(
      (entry) =>
        same(entry.packageRef, row.packageRef) &&
        same(entry.lessonRef, row.subjectRef) &&
        entry.learningRevision === row.learningRevision,
    );
    for (const kind of grant?.blocks ?? []) permanent.add(kind);
  }
  const temporary = rule?.blocks.filter((kind) => !permanent.has(kind)) ?? [];
  return {
    available: !!rule,
    permanent: [...permanent],
    temporary,
    allowed: rule ? [...new Set([...permanent, ...temporary])] : [],
  };
}

/** Check the real mapped IR and detached native blocks, without parsing source code. */
export function lockedProgramKinds(
  program: BlockProgram,
  access: BlockAccess,
  draft?: BlockWorkspaceDraft,
): TeachingBlockKind[] {
  const locked = new Set<TeachingBlockKind>();
  const inputIds = new Set<string>();
  const visit = (value: unknown, native: boolean) => {
    const pending: unknown[] = [value];
    let count = 0;
    while (pending.length) {
      if (++count > 1000000) throw new Error('BLOCK_PERMISSION_LIMIT');
      const node = pending.pop();
      if (!node || typeof node !== 'object') continue;
      const row = node as Record<string, unknown>;
      if (!native && row.kind === 'input' && typeof row.id === 'string') inputIds.add(row.id);
      const kind = native
        ? typeof row.type === 'string' && row.type.startsWith('cv_')
          ? row.type.slice(3)
          : null
        : typeof row.kind === 'string' && row.kind !== 'input'
          ? row.kind
          : null;
      if (
        kind &&
        !(native && typeof row.id === 'string' && inputIds.has(row.id)) &&
        !access.allowed.includes(kind as TeachingBlockKind)
      )
        locked.add(kind as TeachingBlockKind);
      pending.push(...Object.values(row).filter((child) => child && typeof child === 'object'));
    }
  };
  visit(program, false);
  if (draft) visit(draft, true);
  return [...locked];
}
