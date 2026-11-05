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

test('flat algorithm controls retain the frozen grammar, integer and depth boundaries', () => {
  const texts: string[] = [];
  for (const inputCursor of [0, 1, 999999999999999, 1000000000000000, 9007199254740991])
    for (const returnValue of [null, 0, -1, 2147483647, 9007199254740991])
      texts.push(
        JSON.stringify({ activeFrameId: 'f1', inputCursor, nextNodeId: 'n2', returnValue }),
      );
  const canonical = texts[0];
  texts.push(
    '{"activeFrameId":null,"inputCursor":0,"nextNodeId":null,"returnValue":null}',
    canonical.replace('"inputCursor":0', '"inputCursor":-0'),
    canonical.replace('"inputCursor":0', '"inputCursor":01'),
    canonical.replace('"inputCursor":0', '"inputCursor":1e0'),
    canonical.replace('"inputCursor":0', '"inputCursor":9007199254740992'),
    canonical.replace('"inputCursor":0', '"inputCursor":0,"inputCursor":0'),
    canonical.replace('"returnValue":null', '"returnValue":-0'),
    canonical.replace('"f1"', '"f01"'),
    canonical.replace('"f1"', '"f1\\n"'),
    canonical.replace('"n2"', '"n2\\n"'),
    canonical.replace('}', ',"z":0}'),
    canonical + ' ',
  );
  for (const text of [...texts]) {
    texts.push('['.repeat(31) + text + ']'.repeat(31));
    texts.push('['.repeat(32) + text + ']'.repeat(32));
    for (const punctuation of ['{', '}', ':', ',', '"']) {
      const at = text.indexOf(punctuation);
      texts.push(text.slice(0, at) + text.slice(at + 1));
    }
  }
  for (const text of texts)
    expect(outcome(precheckJson, text), text).toEqual(outcome(before, text));
});

test('shallow algorithm records agree with frozen grammar, nested counts and bounded fallbacks', () => {
  const records = [];
  for (const count of [0, 1, 8, 9]) {
    records.push({
      aliases: [],
      frameId: 'f1',
      id: 's2',
      nodeId: 'n3',
      objectIds: Array.from({ length: count }, (_, i) => `o${i + 1}`),
    });
    records.push({
      callNodeId: null,
      functionName: 'main',
      functionNodeId: 'n3',
      id: 'f1',
      parentFrameId: null,
      scopeIds: Array.from({ length: count }, (_, i) => `s${i + 1}`),
    });
  }
  records.push({
    baseAddress: 5242884096,
    cells: [],
    declarationNodeId: 'n3',
    defaultValue: null,
    frameId: 'f1',
    id: 'o1',
    kind: 'int-array',
    length: 262144,
    name: 'array',
    scopeId: 's2',
  });
  const texts: string[] = [];
  for (const value of records) {
    const canonical = JSON.stringify(value);
    const variants = [
      canonical,
      canonical + ' ',
      canonical.replace('}', ',"z":0}'),
      canonical.replace('"f1"', '"f01"'),
      canonical.replace('"f1"', '"f1\\n"'),
      canonical.replace('null', '-0'),
      canonical.replace('5242884096', '9007199254740992'),
    ];
    for (let i = 0; i < canonical.length; i++)
      if ('{}[]:,"'.includes(canonical[i]))
        variants.push(canonical.slice(0, i) + canonical.slice(i + 1));
    for (const text of variants) {
      texts.push(text);
      texts.push('['.repeat(30) + text + ']'.repeat(30));
      texts.push('['.repeat(31) + text + ']'.repeat(31));
    }
  }
  for (const text of texts)
    expect(outcome(precheckJson, text), text).toEqual(outcome(before, text));
});

