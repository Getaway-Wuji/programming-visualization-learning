import { expect, test } from 'vitest';
import { preparationAssets } from '../../web/src/engine/preparation-assets';
import type { PreparationEngine } from '../../web/src/engine/preparation';

const engines: PreparationEngine[] = [
  'c',
  'c6',
  'practice',
  'memory',
  'algorithm',
  'advanced',
  'python',
  'java',
  'cpp',
  'rust',
  'mysql',
];

test.each(engines)(
  '%s initialization uses its actual execution singleton and bundled Worker URL',
  async (engine) => {
    const assets = await preparationAssets(engine);
    const stores = {
      c: async () => (await import('../../web/src/engine/module')).sharedModuleStore,
      c6: async () => (await import('../../web/src/engine/c6-module')).c6ModuleStore,
      practice: async () =>
        (await import('../../web/src/generated-practice/module')).practiceModuleStore,
      memory: async () => (await import('../../web/src/engine/memory-module')).memoryModuleStore,
      algorithm: async () =>
        (await import('../../web/src/engine/algorithm-module')).algorithmModuleStore,
      advanced: async () =>
        (await import('../../web/src/engine/advanced-module')).advancedModuleStore,
      python: async () => (await import('../../web/src/engine/python3-client')).python3ModuleStore,
      java: async () => (await import('../../web/src/engine/java-client')).javaModuleStore,
      cpp: async () =>
        (await import('../../web/src/engine/cpp-course-client')).cppCourseModuleStore,
      rust: async () => (await import('../../web/src/engine/rust2018-client')).rust2018ModuleStore,
      mysql: async () => (await import('../../web/src/engine/mysql-client')).mysqlModuleStore,
    };
    expect(assets.store).toBe(await stores[engine]());
    expect(assets.workers).toHaveLength(engine === 'c' ? 3 : engine === 'memory' ? 2 : 1);
    expect(new Set(assets.workers).size).toBe(assets.workers.length);
    for (const worker of assets.workers) {
      expect(typeof worker).toBe('string');
      expect(worker).toMatch(/worker/);
      expect(worker).not.toMatch(/^blob:|^data:/);
    }
  },
);
