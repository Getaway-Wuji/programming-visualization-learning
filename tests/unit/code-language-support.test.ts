import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { ensureSyntaxTree, getIndentation, indentUnit } from '@codemirror/language';
import { codeLanguage, type CodeDialect } from '../../web/src/components/code-languages';
import { codeCompletions } from '../../web/src/components/code-completions';

const stateFor = (dialect: CodeDialect, source: string) =>
  EditorState.create({
    doc: source,
    extensions: [codeLanguage(dialect), indentUnit.of('    ')],
  });
const complete = (dialect: CodeDialect, source: string) =>
  codeCompletions(dialect)(new CompletionContext(stateFor(dialect, source), source.length, true));

describe('six-language editor presentation', () => {
  it.each([
    ['c6', 'int count = 42; // count\nprintf("hello");', 'int', '42', '// count', '"hello"'],
    ['cpp', 'int count = 42; // count\nstd::cout << "hello";', 'int', '42', '// count', '"hello"'],
    [
      'python',
      'if True:\n    count = 42 # count\n    print("hello")',
      'if',
      '42',
      '# count',
      '"hello"',
    ],
    [
      'java',
      'class Main { int count = 42; // count\nString s = "hello"; }',
      'class',
      '42',
      '// count',
      '"hello"',
    ],
    [
      'rust',
      'fn main() { let count = 42; // count\nprintln!("hello"); }',
      'fn',
      '42',
      '// count',
      '"hello"',
    ],
    ['mysql', "SELECT 42, 'hello'; -- count", 'SELECT', '42', '-- count', "'hello'"],
  ] as const)(
    '%s separates source tokens without changing source text',
    (dialect, source, keyword, number, comment, string) => {
      const state = stateFor(dialect, source);
      const tree = ensureSyntaxTree(state, source.length, 200)!;
      expect(tree).toBeTruthy();
      const kind = (text: string) => tree.resolveInner(source.indexOf(text) + 1, 1).name;
      expect(kind(keyword)).not.toBe(kind(number));
      expect(kind(number)).not.toBe(kind(string));
      expect(kind(comment)).toMatch(/comment/i);
      expect(kind(string)).toMatch(/string/i);
      expect(state.doc.toString()).toBe(source);
    },
  );

  it.each([
    ['python', 'count = 4\nco', 'count', 'print', 'open'],
    ['java', 'int count = 4;\nco', 'count', 'nextInt', 'charAt'],
    ['rust', 'fn main() { let count = 4; co', 'count', 'clone', 'len'],
    ['mysql', 'SELECT score FROM students; sco', 'score', 'COUNT', 'LOWER'],
  ] as const)(
    '%s suggests supported builtins and local names',
    (dialect, source, local, builtin, unsupported) => {
      const options = complete(dialect, source)!.options.map((option) => option.label);
      expect(options).toContain(local);
      expect(options).toContain(builtin);
      expect(options).not.toContain(unsupported);
    },
  );

  it.each([
    ['python', '# pri'],
    ['python', 'print("pri'],
    ['python', '"""multiline\npri'],
    ['java', '// pri'],
    ['java', 'String s = "pri'],
    ['java', '/* multiline\npri'],
    ['rust', '// pri'],
    ['rust', 'println!("pri'],
    ['rust', '/* outer /* inner */\npri'],
    ['mysql', '-- pri'],
    ['mysql', "SELECT 'it''s pri"],
    ['mysql', '/* multiline\npri'],
  ] as const)('%s avoids suggestions inside %j', (dialect, source) => {
    expect(complete(dialect, source)).toBeNull();
  });

  it('does not learn names from strings and comments', () => {
    for (const dialect of ['python', 'java', 'rust', 'mysql'] as const) {
      const lineComment = dialect === 'python' ? '#' : dialect === 'mysql' ? '--' : '//';
      const result = complete(dialect, `"secret_text"\n${lineComment} secret_comment\nsec`)!;
      expect(result.options.map((option) => option.label)).not.toContain('secret_text');
      expect(result.options.map((option) => option.label)).not.toContain('secret_comment');
    }
  });

  it('offers real SQL schema names even before they appear in the source', () => {
    const source = 'SELECT sco';
    const result = codeCompletions('mysql', () => ['students', 'score', 'not a name'])(
      new CompletionContext(stateFor('mysql', source), source.length, true),
    )!;
    expect(result.options.map((option) => option.label)).toContain('score');
    expect(result.options.map((option) => option.label)).toContain('students');
    expect(result.options.map((option) => option.label)).not.toContain('not a name');
  });

  it('retains Python suite indentation and Rust brace indentation', () => {
    expect(getIndentation(stateFor('python', 'if True:\n'), 9)).toBe(4);
    const rust = 'fn main() {\n';
    expect(getIndentation(stateFor('rust', rust), rust.length)).toBe(4);
  });
});
