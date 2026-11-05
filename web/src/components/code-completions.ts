import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';

export type CodeDialect = 'c6' | 'c' | 'cpp';
const common = 'int void if else for while break continue return'.split(' ');
const c6 = 'char float double const struct typedef enum switch case default do sizeof static'.split(
  ' ',
);
export function codeCompletions(dialect: CodeDialect) {
  return (context: CompletionContext) => {
    const node = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (/Comment|String|Char/.test(node.name)) return null;
    const word = context.matchBefore(/[A-Za-z_]\w*/);
    if (!word || (!context.explicit && word.text.length < 1)) return null;
    const words: Completion[] = [...common, ...(dialect === 'c6' ? c6 : [])].map((label) => ({
      label,
      type: 'keyword',
    }));
    const functions =
      dialect === 'cpp'
        ? ['main']
        : dialect === 'c6'
          ? [
              'main',
              'printf',
              'scanf',
              'puts',
              'putchar',
              'getchar',
              'strlen',
              'strcmp',
              'strcpy',
              'strcat',
            ]
          : ['main', 'printf'];
    words.push(...functions.map((label) => ({ label, type: 'function' })));
    if (dialect === 'cpp')
      words.push(...['std', 'cin', 'cout', 'endl'].map((label) => ({ label, type: 'variable' })));
    const text = context.state.doc.toString();
    for (const match of text.matchAll(
      /\b(?:int|char|double|float|void|bool|struct\s+\w+)\s+\**\s*([A-Za-z_]\w*)/g,
    )) {
      const at = match.index + match[0].lastIndexOf(match[1]);
      if (/Comment|String/.test(syntaxTree(context.state).resolveInner(at, 1).name)) continue;
      if (at === word.from) continue;
      words.push({
        label: match[1],
        type: text[at + match[1].length] === '(' ? 'function' : 'variable',
      });
    }
    return {
      from: word.from,
      options: [...new Map(words.map((entry) => [entry.label, entry])).values()],
      validFor: /^\w*$/,
    };
  };
}
