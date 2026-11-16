import { z } from 'zod';
import type { AIModel, AIProvider, ProviderMessage } from './provider';
import { ProviderHTTP, providerHTTPError } from './http';
import { AIError, describeInvalidResponse, parseAssistantResponse, responseJSONSchema } from './schema';
const BASE_URL = 'https://openrouter.ai/api/v1';
const modelSchema = z.object({ id: z.string().min(1).max(200), name: z.string().max(300), context_length: z.number().nullable().optional(), supported_parameters: z.array(z.string()).optional(), pricing: z.object({ prompt: z.string(), completion: z.string(), request: z.string().optional() }), architecture: z.object({ input_modalities: z.array(z.string()).optional(), output_modalities: z.array(z.string()).optional(), modality: z.string().optional() }).optional() });
export function parseModels(raw: unknown): AIModel[] {
  const envelope = z.object({ data: z.array(z.unknown()).max(20_000) }).safeParse(raw);
  if (!envelope.success) throw new AIError('invalid_response', 'OpenRouter returned an invalid model catalog. Retry discovery or enter a model ID manually.');
  const models: AIModel[] = [];
  for (const entry of envelope.data.data) {
    const parsed = modelSchema.safeParse(entry); if (!parsed.success) continue;
    const m = parsed.data;
    if (m.architecture?.input_modalities && !m.architecture.input_modalities.includes('text')) continue;
    if (m.architecture?.output_modalities && !m.architecture.output_modalities.includes('text')) continue;
    if (!m.architecture?.output_modalities && m.architecture?.modality && !m.architecture.modality.endsWith('text')) continue;
    const prompt = Number(m.pricing.prompt), completion = Number(m.pricing.completion), request = Number(m.pricing.request ?? '0');
    const free = [m.pricing.prompt,m.pricing.completion,m.pricing.request??'0'].every(p=>p.trim()!=='') && [prompt, completion, request].every(n => Number.isFinite(n) && n === 0);
    models.push({ id: m.id, name: m.name, free, promptPrice: m.pricing.prompt, completionPrice: m.pricing.completion, structured: m.supported_parameters?.includes('structured_outputs') ?? false, contextLength: m.context_length ?? null });
  }
  if (!models.length) throw new AIError('invalid_response', 'No text chat models were found. Retry discovery or enter a model ID manually.');
  return [...new Map(models.map(m => [m.id,m])).values()].sort((a,b) => Number(b.free)-Number(a.free) || a.name.localeCompare(b.name));
}
export class OpenRouterProvider implements AIProvider {
  private http: ProviderHTTP;
  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis), timeoutMs = 30_000) { this.http = new ProviderHTTP(BASE_URL, 'OpenRouter', fetcher, timeoutMs); }
  async listModels(signal?: AbortSignal) {
    const result = await this.http.request('/models', { method: 'GET' }, 8_000_000, signal);
    if (result.status !== 200) throw providerHTTPError('OpenRouter', result.status,result.retryAfter);
    return parseModels(result.body);
  }
  async complete(options: { apiKey: string; model: Pick<AIModel,'id'|'structured'>; messages: ProviderMessage[]; signal?: AbortSignal }) {
    let structured = options.model.structured, rejected = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      // On the retry, show the model its own answer and exactly what was wrong with it.
      const problems = rejected ? describeInvalidResponse(rejected) : '';
      const messages = attempt ? [...options.messages, ...(rejected ? [{ role: 'assistant' as const, content: rejected.slice(0, 2000) }] : []), { role: 'user' as const, content: `Your previous response could not be validated.${problems ? ` Problems: ${problems}.` : ''} Return only one JSON object matching the provided schema. Use no unknown actions or fields; use an empty actions array if clarification is needed.` }] : options.messages;
      const result = await this.http.request('/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'AI Workday Assistant' }, body: JSON.stringify({ model: options.model.id, messages, max_tokens: 4096, stream: false, ...(structured ? { response_format: { type: 'json_schema', json_schema: { name: 'workday_actions', strict: true, schema: responseJSONSchema } }, provider: { require_parameters: true } } : {}) }) }, 256_000, options.signal);
      if (result.status === 400 && structured && attempt === 0) { structured = false; continue; }
      if (result.status < 200 || result.status >= 300) throw providerHTTPError('OpenRouter', result.status,result.retryAfter);
      const providerError=z.object({error:z.object({code:z.number()})}).safeParse(result.body);
      if(providerError.success)throw providerHTTPError('OpenRouter', providerError.data.error.code);
      const envelope = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }) })).min(1), error: z.unknown().optional() }).safeParse(result.body);
      // Never echo upstream errors, refusals, raw bodies or headers into UI/logs.
      if (envelope.success && !envelope.data.error && !envelope.data.choices[0].message.refusal && envelope.data.choices[0].finish_reason !== 'length') {
        const content = envelope.data.choices[0].message.content ?? '';
        try { return { response: parseAssistantResponse(content, [options.apiKey]), attempts: attempt + 1 }; }
        catch (e) { if (attempt === 1) throw e; rejected = content; }
      } else if (attempt === 1) throw new AIError('invalid_response', 'The model returned a refused, incomplete or invalid response. No task data changed. Try another model or a smaller request.');
    }
    throw new AIError('invalid_response', 'The model could not produce valid task actions. No task data changed.');
  }
}
export const openRouter = new OpenRouterProvider();
