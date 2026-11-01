import type { AdvancedPointer, AdvancedResult } from '../engine/advanced-protocol';
import * as schema from '../generated/ai/schema.generated.mjs';

export const providers = [
  {
    id: 'openai',
    label: 'OpenAI',
    model: 'gpt-5.4-mini-2026-03-17',
    host: 'api.openai.com',
    pricing: 'https://developers.openai.com/api/docs/pricing',
    policy: 'https://developers.openai.com/api/docs/guides/your-data',
    retention: '默认滥用监测可保留内容至30天，另有法律、安全和缓存例外；本平台不承诺服务方零保留。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    model: 'deepseek-flash',
    host: 'api.deepseek.com',
    pricing: 'https://api-docs.deepseek.com/quick_start/pricing/',
    policy: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html',
    retention:
      '适用服务方API及账户条款，保留期限随目的和要求变化；本平台不承诺零保留或固定删除时间。',
  },
] as const;
export type Provider = { providerId: 'openai' | 'deepseek'; model: string };
export type ByteRange = { start: number; end: number };
export type Fact =
  | { factId: string; kind: 'diagnostic'; code: string; byteRange: ByteRange | null }
  | {
      factId: string;
      kind: 'step';
      step: number;
      stepKind: string;
      nodeId: string;
      byteRange: ByteRange | null;
    }
  | {
      factId: string;
      kind: 'state';
      atCursor: number;
      objectId: string;
      frameId: string | null;
      byteOffset: number;
      name: string;
      typeName: string;
      alive: boolean;
      value: number | AdvancedPointer | null;
    };
