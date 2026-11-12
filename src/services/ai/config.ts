import { z } from 'zod';
import { db, type WorkdayDB } from '../../storage/db';
import { getProvider } from './registry';
import { providerIds, providerLabels, type AIProvider, type ProviderId } from './provider';
import { AIError, redactSecrets } from './schema';
import type { AIPreference } from './types';
import { geminiModelId } from './gemini';

export async function getProviderSelection(database = db): Promise<AIPreference> {
  return await database.aiPreferences.get('active') ?? { id: 'active', providerId: 'openrouter', revision: 'default' };
}
export async function setActiveProvider(providerId: ProviderId, database = db) {
  z.enum(providerIds).parse(providerId);
  await database.aiPreferences.put({ id: 'active', providerId, revision: crypto.randomUUID() });
}
export async function getPublicAIConfig(database = db, providerId?: ProviderId) {
  const id = providerId ?? (await getProviderSelection(database)).providerId;
  const row = await database.aiConfig.get(id);
  return { hasKey: !!row?.apiKey, modelId: row?.modelId ?? '', consent: row?.consent ?? false };
}
export async function getAIView(database = db) {
  return database.transaction('r', [database.aiPreferences, database.aiConfig], async () => {
    const selection = await getProviderSelection(database);
    return { ...selection, ...await getPublicAIConfig(database, selection.providerId), configRevision: (await database.aiConfig.get(selection.providerId))?.revision ?? 'legacy' };
  });
}
function validateKey(key: string) {
  if (!z.string().min(16).max(512).regex(/^[!-~]+$/).safeParse(key).success) throw new AIError('configuration', 'Enter a valid provider API key (16–512 characters, no spaces or control characters).');
}
export async function saveAIConfig(value: { key?: string; modelId: string; consent: boolean }, database: WorkdayDB = db, providerId?: ProviderId) {
  const id = providerId ?? (await getProviderSelection(database)).providerId;
  let modelId = value.modelId.trim();
  if (/^(sk-|AIza)/.test(modelId)) throw new AIError('configuration', 'Enter a model ID in the model field, not an API key.');
  modelId = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/).parse(modelId);
  if (id === 'gemini') modelId = geminiModelId(modelId);
  await database.transaction('rw', database.aiConfig, async () => {
    const previous = await database.aiConfig.get(id);
    const apiKey = value.key?.trim() || previous?.apiKey || '';
    if (apiKey) validateKey(apiKey);
    await database.aiConfig.put({ id, apiKey, modelId, consent: value.consent, revision: crypto.randomUUID() });
  });
}
export async function forgetAIKey(database = db, providerId?: ProviderId) {
  const id = providerId ?? (await getProviderSelection(database)).providerId;
  await database.transaction('rw', database.aiConfig, async () => {
    const old = await database.aiConfig.get(id);
    if (old) await database.aiConfig.put({ ...old, apiKey: '', consent: false, revision: crypto.randomUUID() });
  });
}
export async function refreshModels(provider?: AIProvider, database: WorkdayDB = db, signal?: AbortSignal, options?: { providerId?: ProviderId; apiKey?: string }) {
  const id = options?.providerId ?? (await getProviderSelection(database)).providerId;
  const config = await database.aiConfig.get(id);
  const key = options?.apiKey?.trim() || config?.apiKey || '';
  if (id !== 'openrouter') {
    if (!key) throw new AIError('configuration', `Enter your ${providerLabels[id]} API key before discovering models. You can use the key field without saving first.`);
    validateKey(key);
  }
  const received = await (provider ?? getProvider(id)).listModels(signal, id === 'openrouter' ? undefined : key);
  if (signal?.aborted) throw new AIError('cancelled', 'Model discovery cancelled.');
  if (!options?.apiKey && id !== 'openrouter' && (await database.aiConfig.get(id))?.apiKey !== key) throw new AIError('cancelled', 'Model discovery cancelled because the saved key changed.');
  const secrets = [...(await database.aiConfig.toArray()).map(c => c.apiKey), key].filter(Boolean);
  const models = received.filter(m => redactSecrets(m.id, secrets) === m.id).map(m => ({ ...m, name: redactSecrets(m.name, secrets) }));
  if (!models.length) throw new AIError('invalid_response', 'The provider returned no usable model IDs. Retry discovery or enter a model ID manually.');
  await database.modelCache.put({ id, models, fetchedAt: new Date().toISOString() });
  return models;
}
