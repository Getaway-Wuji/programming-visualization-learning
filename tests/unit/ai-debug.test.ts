/** API transport is simulated here. Original Rust packets are read-only facts, not AI answers. */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AiSession, supportedOrigin } from '../../web/src/ai-debug/session';
import {
  AiFailure,
  canonical,
  parseBounded,
  providers,
  validateResponse,
  type AiRequest,
  type AiResponse,
} from '../../web/src/ai-debug/protocol';
import { buildContext, validateOriginal, type ContextInput } from '../../web/src/ai-debug/context';
import { providerPayload } from '../../web/src/ai-debug/projection';

const fixtures = JSON.parse(readFileSync('shared/contracts/19.3-API-Key设计样例.json', 'utf8'));
const sentinel = 'DESIGN_ONLY_NOT_A_REAL_KEY';
const json = (value: unknown, status = 200) =>
  new Response(canonical(value), { status, headers: { 'Content-Type': 'application/json' } });
const capabilities = {
  aiVersion: '2.0.0',
  kind: 'ai.capabilities',
  available: true,
  providers: providers.map((p) => ({ providerId: p.id, model: p.model })),
};
function response(request: AiRequest): AiResponse {
  const out = structuredClone(fixtures.examples[0].hypotheticalResponse) as AiResponse;
  out.requestId = request.requestId;
  out.configRevision = request.configRevision;
  out.confirmationId = request.confirmationId;
  for (const key of ['contextId', 'runRef', 'inputRevision', 'cursor'] as const)
    Object.assign(out, { [key]: request.context[key] });
  out.provider = {
    providerId: request.provider.providerId,
    configVersion: '2.0.0',
    requestedModel: request.provider.model,
    returnedModel: request.provider.model,
  };
  return out;
}
type Explain = (request: AiRequest, init: RequestInit) => Promise<Response>;
function harness(explain: Explain = async (r) => json(response(r)), now = () => performance.now()) {
  const calls: { path: string; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(url).split('/').at(-1)!;
    calls.push({ path, init });
    if (path === 'capabilities') return json(capabilities);
    const req = JSON.parse(String(init.body));
    if (path === 'verify')
      return json({ ...req, kind: 'config.checked', verified: true, code: null });
    return explain(req, init);
  });
  const session = new AiSession(fetcher, '/', now, () => 'http://127.0.0.1');
  const enable = async () => {
    session.choose({ providerId: 'openai', model: providers[0].model });
    session.setKey(sentinel);
    await session.verify();
    expect(session.getSnapshot().enabled).toBe(true);
  };
  const preview = () => {
    session.preview(structuredClone(fixtures.examples[0].request.context));
    const request = session.getSnapshot().preview;
    expect(request).not.toBeNull();
    return request!;
  };
  return { session, calls, fetcher, enable, preview };
}
function original(index: number): ContextInput {
  const item = fixtures.examples[index];
  const packet = JSON.parse(readFileSync(`tests/fixtures/ai/${item.id}.json`, 'utf8'));
  return {
    source: packet.request.source,
    result: packet.result,
    state: packet.state,
    cursor: packet.selectedCursor,
    inputRevision: item.request.context.inputRevision,
    selection: null,
  };
}
describe('AI minimal facts from actual unchanged Rust packets', () => {
  for (const [index, name] of ['pointer', 'loop', 'syntax'].entries())
    it(`${name}: source slices, original facts and no-trace honesty`, () => {
      const input = original(index),
        context = buildContext(input);
      validateOriginal(context, input);
      expect(context.traceAvailable).toBe(input.result!.trace !== null);
      expect(context.snippets.length).toBeLessThanOrEqual(2);
      expect(context.facts.length).toBeLessThanOrEqual(12);
      if (!context.traceAvailable) {
        expect(context.cursor).toBeNull();
        expect(context.facts.every((f) => f.kind === 'diagnostic')).toBe(true);
      }
      for (const p of providers) {
        const request: AiRequest = {
          ...structuredClone(fixtures.examples[index].request),
          context,
          provider: { providerId: p.id, model: p.model },
        };
        const body = canonical(providerPayload(request));
        expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(6144);
        for (const field of [
          sentinel,
          request.requestId,
          request.configRevision,
          context.contextId,
          context.runRef.runId,
          context.inputRevision,
          'rawInput',
          'learningArchive',
          'weaknessSummary',
        ])
          expect(body).not.toContain(field);
      }
    });
  it('rejects a changed byte slice, state value and cursor against the original packet', () => {
    const input = original(0),
      context = buildContext(input);
    const changed = structuredClone(context);
    changed.snippets[0].text += 'x';
    expect(() => validateOriginal(changed, input)).toThrow();
    const stale = structuredClone(context);
    stale.cursor = 0;
    expect(() => validateOriginal(stale, input)).toThrow();
    const state = context.facts.find((f) => f.kind === 'state');
    expect(state).toBeDefined();
    if (state?.kind === 'state') state.value = 123456;
    expect(() => validateOriginal(context, input)).toThrow();
  });
  it('rejects over-budget UTF8 selection and an unavailable run', () => {
    const input = original(0);
    input.source = '汉'.repeat(700);
    input.selection = { start: 0, end: input.source.length };
    expect(() => buildContext(input)).toThrow('E_AI_CONTEXT_LIMIT');
    input.result = null;
    expect(() => buildContext(input)).toThrow('E_AI_INSUFFICIENT_CONTEXT');
  });
  it('rejects duplicate and escaped duplicate JSON keys before parsing can hide them', () => {
    for (const body of [
      '{"a":1,"a":2}',
      '{"a":1,"\\u0061":2}',
      '{"a":{"b":1,"b":2}}',
      '['.repeat(34) + '0' + ']'.repeat(34),
    ])
      expect(() => parseBounded(body, 1024)).toThrow('E_AI_PROTOCOL_INVALID');
  });
});
describe('simulated API lifecycle; never real model success evidence', () => {
  it('rejects non-loopback HTTP before sending any Key or capability request', async () => {
    for (const origin of [
      'http://192.168.0.2:4173',
      'http://example.com',
      'file://',
      'https://name:secret@example.com',
    ]) {
      const fetcher = vi.fn();
      const session = new AiSession(fetcher, '/', undefined, () => origin);
      session.choose({ providerId: 'openai', model: providers[0].model });
      session.setKey(sentinel);
      await session.verify();
      expect(fetcher).not.toHaveBeenCalled();
      expect(session.getSnapshot()).toMatchObject({
        enabled: false,
        hasApiKey: false,
        code: 'E_AI_UNSUPPORTED_ORIGIN',
      });
    }
    for (const origin of [
      'http://127.0.0.1:4173',
      'http://localhost:5173',
      'http://[::1]:4173',
      'https://example.com',
    ])
      expect(supportedOrigin(origin)).toBe(true);
  });
  it('preview bytes are immutable and confirmation receives a fresh click identity', async () => {
    const h = harness();
    await h.enable();
    const request = h.preview();
    expect(Object.isFrozen(request.context.facts)).toBe(true);
    expect(Object.isFrozen(request.context.snippets[0])).toBe(true);
    expect(() => {
      request.context.snippets[0].text = 'changed after preview';
    }).toThrow(TypeError);
    await h.session.send(request);
    const posted = JSON.parse(String(h.calls[2].init.body));
    expect(posted.confirmationId).not.toBe(request.confirmationId);
    expect(posted.context).toEqual(request.context);
    h.session.clear();
  });
  it('defaults off without API calls or preselected paid service', () => {
    const h = harness();
    expect(h.session.getSnapshot()).toMatchObject({
      enabled: false,
      provider: null,
      hasApiKey: false,
      verified: false,
    });
    expect(h.calls).toHaveLength(0);
  });
  it('missing or malformed Key never starts network verification', async () => {
    for (const key of ['', 'contains whitespace', 'x\ny', '汉', 'x'.repeat(4097)]) {
      const h = harness();
      h.session.choose({ providerId: 'openai', model: providers[0].model });
      h.session.setKey(key);
      await h.session.verify();
      expect(h.calls).toHaveLength(0);
      expect(h.session.getSnapshot().enabled).toBe(false);
    }
  });
  it('verification sends the transient Key only in its sensitive header and no C code', async () => {
    const h = harness();
    await h.enable();
    expect(h.calls.map((c) => c.path)).toEqual(['capabilities', 'verify']);
    const call = h.calls[1];
    expect((call.init.headers as Record<string, string>)['X-CViz-API-Key']).toBe(sentinel);
    expect(call.init.body).not.toContain(sentinel);
    expect(call.init.body).not.toContain('snippets');
    expect(call.init).toMatchObject({
      credentials: 'omit',
      mode: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(JSON.stringify(h.session.getSnapshot())).not.toContain(sentinel);
    expect(JSON.stringify(h.session)).not.toContain(sentinel);
    h.session.clear();
  });
  it('preview makes no inference request; one explicit send validates a complete current response', async () => {
    const h = harness();
    await h.enable();
    const request = h.preview();
    expect(h.calls).toHaveLength(2);
    await h.session.send(request);
    expect(h.calls).toHaveLength(3);
    expect(h.session.getSnapshot().response?.requestId).toBe(request.requestId);
    expect(h.calls[2].init.body).not.toContain(sentinel);
    h.session.clear();
  });
  it('config change rejects a late verification result even when the test transport ignores abort', async () => {
    let finish!: (v: Response) => void;
    let init: RequestInit | undefined;
    const session = new AiSession(
      async (url, options) => {
        if (String(url).endsWith('capabilities')) return json(capabilities);
        init = options;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      },
      '/',
      undefined,
      () => 'http://127.0.0.1',
    );
    session.choose({ providerId: 'openai', model: providers[0].model });
    session.setKey(sentinel);
    const pending = session.verify();
    await vi.waitFor(() => expect(finish).toBeDefined());
    const req = JSON.parse(String(init!.body));
    session.setKey('SECOND_DESIGN_ONLY_KEY');
    expect(init!.signal!.aborted).toBe(true);
    finish(json({ ...req, kind: 'config.checked', verified: true, code: null }));
    await pending;
    expect(session.getSnapshot().enabled).toBe(false);
    session.clear();
  });
  for (const action of ['cancel', 'invalidateContext', 'clear', 'setKey', 'choose'] as const)
    it(`${action} aborts and prevents an old simulated answer from returning`, async () => {
      let finish!: (v: Response) => void;
      let signal: AbortSignal | null | undefined;
      const h = harness(async (_r, init) => {
        signal = init.signal;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      });
      await h.enable();
      const request = h.preview();
      const pending = h.session.send(request);
      await h.session.send(request);
      expect(h.calls.filter((c) => c.path === 'explain')).toHaveLength(1);
      if (action === 'choose')
        h.session.choose({ providerId: 'deepseek', model: providers[1].model });
      else if (action === 'setKey') h.session.setKey('SECOND_DESIGN_ONLY_KEY');
      else h.session[action]();
      expect(signal!.aborted).toBe(true);
      finish(json(response(request)));
      await pending;
      expect(h.session.getSnapshot().response).toBeNull();
      expect(h.session.getSnapshot().preview).toBeNull();
      h.session.clear();
    });
  it('unknown references, wrong identities, provider substitutions and 60000ms responses are rejected', () => {
    const req = fixtures.examples[0].request as AiRequest;
    for (const mutate of [
      (r: AiResponse) => {
        r.content.explanations[0].factIds = ['f12'];
      },
      (r: AiResponse) => {
        r.configRevision = crypto.randomUUID();
      },
      (r: AiResponse) => {
        r.confirmationId = crypto.randomUUID();
      },
      (r: AiResponse) => {
        r.timing.elapsedMs = 60000;
      },
      (r: AiResponse) => {
        r.provider.returnedModel = 'unlisted';
      },
    ]) {
      const r = response(req);
      mutate(r);
      expect(() => validateResponse(r, req)).toThrow(AiFailure);
    }
  });
  it('auth failure clears the Key and raw provider errors never enter UI state', async () => {
    const h = harness(async () => json({ code: 'E_AI_AUTH' }, 401));
    await h.enable();
    await h.session.send(h.preview());
    expect(h.session.getSnapshot()).toMatchObject({
      code: 'E_AI_AUTH',
      enabled: false,
      hasApiKey: false,
      response: null,
    });
    const unsafe = harness(async () => json({ code: 'E_AI_PROVIDER', message: sentinel }, 500));
    await unsafe.enable();
    await unsafe.session.send(unsafe.preview());
    expect(JSON.stringify(unsafe.session.getSnapshot())).not.toContain(sentinel);
    expect(unsafe.session.getSnapshot().response).toBeNull();
    unsafe.session.clear();
  });
  it('the original 60s deadline wins and later packets cannot revive a result', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (v: Response) => void;
      const h = harness(
        async () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
      await h.enable();
      const req = h.preview();
      const pending = h.session.send(req);
      await vi.advanceTimersByTimeAsync(60000);
      expect(h.session.getSnapshot().code).toBe('E_AI_DEADLINE');
      finish(json(response(req)));
      await pending;
      expect(h.session.getSnapshot().response).toBeNull();
      h.session.clear();
    } finally {
      vi.useRealTimers();
    }
  });
  it('separate tab sessions do not share a configured Key', async () => {
    const first = harness(),
      second = harness();
    await first.enable();
    expect(second.session.getSnapshot()).toMatchObject({
      enabled: false,
      provider: null,
      hasApiKey: false,
    });
    first.session.clear();
    second.session.clear();
  });
});
