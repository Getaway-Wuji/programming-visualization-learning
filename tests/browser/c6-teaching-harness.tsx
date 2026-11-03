import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { C6TeachingReading } from '../../web/src/components/C6TeachingReading';
import { createC6TeachingRepository } from '../../web/src/content/c6-teaching-repository';
import '../../web/src/styles.css';
import './c6-teaching-harness.css';
import type { C6TeachingHarness } from './c6-teaching-harness-types';

const repository = createC6TeachingRepository();
const root = createRoot(document.getElementById('root')!);
const content: C6TeachingHarness = {
  repository,
  render(text: string) {
    flushSync(() =>
      root.render(
        <main className="c6-reading-check">
          <header>
            <a href="/c6-teaching-harness.html">编程学习平台</a>
            <span>正文排版检查</span>
          </header>
          <C6TeachingReading text={text} />
        </main>,
      ),
    );
  },
  async show(sourceNodeId: string) {
    const node = await repository.loadNode(sourceNodeId);
    content.render(node.body);
    return node;
  },
};
window.c6Teaching = content;
const id = new URL(location.href).searchParams.get('node') ?? 'c6.s14.3.1';
void content.show(id).catch((error: unknown) => content.render(`# 正文未加载\n\n${String(error)}`));
