import { expect, test } from 'vitest';
import { precheckJson } from '../../web/src/engine/execution-json';
import { precheckJson as before } from '../fixtures/execution-json-before-11.4';

function outcome(scan: typeof precheckJson, text: string) {
  try {
    const work = scan(text);
    let next = work.next();
    while (!next.done) next = work.next();
    return { accepted: true, containers: next.value.containers };
  } catch {
    return { accepted: false };
  }
}

test('bounded string scanning agrees with the frozen scalar scanner at Unicode and size boundaries', () => {
  const strings = [
    '',
    'node.42',
    '中间值',
    '\u2028\u2029',
    '😀',
    'a😀中',
    '\0\b\t\n\f\r"\\/',
    '\ud800',
    '\udc00',
    ...[32767, 32768, 32769].flatMap((length) => [
      'a'.repeat(length),
      '中'.repeat(length),
      '😀'.repeat(length),
      'a'.repeat(length - 1) + '\n',
      'a'.repeat(length - 1) + '😀',
    ]),
  ];
  const spellings = strings.flatMap((value) => [
    JSON.stringify(value),
    JSON.stringify({ a: [value], b: value }),
    `"${value}"`,
  ]);
  for (let control = 0; control < 32; control++) {
    spellings.push(`"x${String.fromCharCode(control)}y"`);
    spellings.push(`"\\u00${control.toString(16).padStart(2, '0')}"`);
  }
  spellings.push('"abc', '"\\u0061"', '"\\/"', '"\\ud800"', '["a",]', '{"a":"b",}');
  for (const text of spellings)
    expect(
      outcome(precheckJson, text),
      `length=${text.length} prefix=${text.slice(0, 32)}`,
    ).toEqual(outcome(before, text));
});

test('interleaved cancellable scans do not share a string cursor', () => {
  const texts = [
    JSON.stringify(Array.from({ length: 6000 }, (_, at) => ({ a: `node.${at}`, b: '中😀' }))),
    JSON.stringify(Array.from({ length: 4000 }, (_, at) => ({ a: `var.${at}`, b: '\n' }))),
  ];
  const work = texts.map((text) => precheckJson(text));
  const done = [false, false];
  while (!done.every(Boolean)) {
    for (let index = 0; index < work.length; index++) {
      if (done[index]) continue;
      const next = work[index].next();
      if (next.done) {
        done[index] = true;
        expect({ accepted: true, containers: next.value.containers }).toEqual(
          outcome(before, texts[index]),
        );
      }
    }
  }
});
