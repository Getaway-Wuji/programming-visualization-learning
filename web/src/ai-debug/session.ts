import { checked, check, error as errorSchema } from '../generated/ai/schema.generated.mjs';
import {
  AiFailure,
  bytes,
  canonical,
  ensure,
  errorCode,
  fail,
  parseBounded,
  providers,
  validateRequest,
  validateResponse,
  type AiCode,
  type AiContext,
  type AiRequest,
  type AiResponse,
  type Provider,
} from './protocol';
import { validateProjection } from './projection';

export interface AiSnapshot {
  enabled: boolean;
  provider: Provider | null;
  configRevision: string;
  hasApiKey: boolean;
  verified: boolean;
  state: 'disabled' | 'checking' | 'ready' | 'busy' | 'unavailable';
  code: AiCode | null;
  preview: AiRequest | null;
  response: AiResponse | null;
  providerBytes: number;
}
type Fetcher = typeof fetch;
function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
export function supportedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
export class AiSession {
  #key = '';
  #abort: AbortController | null = null;
  #generation = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #listeners = new Set<() => void>();
  #snapshot: AiSnapshot = this.initial();
  constructor(
    private readonly fetcher: Fetcher = (...args) => fetch(...args),
    private readonly base = import.meta.env.BASE_URL,
    private readonly clock = () => performance.now(),
    private readonly origin = () => globalThis.location?.origin ?? '',
  ) {}
  private initial(): AiSnapshot {
    return immutable({
      enabled: false,
      provider: null,
      configRevision: crypto.randomUUID(),
      hasApiKey: false,
      verified: false,
      state: 'disabled',
      code: null,
      preview: null,
      response: null,
      providerBytes: 0,
    });
  }
  readonly getSnapshot = () => this.#snapshot;
  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  private publish(patch: Partial<AiSnapshot>) {
    this.#snapshot = immutable({ ...this.#snapshot, ...patch });
    for (const listener of this.#listeners) listener();
  }
  private stop() {
    this.#generation++;
    this.#abort?.abort();
    this.#abort = null;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
  clear() {
    this.stop();
    this.#key = '';
    this.#snapshot = this.initial();
    for (const listener of this.#listeners) listener();
  }
  choose(provider: Provider | null) {
    this.clear();
    this.publish({ provider: provider ? { ...provider } : null });
  }
  supported() {
    return supportedOrigin(this.origin());
  }
  setKey(key: string) {
    this.stop();
    this.#key = key;
    this.publish({
      enabled: false,
      verified: false,
      hasApiKey: key.length > 0,
      configRevision: crypto.randomUUID(),
      state: 'disabled',
      code: null,
      preview: null,
      response: null,
    });
  }
  invalidateContext() {
    this.stop();
    this.publish({
      preview: null,
      response: null,
      providerBytes: 0,
      code: null,
      state: this.#snapshot.enabled ? 'ready' : 'disabled',
    });
  }
  cancel() {
    this.stop();
    this.publish({
      preview: null,
      response: null,
      providerBytes: 0,
      code: 'E_AI_CANCELLED',
      state: this.#snapshot.enabled ? 'ready' : 'disabled',
    });
  }
  private start(limit: number) {
    this.stop();
    const token = this.#generation,
      abort = new AbortController(),
      start = this.clock();
    this.#abort = abort;
    this.#timer = setTimeout(() => {
      if (token !== this.#generation) return;
      this.stop();
      this.publish({
        state: this.#snapshot.enabled ? 'ready' : 'disabled',
        code: 'E_AI_DEADLINE',
        response: null,
        preview: null,
      });
    }, limit);
    return { token, signal: abort.signal, start };
  }
  private current(token: number) {
    return token === this.#generation;
  }
  private finish(token: number) {
    if (!this.current(token)) return;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#abort = null;
  }
  private failed(error: unknown, token: number) {
    if (!this.current(token)) return;
    const code = error instanceof AiFailure ? error.code : 'E_AI_NETWORK';
    if (code === 'E_AI_AUTH') {
      this.clear();
      this.publish({ code });
    } else
      this.publish({
        state: this.#snapshot.enabled ? 'ready' : 'disabled',
        code,
        response: null,
        preview: null,
      });
  }
  private async packet(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    key?: string,
  ): Promise<unknown> {
    if (key) ensure(this.supported(), 'E_AI_UNSUPPORTED_ORIGIN');
    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (key) headers['X-CViz-API-Key'] = key;
    const response = await this.fetcher(`${this.base}api/ai/v2/${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? canonical(body) : undefined,
      signal,
      mode: 'same-origin',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    ensure(
      response.headers.get('content-type')?.split(';')[0].trim() === 'application/json',
      'E_AI_UNAVAILABLE',
    );
    ensure(response.body, 'E_AI_UNAVAILABLE');
    const reader = response.body.getReader(),
      decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '',
      count = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        count += part.value.byteLength;
        if (count > 12288) {
          await reader.cancel();
          fail('E_AI_RESULT_LIMIT');
        }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const packet = parseBounded(text, 12288);
    if (!response.ok) {
      const item = packet as { code?: unknown };
      ensure(
        item &&
          typeof item === 'object' &&
          Object.keys(item).length === 1 &&
          typeof item.code === 'string',
      );
      fail(errorCode(item.code));
    }
    return packet;
  }
  async verify() {
    if (!this.supported()) {
      this.clear();
      this.publish({ code: 'E_AI_UNSUPPORTED_ORIGIN' });
      return;
    }
    if (this.#snapshot.state === 'checking' || this.#snapshot.state === 'busy') return;
    const provider = this.#snapshot.provider,
      key = this.#key.trim();
    if (
      !provider ||
      !providers.some((p) => p.id === provider.providerId && p.model === provider.model) ||
      !/^[\x21-\x7e]{1,4096}$/.test(key)
    ) {
      this.publish({ enabled: false, code: 'E_AI_UNCONFIGURED' });
      return;
    }
    this.#key = key;
    const configRevision = this.#snapshot.configRevision,
      requestId = crypto.randomUUID();
    const task = this.start(10000);
    this.publish({
      enabled: false,
      verified: false,
      state: 'checking',
      code: null,
      preview: null,
      response: null,
    });
    try {
      const capabilities = await this.packet('capabilities', task.signal);
      ensure(
        capabilities !== null &&
          typeof capabilities === 'object' &&
          canonical(capabilities) ===
            canonical({
              aiVersion: '2.0.0',
              kind: 'ai.capabilities',
              available: true,
              providers: providers.map((p) => ({ providerId: p.id, model: p.model })),
            }),
        'E_AI_UNAVAILABLE',
      );
      if (!this.current(task.token)) return;
      const request = {
        aiVersion: '2.0.0',
        kind: 'config.check',
        requestId,
        configRevision,
        provider,
      };
      ensure(check(request) && bytes(canonical(request)) <= 1024);
      const result = await this.packet('verify', task.signal, request, key);
      if (!this.current(task.token)) return;
      ensure(checked(result));
      const response = result as {
        requestId: string;
        configRevision: string;
        provider: Provider;
        verified: boolean;
        code: AiCode | null;
      };
      ensure(
        response.requestId === requestId &&
          response.configRevision === configRevision &&
          canonical(response.provider) === canonical(provider),
        'E_AI_CONTEXT_STALE',
      );
      if (!response.verified) fail(errorCode(response.code));
      this.publish({ enabled: true, verified: true, state: 'ready', code: null });
    } catch (error) {
      this.failed(error, task.token);
    } finally {
      this.finish(task.token);
    }
  }
  preview(context: AiContext) {
    try {
      ensure(
        this.#snapshot.enabled && this.#snapshot.verified && this.#key && this.#snapshot.provider,
        'E_AI_DISABLED',
      );
      ensure(this.#snapshot.state !== 'busy', 'E_AI_BUSY');
      const request: AiRequest = {
        aiVersion: '2.0.0',
        kind: 'explain.request',
        requestId: crypto.randomUUID(),
        configRevision: this.#snapshot.configRevision,
        confirmationId: crypto.randomUUID(),
        provider: { ...this.#snapshot.provider },
        context: structuredClone(context),
      };
      validateRequest(request);
      const providerBytes = validateProjection(request);
      this.publish({ preview: request, response: null, code: null, providerBytes });
    } catch (error) {
      this.publish({
        code: error instanceof AiFailure ? error.code : 'E_AI_PROTOCOL_INVALID',
        preview: null,
        response: null,
      });
    }
  }
  report(code: AiCode) {
    this.publish({ code });
  }
  async send(prepared: AiRequest) {
    if (
      this.#snapshot.state === 'busy' ||
      !this.#snapshot.enabled ||
      !this.#key ||
      this.#snapshot.preview !== prepared
    )
      return;
    const key = this.#key,
      task = this.start(60000);
    const preview = immutable({ ...prepared, confirmationId: crypto.randomUUID() });
    this.publish({ state: 'busy', response: null, code: null });
    try {
      validateRequest(preview);
      validateProjection(preview);
      const packet = await this.packet('explain', task.signal, preview, key);
      if (!this.current(task.token)) return;
      ensure(this.clock() - task.start < 60000, 'E_AI_DEADLINE');
      if (errorSchema(packet)) {
        const error = packet as {
          code: AiCode;
          requestId: string;
          configRevision: string;
          confirmationId: string;
          contextId: string;
        };
        ensure(
          error.requestId === preview.requestId &&
            error.configRevision === preview.configRevision &&
            error.confirmationId === preview.confirmationId &&
            error.contextId === preview.context.contextId,
          'E_AI_CONTEXT_STALE',
        );
        fail(error.code);
      }
      const response = validateResponse(packet, preview);
      this.publish({ response, state: 'ready', preview: null });
    } catch (error) {
      this.failed(error, task.token);
    } finally {
      this.finish(task.token);
    }
  }
}