export interface AiContext {
  contextId: string;
  runRef: {
    engineId: 'engine.rust.advanced';
    buildId: string;
    execVersion: '1.4.0';
    dslVersion: '1.3.0';
    diagnosticVersion: '1.3.0';
    language: 'c';
    runId: string;
    sourceRevision: string;
  };
  inputRevision: string;
  cursor: number | null;
  traceAvailable: boolean;
  snippets: { snippetId: string; byteRange: ByteRange; firstLine: number; text: string }[];
  facts: Fact[];
}
export interface AiRequest {
  aiVersion: '2.0.0';
  kind: 'explain.request';
  requestId: string;
  configRevision: string;
  confirmationId: string;
  provider: Provider;
  context: AiContext;
}
export interface AiContent {
  summary: string;
  explanations: { factIds: string[]; text: string }[];
  suggestions: string[];
  limitations: string;
}
export interface AiResponse {
  aiVersion: '2.0.0';
  kind: 'explain.response';
  requestId: string;
  configRevision: string;
  confirmationId: string;
  contextId: string;
  runRef: AiContext['runRef'];
  inputRevision: string;
  cursor: number | null;
  producer: 'provider-api-adapter';
  provider: {
    providerId: Provider['providerId'];
    configVersion: '2.0.0';
    requestedModel: string;
    returnedModel: string;
  };
  content: AiContent;
  timing: { elapsedMs: number };
}
export const messages = {
  E_AI_DISABLED: 'AI解释已关闭。可在设置中自备Key后开启。',
  E_AI_UNCONFIGURED: '请选择受支持的服务和模型，并填写自己的API Key。',
  E_AI_UNAVAILABLE: '当前入口未连接AI转发服务，普通学习与代码执行仍可使用。',
  E_AI_UNSUPPORTED_ORIGIN: '当前地址不支持安全的同源AI转发。',
  E_AI_UNSUPPORTED_PROVIDER: '该服务不在支持范围内。',
  E_AI_MODEL_MISMATCH: '所选模型不可用或返回了未登记的模型，请检查配置。',
  E_AI_AUTH: 'API Key鉴权失败，已清除临时Key并关闭AI。请在设置中重新填写。',
  E_AI_PERMISSION: '此Key没有所需接口或模型权限。',
  E_AI_QUOTA: '服务方报告额度不足，请到该服务管理账户后再手动请求。',
  E_AI_RATE_LIMIT: '服务方限流，请稍后手动重试。',
  E_AI_NETWORK: '无法连接所选服务，本次未得到解释。',
  E_AI_PROVIDER: '所选服务暂时出错，本次未得到解释。',
  E_AI_REFUSED: '服务方没有提供可用解释。',
  E_AI_BUSY: '已有AI请求进行中，请先取消或等待结束。',
  E_AI_CONTEXT_LIMIT: '选中的代码或事实超过发送预算，请缩小选区。',
  E_AI_INSUFFICIENT_CONTEXT: '当前没有足够的真实事实，请先运行代码或移动到已执行步骤。',
  E_AI_CONTEXT_STALE: '代码、输入、步骤或配置已变化，请重新核对预览。',
  E_AI_PROTOCOL_INVALID: '服务返回的内容不符合约定，已整包拒绝。',
  E_AI_INVALID_REFERENCE: '解释引用了未提供的事实，已整包拒绝。',
  E_AI_RESULT_LIMIT: '返回内容超出限制，已停止接收。',
  E_AI_DEADLINE: '已到等待时限，本端已停止；服务方仍可能处理并收费。',
  E_AI_CANCELLED: '已取消本端等待；服务方仍可能处理并收费。',
} as const;
export type AiCode = keyof typeof messages;
export class AiFailure extends Error {
  constructor(readonly code: AiCode) {
    super(code);
  }
}
export function fail(code: AiCode): never {
  throw new AiFailure(code);
}
export function ensure(value: unknown, code: AiCode = 'E_AI_PROTOCOL_INVALID'): asserts value {
  if (!value) fail(code);
}
export function errorCode(value: unknown): AiCode {
  return typeof value === 'string' && Object.hasOwn(messages, value)
    ? (value as AiCode)
    : 'E_AI_PROTOCOL_INVALID';
}
export const bytes = (text: string) => new TextEncoder().encode(text).length;
export const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
export function parseBounded(text: string, limit: number): unknown {
  ensure(bytes(text) <= limit, 'E_AI_RESULT_LIMIT');
  // Inspect keys before JSON.parse; native parsing alone would hide duplicate keys.
  const stack: { object: boolean; key: boolean; seen: Set<string> }[] = [];
  const tokens = /"(?:[^"\\]|\\.)*"|[{}[\]:,]/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0],
      top = stack.at(-1);
    if (token === '{' || token === '[') {
      ensure(stack.length < 32);
      stack.push({ object: token === '{', key: token === '{', seen: new Set() });
    } else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && top?.object) top.key = true;
    else if (token.startsWith('"') && top?.object && top.key) {
      const key: string = JSON.parse(token);
      ensure(!top.seen.has(key));
      top.seen.add(key);
      top.key = false;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return fail('E_AI_PROTOCOL_INVALID');
  }
}
export function validateRequest(request: AiRequest) {
  ensure(schema.request(request));
  ensure(bytes(canonical(request)) <= 16384, 'E_AI_CONTEXT_LIMIT');
}
export function validateResponse(value: unknown, request: AiRequest): AiResponse {
  ensure(schema.response(value));
  const response = value as AiResponse;
  for (const key of ['requestId', 'configRevision', 'confirmationId'] as const)
    ensure(response[key] === request[key], 'E_AI_CONTEXT_STALE');
  for (const key of ['contextId', 'runRef', 'inputRevision', 'cursor'] as const)
    ensure(equal(response[key], request.context[key]), 'E_AI_CONTEXT_STALE');
  ensure(
    response.provider.providerId === request.provider.providerId &&
      response.provider.requestedModel === request.provider.model,
    'E_AI_MODEL_MISMATCH',
  );
  const ids = new Set(request.context.facts.map((f) => f.factId));
  ensure(
    response.content.explanations.every((e) => e.factIds.every((id) => ids.has(id))),
    'E_AI_INVALID_REFERENCE',
  );
  ensure(
    bytes(canonical(response.content)) <= 8192 && bytes(canonical(response)) <= 12288,
    'E_AI_RESULT_LIMIT',
  );
  return response;
}
export function factLabel(fact: Fact): string {
  if (fact.kind === 'diagnostic') return `本次运行诊断：${fact.code}`;
  if (fact.kind === 'step') return `已执行步骤 ${fact.step}（${fact.stepKind}）`;
  return `步骤 ${fact.atCursor} 的 ${fact.name} +${fact.byteOffset}：${canonical(fact.value)}${fact.alive ? '' : '（已释放）'}`;
}
export type AcceptedRun = { source: string; result: AdvancedResult };
