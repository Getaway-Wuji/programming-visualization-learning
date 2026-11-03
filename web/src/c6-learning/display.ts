import type { LearningServiceState } from '../learning/service';
import type { Ref } from '../storage/model';
export function c6ChapterForNode(state: LearningServiceState, nodeRef: Ref): string | null {
  if (nodeRef.version !== '2.0.0' || !state.c6?.manifest) return null;
  const nodes = state.c6.manifest.nodes;
  let node = nodes.find((n) => `node.${n.id}` === nodeRef.id);
  for (let depth = 0; node?.parentId && depth < 32; ++depth)
    node = nodes.find((n) => n.id === node!.parentId);
  return node && node.chunkId !== 'chA' && node.chunkId !== 'chB' ? `node.${node.id}` : null;
}

/** Resolve display metadata only; this never supplies or invents a teaching body. */
export function c6DisplayReference(state: LearningServiceState, ref: Ref) {
  if (ref.version !== '2.0.0' || !state.c6?.index || !state.c6.manifest) return null;
  const index = state.c6.index;
  const lesson = index.lessons.find((l) => l[0] === ref.id);
  const exercise = index.exercises.find((e) => e[0] === ref.id);
  const knowledge = index.knowledge.find((k) => k[0] === ref.id);
  const nodeRef = lesson?.[1] ?? exercise?.[1] ?? knowledge?.[1];
  const node = state.c6.manifest.nodes.find((n) => `node.${n.id}` === nodeRef);
  return node
    ? {
        node,
        title: node.titleDisplay,
        lessonId:
          lesson?.[0] ?? exercise?.[2] ?? index.lessons.find((l) => l[1] === nodeRef)?.[0] ?? null,
      }
    : null;
}
