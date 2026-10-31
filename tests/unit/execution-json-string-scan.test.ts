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

test('bounded scalar-record fast paths agree with frozen lexical grammar and container/depth limits', () => {
  const texts: string[] = [];
  for (const n of [0, 1, 999, 2147483647, 999999999999999, 1000000000000000, 9007199254740991]) {
    for (const value of [null, n, -n]) {
      texts.push(
        JSON.stringify({ end: n, start: n }),
        JSON.stringify({ arrayWrites: n, comparisons: n, scalarWrites: n, swaps: n }),
        JSON.stringify({ index: n, value }),
        JSON.stringify({ kind: 'source', nodeId: `n${n}` }),
      );
    }
  }
  texts.push(
    '{"index":0,"value":-0}',
    '{"end":01,"start":0}',
    '{"end":1e0,"start":0}',
    '{"end":0,"start":0,"z":1}',
    '{"index":0,"value":9007199254740992}',
    '{"kind":"source","nodeId":"n01"}',
    '{"kind":"source","nodeId":"n1\\n"}',
    '{"kind":"source","nodeId":"n1"} ',
    '{"end":0, "start":0}',
  );
  for (const text of [...texts]) {
    texts.push('['.repeat(31) + text + ']'.repeat(31), '['.repeat(32) + text + ']'.repeat(32));
    for (const punctuation of ['{', '}', ':', ',', '"']) {
      const at = text.indexOf(punctuation);
      if (at >= 0) texts.push(text.slice(0, at) + text.slice(at + 1));
    }
  }
  for (const text of texts)
    expect(outcome(precheckJson, text), text.slice(0, 100)).toEqual(outcome(before, text));
  const large = JSON.stringify(Array.from({ length: 12000 }, (_, i) => ({ end: i, start: 0 })));
  expect(outcome(precheckJson, large)).toEqual(outcome(before, large));
});

test('mixed object and array separators retain the frozen grammar after dispatch folding', () => {
  const forms = [
    'null',
    '[]',
    '{}',
    '[0,1,[],{},null,true,false]',
    '{"a":[0,{"b":"中😀","c":[false,null]}],"d":-3,"z":{}}',
    '[{"a":0,"b":[]},{"a":{},"b":[{"c":1}]}]',
  ];
  for (const text of forms) {
    const variants = [text, text + ',', text + ' ', text.slice(0, -1)];
    for (let i = 0; i < text.length; i++)
      if ('{}[],:'.includes(text[i]))
        variants.push(
          text.slice(0, i) + text.slice(i + 1),
          text.slice(0, i) + text[i] + text.slice(i),
          text.slice(0, i) + ' ' + text.slice(i + 1),
        );
    for (const variant of variants)
      expect(outcome(precheckJson, variant), variant).toEqual(outcome(before, variant));
  }
});

test('flow and source-location records preserve canonical grammar in bounded and interleaved scans', () => {
  const forms: string[] = [];
  for (const n of [0, 1, 999999999999999, 1000000000000000, 9007199254740991]) {
    for (const stage of ['block', 'init', 'condition', 'body', 'update', '', 'unknown'])
      forms.push(JSON.stringify({ iteration: n, nodeId: `n${n}`, stage }));
    for (const edge of ['start', 'whole', 'end', '', 'unknown'])
      forms.push(JSON.stringify({ edge, kind: 'source', nodeId: `n${n}` }));
  }
  forms.push(
    '{"iteration":-0,"nodeId":"n1","stage":"body"}',
    '{"iteration":01,"nodeId":"n1","stage":"body"}',
    '{"iteration":1e0,"nodeId":"n1","stage":"body"}',
    '{"iteration":9007199254740992,"nodeId":"n1","stage":"body"}',
    '{"iteration":0,"nodeId":"n1","stage":"bo\\u0064y"}',
    '{"iteration":0,"nodeId":"n1","stage":"body","z":0}',
    '{"edge":"whole","kind":"source","nodeId":"n1\\n"}',
  );
  for (const text of forms) {
    const variants = [
      text,
      '['.repeat(31) + text + ']'.repeat(31),
      '['.repeat(32) + text + ']'.repeat(32),
    ];
    for (let i = 0; i < text.length; i++)
      if ('{}:,"'.includes(text[i]))
        variants.push(
          text.slice(0, i) + text.slice(i + 1),
          text.slice(0, i) + text[i] + text.slice(i),
        );
    for (const variant of variants)
      expect(outcome(precheckJson, variant), variant).toEqual(outcome(before, variant));
  }
  const texts = [
    JSON.stringify(
      Array.from({ length: 10000 }, (_, iteration) => ({ iteration, nodeId: 'n1', stage: 'body' })),
    ),
    JSON.stringify(
      Array.from({ length: 10000 }, () => ({ edge: 'whole', kind: 'source', nodeId: 'n2' })),
    ),
  ];
  const scans = texts.map((text) => precheckJson(text));
  const done = [false, false];
  while (!done.every(Boolean))
    for (let i = 0; i < scans.length; i++) {
      if (done[i]) continue;
      const next = scans[i].next();
      if (next.done) {
        done[i] = true;
        expect({ accepted: true, containers: next.value.containers }).toEqual(
          outcome(before, texts[i]),
        );
      }
    }
});
