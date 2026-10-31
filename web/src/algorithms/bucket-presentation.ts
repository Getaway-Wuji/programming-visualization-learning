import type { AlgorithmState, AlgorithmStep } from '../engine/algorithm-protocol';
import type { BucketLayout } from './content';
import { slotValue } from './presentation';

/** Layout projection only: no input sequence, bucket mapping or sorting is evaluated here. */
export function bucketRows(
  state: AlgorithmState,
  step: AlgorithmStep | null,
  layout: BucketLayout,
) {
  const data = state.objects.find((o) => o.name === layout.dataObject),
    sizes = state.objects.find((o) => o.name === layout.sizesObject);
  if (!data) return null;
  const writes = new Set(
    (step?.changes ?? []).flatMap((c) =>
      c.op === 'cell' && c.objectId === data.id ? [c.index] : [],
    ),
  );
  return layout.ranges.map((range, bucket) => {
    const offset = bucket * layout.bucketCapacity,
      size = sizes ? slotValue(sizes, bucket) : null,
      cells = [];
    for (let index = 0; index < layout.bucketCapacity; index++) {
      const physicalIndex = offset + index;
      if ((size !== null && index < size) || writes.has(physicalIndex))
        cells.push({
          index,
          physicalIndex,
          value: slotValue(data, physicalIndex),
          write: writes.has(physicalIndex),
          pending: size === null || index >= size,
        });
    }
    return {
      bucket,
      range,
      offset,
      size,
      cells,
      objectId: data.id,
      baseAddress: data.baseAddress + offset * 4,
      endAddress: data.baseAddress + (offset + layout.bucketCapacity) * 4,
      sizeWrite: Boolean(
        sizes &&
        step?.changes.some((c) => c.op === 'cell' && c.objectId === sizes.id && c.index === bucket),
      ),
    };
  });
}
