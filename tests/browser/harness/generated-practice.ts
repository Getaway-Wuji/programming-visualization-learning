import { GeneratedPracticeController } from '../../../web/src/generated-practice/controller';

declare global {
  interface Window {
    previewPracticeInputs: () => Promise<ReturnType<GeneratedPracticeController['getSnapshot']>[]>;
  }
}

// The public exercise submits the whole input set. Verify the retained preview
// adapter separately, through its real client, Worker, WASM and response decoder.
window.previewPracticeInputs = async () => {
  const controller = new GeneratedPracticeController();
  try {
    controller.select({ knowledgeId: 'knowledge.c.expressions', difficulty: 2, seed: '42' });
    await controller.run('generate');
    const problem = controller.getSnapshot().problem;
    if (!problem) throw Error('Actual generated problem required');
    controller.edit(problem.referenceSource);
    const results = [];
    for (const input of ['1 2', '  -12\n']) {
      controller.setInput(input);
      await controller.run('preview');
      results.push(controller.getSnapshot());
    }
    return results;
  } finally {
    controller.clear();
  }
};
