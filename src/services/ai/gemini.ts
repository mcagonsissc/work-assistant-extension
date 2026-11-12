import { z } from 'zod';
import { AIError, parseAssistantResponse, responseJSONSchema } from './schema';
import { ProviderHTTP, providerHTTPError, throwEmbeddedProviderError } from './http';
import { correctionMessage, type AIModel, type AIProvider, type CompletionOptions, type ProviderMessage } from './provider';

export function geminiModelId(value: string) {
  const id = value.replace(/^models\//, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id)) throw new AIError('configuration', 'Enter a Gemini model ID, optionally prefixed with models/.');
  return id;
}
const pageSchema = z.object({ models: z.array(z.unknown()).max(1000).default([]), nextPageToken: z.string().max(4096).optional() });
const modelSchema = z.object({ name: z.string().regex(/^models\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/), displayName: z.string().max(300).optional(), inputTokenLimit: z.number().optional(), supportedGenerationMethods: z.array(z.string()) });
export function parseGeminiModelPage(raw: unknown) {
  const page = pageSchema.safeParse(raw);
  if (!page.success) throw new AIError('invalid_response', 'Gemini returned an invalid model catalog. Retry discovery or enter a model ID manually.');
  const models: AIModel[] = [];
  for (const entry of page.data.models) {
    const parsed = modelSchema.safeParse(entry);
    if (!parsed.success || !parsed.data.supportedGenerationMethods.includes('generateContent')) continue;
    const m = parsed.data, id = geminiModelId(m.name);
    if (/(image|tts|audio|robotics|computer-use)/i.test(id)) continue;
    models.push({ id, name: m.displayName ?? id, free: false, promptPrice: null, completionPrice: null, structured: true, contextLength: m.inputTokenLimit ?? null });
  }
  return { models, nextPageToken: page.data.nextPageToken };
}
export function geminiMessages(messages: ProviderMessage[]) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const contents: { role: 'user'|'model'; parts: { text: string }[] }[] = [];
  for (const message of messages.filter(m => m.role !== 'system')) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const previous = contents[contents.length - 1];
    if (previous?.role === role) previous.parts.push({ text: message.content });
    else contents.push({ role, parts: [{ text: message.content }] });
  }
  return { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents };
}
const completionSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({ finishReason: z.string().optional(), content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })) }).optional() })).optional(),
});
export class GeminiProvider implements AIProvider {
  private http: ProviderHTTP;
  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis), timeoutMs = 30_000) { this.http = new ProviderHTTP('https://generativelanguage.googleapis.com/v1beta', 'Gemini', fetcher, timeoutMs); }
  async listModels(signal?: AbortSignal, apiKey?: string) {
    if (!apiKey) throw new AIError('configuration', 'Enter your Gemini API key before discovering models.');
    const models: AIModel[] = [], seen = new Set<string>();
    let token: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await this.http.request(`/models?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { method: 'GET', headers: { 'x-goog-api-key': apiKey } }, 4_000_000, signal);
      if (result.status !== 200) throw providerHTTPError('Gemini', result.status, result.retryAfter);
      throwEmbeddedProviderError(result.body, 'Gemini', result.retryAfter);
      const parsed = parseGeminiModelPage(result.body);
      models.push(...parsed.models);
      if (!parsed.nextPageToken) {
        if (!models.length) throw new AIError('invalid_response', 'No Gemini text-generation models were found. Retry discovery or enter a compatible model ID manually.');
        return [...new Map(models.map(m => [m.id, m])).values()].sort((a,b) => a.name.localeCompare(b.name));
      }
      if (seen.has(parsed.nextPageToken)) break;
      token = parsed.nextPageToken; seen.add(token);
    }
    throw new AIError('invalid_response', 'Gemini model discovery exceeded its pagination limit. Enter a model ID manually or retry later.');
  }
  async complete(options: CompletionOptions) {
    const model = geminiModelId(options.model.id);
    const { $schema: _schema, ...schema } = responseJSONSchema;
    let structured = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages = attempt ? [...options.messages, correctionMessage] : options.messages;
      const result = await this.http.request(`/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': options.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...geminiMessages(messages), generationConfig: { maxOutputTokens: 4096, ...(structured ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}) } }),
      }, 256_000, options.signal);
      if ((result.status === 400 || result.status === 422) && structured && attempt === 0) { structured = false; continue; }
      if (result.status < 200 || result.status >= 300) throw providerHTTPError('Gemini', result.status, result.retryAfter);
      throwEmbeddedProviderError(result.body, 'Gemini', result.retryAfter);
      const parsed = completionSchema.safeParse(result.body);
      if (parsed.success && (!parsed.data.promptFeedback?.blockReason || parsed.data.promptFeedback.blockReason === 'BLOCK_REASON_UNSPECIFIED')) {
        const candidate = parsed.data.candidates?.[0];
        if (candidate?.finishReason === 'STOP') {
          try { return { response: parseAssistantResponse((candidate.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join(''), [options.apiKey]), attempts: attempt + 1 }; }
          catch (error) { if (attempt === 1) throw error; }
        }
      }
    }
    throw new AIError('invalid_response', 'Gemini returned a blocked, incomplete or invalid response. No task data changed. Try a smaller request or another model.');
  }
}
