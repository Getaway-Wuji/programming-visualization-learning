import type { C6TeachingRepository } from '../../web/src/content/c6-teaching-repository';
import type { C6TeachingNode } from '../../web/src/content/c6-teaching-types';
export interface C6TeachingHarness {
  readonly repository: C6TeachingRepository;
  render(text: string): void;
  show(sourceNodeId: string): Promise<C6TeachingNode>;
}
declare global {
  interface Window {
    c6Teaching: C6TeachingHarness;
  }
}
