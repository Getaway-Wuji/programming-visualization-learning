import type {
  MemoryFrame,
  MemoryObject,
  MemoryResult,
  MemoryState,
} from '../engine/memory-protocol';
import { memorySlots, memoryValueText } from '../memory/presentation';

export function sourceLine(source: string, nodeId: string | null, result: MemoryResult) {
  const node = result.nodeMap.find((item) => item.nodeId === nodeId);
  if (!node) return null;
  const prefix = new TextDecoder().decode(
    new TextEncoder().encode(source).slice(0, node.byteRange.start),
  );
  return prefix.split(/\r\n|\r|\n/).length;
}
export function stackTransition(state: MemoryState, previous: MemoryState | null) {
  return {
    entered: state.frames.filter((frame) => !previous?.frames.some((old) => old.id === frame.id)),
    returned:
      previous?.frames.filter(
        (frame) => !state.frames.some((current) => current.id === frame.id),
      ) ?? [],
  };
}
export interface StackBinding {
  name: string;
  kind: 'parameter' | 'local' | 'alias';
  scopeId: string;
  object: MemoryObject;
}
/** Frame membership and aliases come from the accepted state, never from source evaluation. */
export function frameBindings(
  frame: MemoryFrame,
  state: MemoryState,
  result: MemoryResult,
): StackBinding[] {
  const kinds = new Map(result.nodeMap.map((node) => [node.nodeId, node.kind]));
  const bindings: StackBinding[] = state.objects
    .filter(
      (object) =>
        object.alive && object.frameId === frame.id && frame.scopeIds.includes(object.scopeId!),
    )
    .map((object) => ({
      name: object.name,
      kind: kinds.get(object.declarationNodeId) === 'parameter' ? 'parameter' : 'local',
      scopeId: object.scopeId!,
      object,
    }));
  for (const scope of state.scopes.filter((scope) => scope.frameId === frame.id))
    for (const alias of scope.aliases) {
      const object = state.objects.find((object) => object.id === alias.objectId && object.alive);
      if (object) bindings.push({ name: alias.name, kind: 'alias', scopeId: scope.id, object });
    }
  return bindings;
}
export function bindingValues(binding: StackBinding, state: MemoryState, result: MemoryResult) {
  return memorySlots(binding.object, result.types)
    .map((slot) => {
      const suffix = slot.name.slice(binding.object.name.length);
      return `${binding.name}${suffix}: ${memoryValueText(slot.value, state)}`;
    })
    .join('；');
}
