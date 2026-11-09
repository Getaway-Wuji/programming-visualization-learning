import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';
import { codeWords, type CodeDialect } from './code-languages';
export type { CodeDialect } from './code-languages';
export function codeCompletions(
  dialect: CodeDialect,
  identifiers: () => readonly string[] = () => [],
) {
  return (context: CompletionContext) => {
    const tree =
      ensureSyntaxTree(context.state, context.state.doc.length, 50) ?? syntaxTree(context.state);
    const node = tree.resolveInner(context.pos, -1);
    if (/Comment|String|Char/i.test(node.name)) return null;
    const word = context.matchBefore(/[A-Za-z_]\w*!?/);
    if (!word || (!context.explicit && word.text.length < 1)) return null;
    const words: Completion[] = codeWords[dialect].keywords.map((label) => ({
      label,
      type: 'keyword',
    }));
    words.push(...codeWords[dialect].functions.map((label) => ({ label, type: 'function' })));
    if (dialect === 'cpp')
      words.push(...['std', 'cin', 'cout', 'endl'].map((label) => ({ label, type: 'variable' })));
    if (dialect === 'java')
      words.push(
        ...['System', 'out', 'Scanner', 'args'].map((label) => ({ label, type: 'variable' })),
      );
    words.push(
      ...identifiers()
        .filter((name) => /^[A-Za-z_]\w*$/.test(name))
        .map((label) => ({ label, type: 'variable' })),
    );
    const text = context.state.doc.toString();
    // Token checks keep names in strings and comments out of local suggestions.
    for (const match of text.matchAll(/\b[A-Za-z_]\w*/g)) {
      const at = match.index;
      if (
        at === word.from ||
        /Comment|String|Char|Keyword|Number/i.test(tree.resolveInner(at, 1).name)
      )
        continue;
      if (dialect === 'c' || dialect === 'c6' || dialect === 'cpp') {
        if (
          !/\b(?:int|char|double|float|void|bool|struct\s+\w+)\s+\**\s*$/.test(
            text.slice(Math.max(0, at - 70), at),
          )
        )
          continue;
      }
      words.push({
        label: match[0],
        type: /^\s*\(/.test(text.slice(at + match[0].length)) ? 'function' : 'variable',
      });
    }
    return {
      from: word.from,
      options: [...new Map(words.map((entry) => [entry.label, entry])).values()],
      validFor: /^\w*!?$/,
    };
  };
}
