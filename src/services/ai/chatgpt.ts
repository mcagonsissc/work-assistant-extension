import { directRequest } from './chatgpt-direct';
import { z } from 'zod';
import { AIError, parseAssistantResponse } from './schema';
import type { AIProvider, AIModel, CompletionOptions } from './provider';
export const chatGPTAccountSchema = z.object({ id: z.string().uuid(), label: z.string().max(250), connected: z.boolean(), planEnabled: z.boolean(), welcomeAcknowledged: z.boolean() });
export const chatGPTStatusSchema = z.object({ accounts: z.array(chatGPTAccountSchema).max(100), pending: z.string().uuid().nullable(), result: z.object({ id: z.string().uuid(), accountId: z.string().uuid().optional(), error: z.string().max(500).optional() }).nullable() });
export type ChatGPTStatus = z.infer<typeof chatGPTStatusSchema>;
/** Runs a ChatGPT command with the sign-in built into the extension. Returns only public status, model lists and credential-redacted text. */
export const chatGPTRequest = directRequest;
export async function chatGPTStatus() { return chatGPTStatusSchema.parse(await chatGPTRequest({ op: 'status' })); }
export class ChatGPTProvider implements AIProvider {
  async listModels(signal?: AbortSignal, accountId?: string): Promise<AIModel[]> {
    if (!accountId) throw new AIError('configuration', 'Connect a ChatGPT account first.');
    return z.array(z.object({ id: z.string().max(200), name: z.string().max(200), free: z.boolean(), promptPrice: z.string().nullable(), completionPrice: z.string().nullable(), structured: z.boolean(), contextLength: z.number().nullable() })).max(1000).parse(await chatGPTRequest({ op: 'models', accountId }, signal));
  }
  async complete(options: CompletionOptions) {
    const data = z.object({ text: z.string().max(64_000) }).parse(await chatGPTRequest({ op: 'complete', accountId: options.accountId, model: options.model.id, messages: options.messages }, options.signal));
    return { response: parseAssistantResponse(data.text), attempts: 1 };
  }
}
