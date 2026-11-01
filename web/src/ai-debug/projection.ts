import modelSchema from './model-schema.generated.json';
import systemPrompt from '../../../shared/ai/system-prompt.txt?raw';
import { bytes, canonical, ensure, type AiRequest } from './protocol';
export function providerPayload(request: AiRequest) {
  const content = canonical({ snippets: request.context.snippets, facts: request.context.facts });
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content },
  ];
  if (request.provider.providerId === 'deepseek')
    return {
      model: request.provider.model,
      stream: false,
      max_tokens: 768,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      messages,
    };
  const schema = structuredClone(modelSchema);
  const replacement = { type: 'string', enum: request.context.facts.map((f) => f.factId) };
  // The API schema uses a supported subset. Local validation also enforces uniqueness.
  const output = JSON.parse(
    JSON.stringify(schema, (key, value) => (key === 'uniqueItems' ? undefined : value)),
  );
  output.properties.explanations.items.properties.factIds.items = replacement;
  return {
    model: request.provider.model,
    stream: false,
    n: 1,
    reasoning_effort: 'none',
    max_completion_tokens: 768,
    store: false,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'cviz_explanation_v2', strict: true, schema: output },
    },
    messages,
  };
}
export function validateProjection(request: AiRequest): number {
  const count = bytes(canonical(providerPayload(request)));
  ensure(count <= 6144, 'E_AI_CONTEXT_LIMIT');
  return count;
}
