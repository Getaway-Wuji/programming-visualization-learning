import type { ModuleStore } from './module';
import type { PreparationEngine } from './preparation';

export interface PreparationAssets {
  store: ModuleStore;
  workers: readonly string[];
}

/** Load only the selected engine. Worker URL imports emit the same bundled entry as its client. */
export async function preparationAssets(engine: PreparationEngine): Promise<PreparationAssets> {
  switch (engine) {
    case 'c': {
      const [module, execution, analysis, probe] = await Promise.all([
        import('./module'),
        import('./execution.worker.ts?worker&url'),
        import('./analysis.worker.ts?worker&url'),
        import('./probe.worker.ts?worker&url'),
      ]);
      return {
        store: module.sharedModuleStore,
        workers: [execution.default, analysis.default, probe.default],
      };
    }
    case 'c6': {
      const [module, worker] = await Promise.all([
        import('./c6-module'),
        import('./c6-worker.ts?worker&url'),
      ]);
      return { store: module.c6ModuleStore, workers: [worker.default] };
    }
    case 'practice': {
      const [module, worker] = await Promise.all([
        import('../generated-practice/module'),
        import('../generated-practice/practice-worker.ts?worker&url'),
      ]);
      return { store: module.practiceModuleStore, workers: [worker.default] };
    }
    case 'memory': {
      const [module, worker, bugs] = await Promise.all([
        import('./memory-module'),
        import('./memory-worker.ts?worker&url'),
        import('../memory-bugs/worker.ts?worker&url'),
      ]);
      return { store: module.memoryModuleStore, workers: [worker.default, bugs.default] };
    }
    case 'algorithm': {
      const [module, worker] = await Promise.all([
        import('./algorithm-module'),
        import('./algorithm-worker.ts?worker&url'),
      ]);
      return { store: module.algorithmModuleStore, workers: [worker.default] };
    }
    case 'advanced': {
      const [module, worker] = await Promise.all([
        import('./advanced-module'),
        import('./advanced-worker.ts?worker&url'),
      ]);
      return { store: module.advancedModuleStore, workers: [worker.default] };
    }
    case 'python': {
      const [module, worker] = await Promise.all([
        import('./python3-client'),
        import('./python3-worker.ts?worker&url'),
      ]);
      return { store: module.python3ModuleStore, workers: [worker.default] };
    }
    case 'java': {
      const [module, worker] = await Promise.all([
        import('./java-client'),
        import('./java-worker.ts?worker&url'),
      ]);
      return { store: module.javaModuleStore, workers: [worker.default] };
    }
    case 'cpp': {
      const [module, worker] = await Promise.all([
        import('./cpp-course-client'),
        import('./cpp-course-worker.ts?worker&url'),
      ]);
      return { store: module.cppCourseModuleStore, workers: [worker.default] };
    }
    case 'rust': {
      const [module, worker] = await Promise.all([
        import('./rust2018-client'),
        import('./rust2018-worker.ts?worker&url'),
      ]);
      return { store: module.rust2018ModuleStore, workers: [worker.default] };
    }
    case 'mysql': {
      const [module, worker] = await Promise.all([
        import('./mysql-client'),
        import('./mysql-worker.ts?worker&url'),
      ]);
      return { store: module.mysqlModuleStore, workers: [worker.default] };
    }
    default:
      throw new Error('E_MODULE_LOAD');
  }
}
