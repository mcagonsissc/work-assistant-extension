import { z } from 'zod';
import { AIError, parseAssistantResponse, responseJSONSchema } from './schema';
import { ProviderHTTP, providerHTTPError, throwEmbeddedProviderError } from './http';
import { correctionMessage, type AIModel, type AIProvider, type CompletionOptions } from './provider';

const catalogSchema = z.object({ data: z.array(z.object({ id: z.string().min(1).max(200) })).max(20_000) });
export function parseOpenAIModels(raw: unknown): AIModel[] {
  const parsed = catalogSchema.safeParse(raw);
  if (!parsed.success) throw new AIError('invalid_response', 'OpenAI returned an invalid model catalog. Retry discovery or enter a model ID manually.');
  // The catalog has no modality/capability/pricing metadata. This is a conservative
  // family filter; actual Responses API access is checked by the selected request.
  const models = parsed.data.data.filter(m => /^(gpt-|chatgpt-|o\d|ft:(gpt-|o\d))/.test(m.id) && !/(audio|realtime|transcrib|tts|embedding|moderation|image|dall-e)/i.test(m.id));
  if (!models.length) throw new AIError('invalid_response', 'No likely OpenAI text models were found. Enter a Responses-compatible model ID manually.');
  return [...new Set(models.map(m => m.id))].sort().map(id => ({ id, name: id, free: false, promptPrice: null, completionPrice: null, structured: true, contextLength: null }));
}
const responseSchema = z.object({
  status: z.string(), error: z.unknown().optional(),
  output: z.array(z.object({ type: z.string(), role: z.string().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })),
});

export class OpenAIProvider implements AIProvider {
  private http: ProviderHTTP;
  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis), timeoutMs = 30_000) { this.http = new ProviderHTTP('https://api.openai.com/v1', 'OpenAI', fetcher, timeoutMs); }
  async listModels(signal?: AbortSignal, apiKey?: string) {
    if (!apiKey) throw new AIError('configuration', 'Enter your OpenAI API key before discovering models.');
    const result = await this.http.request('/models', { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } }, 4_000_000, signal);
    if (result.status !== 200) throw providerHTTPError('OpenAI', result.status, result.retryAfter);
      throwEmbeddedProviderError(result.body, 'OpenAI', result.retryAfter);
    return parseOpenAIModels(result.body);
  }
  async complete(options: CompletionOptions) {
    let structured = true;
    const { $schema: _schema, ...schema } = responseJSONSchema;
    for (let attempt = 0; attempt < 2; attempt++) {
      const input = attempt ? [...options.messages, correctionMessage] : options.messages;
      const result = await this.http.request('/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: options.model.id, input, store: false, stream: false, max_output_tokens: 4096,
          ...(structured ? { text: { format: { type: 'json_schema', name: 'workday_actions', strict: true, schema } } } : {}) }),
      }, 256_000, options.signal);
      if ((result.status === 400 || result.status === 422) && structured && attempt === 0) { structured = false; continue; }
      if (result.status < 200 || result.status >= 300) throw providerHTTPError('OpenAI', result.status, result.retryAfter);
      throwEmbeddedProviderError(result.body, 'OpenAI', result.retryAfter);
      const parsed = responseSchema.safeParse(result.body);
      if (parsed.success && parsed.data.status === 'completed' && !parsed.data.error) {
        const parts = parsed.data.output.filter(item => item.type === 'message' && item.role === 'assistant').flatMap(item => item.content ?? []);
        if (!parts.some(part => part.type === 'refusal')) {
          try { return { response: parseAssistantResponse(parts.filter(p => p.type === 'output_text').map(p => p.text ?? '').join(''), [options.apiKey]), attempts: attempt + 1 }; }
          catch (error) { if (attempt === 1) throw error; }
        }
      }
    }
    throw new AIError('invalid_response', 'OpenAI returned a refused, incomplete or invalid response. No task data changed. Try a smaller request or another model.');
  }
}
