import { ChatGPTProvider } from './chatgpt';
import { openRouter } from './openrouter';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import { ClaudeProvider } from './claude';
import type { AIProvider, ProviderId } from './provider';
const providers: Record<ProviderId, AIProvider> = { openrouter: openRouter, openai: new OpenAIProvider(), gemini: new GeminiProvider(), claude: new ClaudeProvider(), chatgpt: new ChatGPTProvider() };
export function getProvider(id: ProviderId): AIProvider { return providers[id]; }
