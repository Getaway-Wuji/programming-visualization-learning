import { cpp } from '@codemirror/lang-cpp';
import { StreamLanguage } from '@codemirror/language';

export type CodeDialect = 'c6' | 'c' | 'cpp' | 'python' | 'java' | 'rust' | 'mysql';

const common = 'int void if else for while break continue return';
export const codeWords: Record<CodeDialect, { keywords: string[]; functions: string[] }> = {
  c: { keywords: common.split(' '), functions: ['main', 'printf'] },
  c6: {
    keywords: (
      common + ' char float double const struct typedef enum switch case default do sizeof static'
    ).split(' '),
    functions: 'main printf scanf puts putchar getchar strlen strcmp strcpy strcat'.split(' '),
  },
  cpp: {
    keywords: (
      common + ' char bool const struct class public nullptr true false using namespace'
    ).split(' '),
    functions: ['main'],
  },
  python: {
    keywords:
      'if elif else for while in def return break continue pass and or not True False None'.split(
        ' ',
      ),
    functions: 'print input int float str bool len range abs append pop'.split(' '),
  },
  java: {
    keywords:
      'public static class void int boolean String if else for while break continue return new true false null import'.split(
        ' ',
      ),
    functions: 'main println print nextInt nextLine length equals'.split(' '),
  },
  rust: {
    keywords:
      'fn let mut i32 bool String if else while loop for in break continue return true false'.split(
        ' ',
      ),
    functions:
      'main print! println! new from clone trim parse unwrap read_line stdin push_str clear'.split(
        ' ',
      ),
  },
  mysql: {
    keywords:
      'SELECT FROM WHERE AS DISTINCT ORDER BY ASC DESC LIMIT OFFSET JOIN INNER LEFT OUTER CROSS ON GROUP HAVING AND OR NOT IS NULL IN BETWEEN LIKE CREATE TABLE INT VARCHAR PRIMARY KEY UNIQUE DEFAULT INSERT INTO VALUES UPDATE SET DELETE DROP TRUNCATE EXISTS BEGIN START TRANSACTION COMMIT ROLLBACK TRUE FALSE'.split(
        ' ',
      ),
    functions: 'COUNT SUM MIN MAX AVG COALESCE IFNULL ABS LENGTH CHAR_LENGTH CONCAT'.split(' '),
  },
};

interface TokenState {
  blockComment: number;
  quote: string;
  indent: number;
  depth: number;
  colon: boolean;
}

/** Presentation only. Execution and diagnostics still come from the Rust interpreters. */
export function codeLanguage(dialect: CodeDialect) {
  if (dialect === 'c' || dialect === 'c6' || dialect === 'cpp') return cpp();
  const sql = dialect === 'mysql';
  const python = dialect === 'python';
  const keywords = new Set(codeWords[dialect].keywords);
  const functions = new Set(codeWords[dialect].functions);
  return StreamLanguage.define<TokenState>({
    name: dialect,
    startState: () => ({ blockComment: 0, quote: '', indent: 0, depth: 0, colon: false }),
    copyState: (state) => ({ ...state }),
    token(stream, state) {
      if (stream.sol()) {
        state.indent = stream.indentation();
        state.colon = false;
      }
      if (state.blockComment) {
        while (!stream.eol()) {
          if (stream.match('*/')) {
            if (--state.blockComment === 0) break;
          } else if (dialect === 'rust' && stream.match('/*')) state.blockComment++;
          else stream.next();
        }
        return 'comment';
      }
      if (state.quote) {
        const quote = state.quote;
        while (!stream.eol()) {
          if (stream.match(quote)) {
            if (sql && stream.match(quote)) continue;
            state.quote = '';
            break;
          }
          if (stream.next() === '\\') stream.next();
        }
        if (quote.length === 1 && !sql) state.quote = '';
        return 'string';
      }
      if (stream.eatSpace()) return null;
      if (
        ((python || sql) && stream.match('#')) ||
        (sql && stream.match(/--(?=\s|$)/)) ||
        (!python && !sql && stream.match('//'))
      ) {
        stream.skipToEnd();
        return 'comment';
      }
      if (!python && stream.match('/*')) {
        state.blockComment = 1;
        while (!stream.eol()) {
          if (stream.match('*/')) {
            if (--state.blockComment === 0) break;
          } else if (dialect === 'rust' && stream.match('/*')) state.blockComment++;
          else stream.next();
        }
        return 'comment';
      }
      if (python && (stream.match('"""') || stream.match("'''"))) {
        state.quote = stream.current();
        while (!stream.eol()) {
          if (stream.match(state.quote)) {
            state.quote = '';
            break;
          }
          if (stream.next() === '\\') stream.next();
        }
        return 'string';
      }
      if (stream.match(/["']/)) {
        const quote = stream.current();
        state.quote = quote;
        while (!stream.eol()) {
          if (stream.match(quote)) {
            if (sql && stream.match(quote)) continue;
            state.quote = '';
            break;
          }
          if (stream.next() === '\\') stream.next();
        }
        if (!sql) state.quote = '';
        return 'string';
      }
      if (stream.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:i32)?\b/)) return 'number';
      if (stream.match(/[A-Za-z_]\w*!?/)) {
        const name = stream.current();
        const word = sql ? name.toUpperCase() : name;
        if (/^(?:true|false|True|False|None|NULL|TRUE|FALSE|null)$/.test(word)) return 'atom';
        if (keywords.has(word)) return 'keyword';
        if (functions.has(word)) return 'builtin';
        return 'variable';
      }
      const ch = stream.next();
      if (ch === '{' || ch === '(' || ch === '[') state.depth++;
      else if (ch === '}' || ch === ')' || ch === ']') state.depth = Math.max(0, state.depth - 1);
      state.colon = ch === ':';
      return /[+*/%=<>!&|^-]/.test(ch ?? '') ? 'operator' : null;
    },
    indent(state, after, context) {
      if (state.quote || state.blockComment) return null;
      if (python) return state.indent + (state.colon ? context.unit : 0);
      return Math.max(0, state.depth - (/^\s*[}\])]/.test(after) ? 1 : 0)) * context.unit;
    },
    languageData: {
      commentTokens: python
        ? { line: '#' }
        : sql
          ? { line: '--', block: { open: '/*', close: '*/' } }
          : { line: '//', block: { open: '/*', close: '*/' } },
    },
  });
}
