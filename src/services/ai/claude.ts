import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AIError, assistantResponseSchema, parseAssistantResponse } from './schema';
import { providerHTTPError } from './http';
import { correctionMessage, type AIModel, type AIProvider, type CompletionOptions, type ProviderMessage } from './provider';

const invalid = () => new AIError('invalid_response', 'Claude returned a refused, incomplete or invalid response. No task data changed. Try a smaller request or another model.');
function failure(error: unknown, signal?: AbortSignal): AIError {
  if (error instanceof AIError) return error;
  if (signal?.aborted || error instanceof Anthropic.APIUserAbortError) return new AIError('cancelled', 'AI request cancelled. No task changes were applied.');
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AIError('timeout', 'The AI request timed out. Retry or choose a faster model.');
  if (error instanceof Anthropic.APIConnectionError) return new AIError('network', 'Claude could not be reached. Check your connection; manual tasks and scheduling still work offline.');
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') return providerHTTPError('Claude', error.status, error.headers?.get('retry-after'));
  return new AIError('unavailable', 'Claude could not complete this request. Please retry later.');
}
export function claudeMessages(messages: ProviderMessage[]) {
  return {
    system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'),
    messages: messages.filter((m): m is ProviderMessage & { role: 'user' | 'assistant' } => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
  };
}
/** Claude through the Anthropic API with the user's own API key. Claude subscriptions cannot be used here. */
export class ClaudeProvider implements AIProvider {
  constructor(private fetcher?: typeof fetch, private timeoutMs = 120_000) {}
  // The key stays on this device and is sent only to api.anthropic.com. No automatic retries: each attempt can be billed.
  private client(apiKey: string) { return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: this.timeoutMs, ...(this.fetcher ? { fetch: this.fetcher } : {}) }); }
  async listModels(signal?: AbortSignal, apiKey?: string): Promise<AIModel[]> {
    if (!apiKey) throw new AIError('configuration', 'Enter your Claude API key before discovering models.');
    try {
      const models: AIModel[] = [];
      for await (const model of this.client(apiKey).models.list({ limit: 100 }, { signal })) {
        models.push({ id: model.id, name: model.display_name || model.id, free: false, promptPrice: null, completionPrice: null, structured: true, contextLength: model.max_input_tokens ?? null });
        if (models.length >= 500) break;
      }
      if (!models.length) throw new AIError('invalid_response', 'No Claude models were found. Retry discovery or enter a model ID manually.');
      return models;
    } catch (error) { throw failure(error, signal); }
  }
  async complete(options: CompletionOptions) {
    const client = this.client(options.apiKey);
    let structured = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { system, messages } = claudeMessages(attempt ? [...options.messages, correctionMessage] : options.messages);
      let message: Anthropic.Message;
      try {
        message = await client.messages.create({ model: options.model.id, max_tokens: 16000, system, messages, ...(structured ? { output_config: { format: zodOutputFormat(assistantResponseSchema) } } : {}) }, { signal: options.signal });
      } catch (error) {
        // A model without structured-output support rejects the format: retry once as schema-guided text.
        if (error instanceof Anthropic.BadRequestError && structured && attempt === 0) { structured = false; continue; }
        throw failure(error, options.signal);
      }
      if (message.stop_reason !== 'end_turn') continue; // refusal, max_tokens or anything else incomplete
      const text = message.content.filter((block): block is Anthropic.TextBlock => block.type === 'text').map(block => block.text).join('');
      try { return { response: parseAssistantResponse(text, [options.apiKey]), attempts: attempt + 1 }; }
      catch (error) { if (attempt === 1) throw error; }
    }
    throw invalid();
  }
}