test('paired allocator and control deltas retain the complete grammar and both nested containers', () => {
  const control = { activeFrameId: 'f1', inputCursor: 0, nextNodeId: 'n2', returnValue: null };
  const allocator = {
    liveBytes: 0,
    nextAddress: 4096,
    nextFrame: 1,
    nextObject: 1,
    nextScope: 1,
  };
  const pairs = [
    JSON.stringify({ after: { ...control, returnValue: -3 }, before: control, op: 'control' }),
    JSON.stringify({
      after: { ...allocator, nextAddress: 5242884096 },
      before: allocator,
      op: 'allocator',
    }),
  ];
  for (const pair of pairs) {
    expect(outcome(precheckJson, pair)).toEqual({ accepted: true, containers: 3 });
    const variants = [
      pair,
      pair.replace('"before":{', '"before":{"a":0,'),
      pair.replace('"before":{', '"before":{"z":0,'),
      pair.replace('":0,', '":-0,'),
      pair.replace('":0,', '":9007199254740991,'),
      pair.replace('":0,', '":9007199254740992,'),
      pair.replace(',"op":', ',"before":null,"op":'),
      pair.replace(',"op":', ', "op":'),
      pair + ' ',
    ];
    for (let i = 0; i < pair.length; i++)
      if ('{}:,"'.includes(pair[i])) variants.push(pair.slice(0, i) + pair.slice(i + 1));
    for (const form of variants)
      for (const depth of [0, 30, 31]) {
        const text = '['.repeat(depth) + form + ']'.repeat(depth);
        expect(outcome(precheckJson, text), text).toEqual(outcome(before, text));
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

test.each([
  ['read', '{"index":0,"kind":"read","nodeId":"n1","objectId":"o2","value":-7}', 1],
  ['decision', '{"branch":"false","kind":"decision","nodeId":"n1","value":0}', 1],
  ['cell', '{"after":-7,"before":null,"index":0,"objectId":"o2","op":"cell"}', 1],
  ['evaluate', '{"kind":"evaluate","nodeId":"n1","operands":[0,-7],"operator":"<","value":1}', 2],
] as const)(
  '%s records retain the frozen grammar and exact container limits',
  (_, canonical, count) => {
    expect(outcome(precheckJson, canonical)).toEqual({ accepted: true, containers: count });
    const variants = [
      canonical,
      canonical + ' ',
      canonical.replace(/}$/, ',"z":0}'),
      canonical.replace('"n1"', '"n1\\n"'),
      canonical.replace('"o2"', '"o02"'),
      canonical.replace(/"value":(-?\d+)/, '"value":$1,"value":0'),
      canonical.replace('"operator":"<"', '"operator":"< "'),
      ...['0', '-0', '01', '1e0', '999999999999999', '9007199254740991', '9007199254740992'].map(
        (value) => canonical.replace(/:(-?\d+)(?=[,}])/, ':' + value),
      ),
      ...[[], [0], [1, -7, 0, 3], [1, 2, 3, 4, 5]].map((operands) =>
        canonical.replace('[0,-7]', JSON.stringify(operands)),
      ),
    ];
    for (let i = 0; i < canonical.length; i++)
      if ('{}[]:,"'.includes(canonical[i]))
        variants.push(canonical.slice(0, i) + canonical.slice(i + 1));
    for (const form of variants)
      for (const depth of [0, 30, 31, 32]) {
        const input = '['.repeat(depth) + form + ']'.repeat(depth);
        expect(outcome(precheckJson, input), input).toEqual(outcome(before, input));
      }
  },
);

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

function control(count: number) {
  return {
    activeFrameId: 'f1',
    flowStack: Array.from({ length: count }, (_, iteration) => ({
      iteration,
      nodeId: 'n1',
      stage: 'body',
    })),
    nextNodeId: 'n2',
    phase: 'running',
    returnValue: null as number | null,
  };
}

test('complete controls preserve all scalar fallbacks, exact containers and nesting limits', () => {
  for (const count of [0, 1, 2, 8, 9, 64]) {
    const text = JSON.stringify(control(count));
    expect(outcome(precheckJson, text)).toEqual({ accepted: true, containers: count + 2 });
    for (const depth of [0, 28, 29, 30, 31, 32]) {
      const nested = '['.repeat(depth) + text + ']'.repeat(depth);
      expect(outcome(precheckJson, nested), `flows=${count} depth=${depth}`).toEqual(
        outcome(before, nested),
      );
    }
    for (const value of [
      null,
      0,
      -1,
      2147483647,
      -2147483648,
      999999999999999,
      1000000000000000,
      9007199254740991,
      9007199254740992,
    ]) {
      const c = control(count);
      c.returnValue = value;
      const candidate = JSON.stringify(c);
      expect(outcome(precheckJson, candidate), candidate.slice(0, 80)).toEqual(
        outcome(before, candidate),
      );
    }
  }
  for (const n of [0, 1, 999999999999999, 1000000000000000, 9007199254740991, 9007199254740992]) {
    const text = JSON.stringify({
      liveBytes: n,
      nextAddress: n,
      nextFrame: n,
      nextObject: n,
      nextScope: n,
    });
    expect(outcome(precheckJson, text), text).toEqual(outcome(before, text));
  }
});

test('complete controls do not hide malformed punctuation, noncanonical scalars or extra fields', () => {
  for (const count of [0, 1, 8, 9]) {
    const text = JSON.stringify(control(count));
    const forms = [
      text,
      text + ' ',
      text + '0',
      text.slice(0, -1),
      text.slice(0, -1) + ',"z":0}',
      text.replace('"running"', '"unknown"'),
      text.replace('"f1"', '"f0"'),
      text.replace('"n2"', '"node}\\n"'),
      text.replace('"returnValue":null', '"returnValue":-0'),
      text.replace('"returnValue":null', '"returnValue":1e0'),
      text.replace('"returnValue":null', '"returnValue":9007199254740992'),
    ];
    for (let i = 0; i < text.length; i++)
      if ('{}[],:"'.includes(text[i]))
        forms.push(
          text.slice(0, i) + text.slice(i + 1),
          text.slice(0, i) + text[i] + text.slice(i),
          text.slice(0, i) + ' ' + text.slice(i + 1),
        );
    for (const value of forms)
      expect(outcome(precheckJson, value), value.slice(0, 120)).toEqual(outcome(before, value));
  }
  for (const value of ['-0', '01', '1e0', '9007199254740992']) {
    const text =
      '{"liveBytes":' + value + ',"nextAddress":4096,"nextFrame":1,"nextObject":1,"nextScope":1}';
    expect(outcome(precheckJson, text)).toEqual(outcome(before, text));
  }
});

test('interleaved complete controls preserve the native-allocation threshold and bad-tail rejection', () => {
  const large = JSON.stringify(Array(50001).fill(control(3)));
  const alloc = { liveBytes: 0, nextAddress: 4096, nextFrame: 1, nextObject: 1, nextScope: 1 };
  const texts = [
    large,
    JSON.stringify(Array(1000).fill(control(9))),
    JSON.stringify(Array(6000).fill(alloc)).slice(0, -1) +
      ',{"liveBytes":0,"nextAddress":4096,"nextFrame":1,"nextObject":1,"nextScope":-0}]',
  ];
  expect(outcome(before, large)).toEqual({ accepted: true, containers: 250006 });
  const work = texts.map((text) => precheckJson(text)),
    done = texts.map(() => false);
  while (!done.every(Boolean))
    for (let i = 0; i < work.length; i++) {
      if (done[i]) continue;
      let observed;
      try {
        const next = work[i].next();
        if (!next.done) continue;
        observed = { accepted: true, containers: next.value.containers };
      } catch {
        observed = { accepted: false };
      }
      done[i] = true;
      expect(observed).toEqual(outcome(before, texts[i]));
    }
});
