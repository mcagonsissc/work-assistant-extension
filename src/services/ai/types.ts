import type { AIModel, ProviderId } from './provider';
import type { AssistantResponse } from './schema';
import type { ScheduleResult } from '../scheduling/engine';
export interface AIConfig { id: ProviderId; apiKey: string; accountId?: string; accountLabel?: string; connected?: boolean; pendingAuthId?: string; modelId: string; consent: boolean; revision?: string }
export interface AIPreference { id: 'active'; providerId: ProviderId; revision: string }
export interface ModelCache { id: ProviderId; models: AIModel[]; fetchedAt: string }
export interface ChatMessage { accountId?: string; providerId?: ProviderId; id: string; role: 'user'|'assistant'; text: string; createdAt: string; status: 'pending'|'answered'|'error'|'cancelled'; error?: string; proposalId?: string; inReplyTo?: string; modelId?: string; attempts?: number; attemptId?: string; sequence?: number }
export interface Change { kind: 'task'|'meeting'; id: string; title: string; before: Record<string, unknown> | null; after: Record<string, unknown> }
export interface AIProposal { accountId?: string; providerId?: ProviderId; id: string; userMessageId: string; response: AssistantResponse; signature: string; createdAt: number; status: 'pending'|'approved'|'rejected'; date: string; allowedTaskIds: string[]; ids: [string,string][]; changes: Change[]; taskTitles: Record<string,string>; plans: ScheduleResult[]; resolvedAt?: string }
