import { openRouter } from './openrouter';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import type { AIProvider, ProviderId } from './provider';
const providers: Record<ProviderId, AIProvider> = { openrouter: openRouter, openai: new OpenAIProvider(), gemini: new GeminiProvider() };
export function getProvider(id: ProviderId): AIProvider { return providers[id]; }
