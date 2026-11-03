import { isLoadedC6LearningIndex } from '../c6-learning';
import type { C6LearningIndex } from '../c6-learning';
import { StorageError } from './errors';

declare const activation: unique symbol;
export interface C6StorageActivation {
  readonly [activation]: true;
}
const activations = new WeakMap<object, C6LearningIndex>();

/** A content activation capability is issued only after the pinned HTTP load, not for a DTO. */
export function createC6StorageActivation(index: C6LearningIndex): C6StorageActivation {
  if (!isLoadedC6LearningIndex(index)) throw new StorageError('S_CONTENT_INCOMPATIBLE');
  const token = Object.freeze({}) as C6StorageActivation;
  activations.set(token, index);
  return token;
}
export function c6ActivationIndex(token: C6StorageActivation): C6LearningIndex {
  const index = activations.get(token);
  if (!index) throw new StorageError('S_CONTENT_INCOMPATIBLE');
  return index;
}
