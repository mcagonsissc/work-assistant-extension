import type { AssistantResponse } from './schema';
export const providerIds = ['openrouter', 'openai', 'gemini', 'claude', 'chatgpt'] as const;
export type ProviderId = typeof providerIds[number];
export const providerLabels: Record<ProviderId, string> = { openrouter: 'OpenRouter', openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude', chatgpt: 'ChatGPT plan' };
export interface AIModel { id: string; name: string; free: boolean; promptPrice: string | null; completionPrice: string | null; structured: boolean; contextLength: number | null }
export interface ProviderMessage { role: 'system'|'user'|'assistant'; content: string }
export interface CompletionOptions { apiKey: string; accountId?: string; model: Pick<AIModel, 'id'|'structured'>; messages: ProviderMessage[]; signal?: AbortSignal }
export interface AIProvider {
  listModels(signal?: AbortSignal, apiKey?: string): Promise<AIModel[]>;
  complete(options: CompletionOptions): Promise<{ response: AssistantResponse; attempts: number }>;
}
export const correctionMessage: ProviderMessage = { role: 'user', content: 'Your previous response could not be validated. Return only one JSON object matching the provided schema. Use no unknown actions or fields; use an empty actions array if clarification is needed.' };
