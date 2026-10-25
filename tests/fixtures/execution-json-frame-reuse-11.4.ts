/** Isolated frame-slot reuse candidate; production does not import this module. */
/** Bounded canonical lexical pass before native JSON allocation. */
import { protocolAssert as ensure } from '../../web/src/engine/protocol';

interface Frame {
  object: boolean;
  phase: 'key-or-end' | 'key' | 'colon' | 'value-or-end' | 'value' | 'comma-or-end';
  previous: string;
  count: number;
}
const hex = (code: number) =>
  code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 102 ? code - 87 : -1;
// A bounded native scan for unescaped Unicode-BMP strings. Escapes, surrogate
// pairs, control characters and overlong strings still use the scalar scanner.
// Reset lastIndex on every invocation, including interleaved decode generators.
// eslint-disable-next-line no-control-regex -- Canonical JSON forbids raw C0 controls.
const simpleString = /[^"\\\u0000-\u001f\ud800-\udfff]{0,32768}"/y;

export interface JsonShape {
  containers: number;
}
export type ParsedJson =
  null | boolean | number | string | ParsedJson[] | { [key: string]: ParsedJson };
export function* precheckJson(text: string): Generator<void, JsonShape, unknown> {
  const stack: Frame[] = [];
  // Private to this invocation. A slot is reused only after that depth popped;
  // the original active stack and its depth guard remain authoritative.
  const frames: Frame[] = [];
  const checkedKeys = new Set<string>();
  let containers = 0;
  let at = 0,
    finished = false,
    checkedAt = 0;
  while (!finished) {
    if (at - checkedAt >= 65_536) {
      checkedAt = at;
      yield;
    }
    const frame = stack[stack.length - 1],
      character = text.charCodeAt(at);
    if (frame?.phase === 'key-or-end' || frame?.phase === 'key') {
      if (character === 125 && frame.phase === 'key-or-end') {
        at++;
        stack.pop();
        if (!stack.length) finished = true;
        continue;
      }
      ensure(character === 34, 'E_PROTOCOL_INVALID');
      const start = at + 1,
        end = text.indexOf('"', start);
      ensure(end > start && end - start <= 96 && frame.count++ < 32_768, 'E_PROTOCOL_INVALID');
      const key = text.slice(start, end);
      at = end + 1;
      // Protocol and parameter keys are ASCII identifiers. Validate each
      // spelling once; subsequent keys still undergo sorted/unique checks.
      if (!checkedKeys.has(key)) {
        ensure(/^[A-Za-z_][A-Za-z0-9_]*$/.test(key), 'E_PROTOCOL_INVALID');
        checkedKeys.add(key);
      }
      ensure(key > frame.previous, 'E_PROTOCOL_INVALID');
      frame.previous = key;
      frame.phase = 'colon';
      continue;
    }
    if (frame?.phase === 'colon') {
      ensure(character === 58, 'E_PROTOCOL_INVALID');
      at++;
      frame.phase = 'value';
      continue;
    }
    if (frame?.phase === 'comma-or-end') {
      if (character === (frame.object ? 125 : 93)) {
        at++;
        stack.pop();
        if (!stack.length) finished = true;
        continue;
      }
      ensure(character === 44, 'E_PROTOCOL_INVALID');
      at++;
      frame.phase = frame.object ? 'key' : 'value';
      continue;
    }
    if (frame?.phase === 'value-or-end' && character === 93) {
      at++;
      stack.pop();
      if (!stack.length) finished = true;
      continue;
    }
    if (frame) {
      if (!frame.object) ensure(frame.count++ < 1_000_000, 'E_PROTOCOL_INVALID');
      frame.phase = 'comma-or-end';
    }
    if (character === 123 || character === 91) {
      ensure(stack.length < 32, 'E_PROTOCOL_INVALID');
      containers++;
      const child = (frames[stack.length] ??= {
        object: false,
        phase: 'value',
        previous: '',
        count: 0,
      });
      child.object = character === 123;
      child.phase = character === 123 ? 'key-or-end' : 'value-or-end';
      child.previous = '';
      child.count = 0;
      stack.push(child);
      at++;
      continue;
    }
    if (character === 34) {
      simpleString.lastIndex = at + 1;
      if (simpleString.test(text)) {
        at = simpleString.lastIndex;
        if (!stack.length) finished = true;
        continue;
      }
      let length = 0,
        closed = false;
      for (at++; at < text.length; at++) {
        const code = text.charCodeAt(at);
        if (code === 34) {
          at++;
          closed = true;
          break;
        }
        ensure(++length <= 32768 && code >= 32, 'E_PROTOCOL_INVALID');
        if (code === 92) {
          const escaped = text.charCodeAt(++at);
          if (escaped === 117) {
            ensure(
              text.charCodeAt(at + 1) === 48 && text.charCodeAt(at + 2) === 48,
              'E_PROTOCOL_INVALID',
            );
            const upper = hex(text.charCodeAt(at + 3)),
              lower = hex(text.charCodeAt(at + 4)),
              value = upper * 16 + lower;
            ensure(
              upper >= 0 && lower >= 0 && value < 32 && ![8, 9, 10, 12, 13].includes(value),
              'E_PROTOCOL_INVALID',
            );
            at += 4;
          } else
            ensure(
              escaped === 34 ||
                escaped === 92 ||
                escaped === 98 ||
                escaped === 116 ||
                escaped === 110 ||
                escaped === 102 ||
                escaped === 114,
              'E_PROTOCOL_INVALID',
            );
        } else if (code >= 0xd800 && code <= 0xdbff) {
          const low = text.charCodeAt(++at);
          ensure(low >= 0xdc00 && low <= 0xdfff, 'E_PROTOCOL_INVALID');
        } else ensure(!(code >= 0xdc00 && code <= 0xdfff), 'E_PROTOCOL_INVALID');
      }
      ensure(closed, 'E_PROTOCOL_INVALID');
    } else if (character === 116 && text.startsWith('true', at)) at += 4;
    else if (character === 102 && text.startsWith('false', at)) at += 5;
    else if (character === 110 && text.startsWith('null', at)) at += 4;
    else {
      const negative = character === 45;
      if (negative) at++;
      const start = at,
        first = text.charCodeAt(at);
      ensure(first >= 48 && first <= 57 && (!negative || first !== 48), 'E_PROTOCOL_INVALID');
      at++;
      const end = Math.min(start + 16, text.length);
      while (at < end) {
        const code = text.charCodeAt(at);
        if (code < 48 || code > 57) break;
        at++;
      }
      // Shortest decimal integers are already fixed by the lexical grammar.
      // All <=15-digit magnitudes are safe; only the 16-digit boundary needs
      // a same-length ASCII comparison. Avoid Number/String round-trips for
      // every small coordinate/counter while checking the identical domain.
      ensure(
        (first !== 48 || at - start === 1) &&
          !(text.charCodeAt(at) >= 48 && text.charCodeAt(at) <= 57) &&
          (at - start < 16 || text.slice(start, at) <= '9007199254740991'),
        'E_PROTOCOL_INVALID',
      );
    }
    if (!stack.length) finished = true;
  }
  ensure(at === text.length && stack.length === 0, 'E_PROTOCOL_INVALID');
  return { containers };
}

/** Allocation fallback for unusually broad packets. The canonical lexical
 * pass already checked the grammar; this pass builds the same bounded value
 * without one long native JSON.parse over hundreds of thousands of records.
 */
export function* parseChunked(text: string): Generator<void, ParsedJson, unknown> {
  type Container =
    { object: { [key: string]: ParsedJson }; key: string | null } | { array: ParsedJson[] };
  const stack: Container[] = [];
  let at = 0,
    work = 0,
    root: ParsedJson = null;
  const append = (value: ParsedJson) => {
    const parent = stack[stack.length - 1];
    if (!parent) root = value;
    else if ('array' in parent) parent.array.push(value);
    else {
      ensure(parent.key !== null, 'E_PROTOCOL_INVALID');
      parent.object[parent.key] = value;
      parent.key = null;
    }
  };
  while (at < text.length) {
    if ((++work & 1023) === 0) yield;
    const character = text.charCodeAt(at),
      parent = stack[stack.length - 1];
    if (character === 123) {
      const object: { [key: string]: ParsedJson } = Object.create(null);
      append(object);
      stack.push({ object, key: null });
      at++;
    } else if (character === 91) {
      const array: ParsedJson[] = [];
      append(array);
      stack.push({ array });
      at++;
    } else if (character === 125 || character === 93) {
      ensure(stack.length > 0, 'E_PROTOCOL_INVALID');
      stack.pop();
      at++;
    } else if (character === 44 || character === 58) at++;
    else if (character === 34) {
      let end = text.indexOf('"', at + 1);
      ensure(end >= 0, 'E_PROTOCOL_INVALID');
      if (parent && 'object' in parent && parent.key === null) {
        parent.key = text.slice(at + 1, end);
        at = end + 1;
        continue;
      }
      while (end >= 0) {
        let escapes = 0;
        for (let before = end - 1; before > at && text.charCodeAt(before) === 92; before--)
          escapes++;
        if ((escapes & 1) === 0) break;
        end = text.indexOf('"', end + 1);
      }
      ensure(end >= 0, 'E_PROTOCOL_INVALID');
      append(JSON.parse(text.slice(at, end + 1)) as string);
      at = end + 1;
    } else if (character === 116) {
      append(true);
      at += 4;
    } else if (character === 102) {
      append(false);
      at += 5;
    } else if (character === 110) {
      append(null);
      at += 4;
    } else {
      const start = at;
      if (character === 45) at++;
      while (at < text.length && text.charCodeAt(at) >= 48 && text.charCodeAt(at) <= 57) at++;
      const value = Number(text.slice(start, at));
      ensure(at > start && Number.isSafeInteger(value), 'E_PROTOCOL_INVALID');
      append(value);
    }
  }
  ensure(stack.length === 0, 'E_PROTOCOL_INVALID');
  return root;
}
