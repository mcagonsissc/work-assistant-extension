import { z } from 'zod';
import { categorySchema } from '../../shared/categories';
const reference = z.string().min(1).max(100);
const nullableDate = z.iso.date().nullable();
const nullableDeadline = z.iso.datetime().nullable();
const localDateTime=z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/);
const patchSchema = z.strictObject({
  title: z.string().trim().min(1).max(200).nullable(), description: z.string().max(5000).nullable(),
  estimatedMinutes: z.number().int().min(1).max(1440).nullable(), priority: z.enum(['high','medium','low']).nullable(),
  category: categorySchema.nullable(), scheduledDate: nullableDate, clearScheduledDate: z.boolean(),
  deadline: nullableDeadline, clearDeadline: z.boolean(),
});
export const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('create_task'), clientId: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), title: z.string().trim().min(1).max(200), description: z.string().max(5000), estimatedMinutes: z.number().int().min(1).max(1440), priority: z.enum(['high','medium','low']), category: categorySchema, scheduledDate: nullableDate, deadline: nullableDeadline, dependencyIds: z.array(reference).max(24) }),
  z.strictObject({ type: z.literal('update_task'), taskId: reference, patch: patchSchema }),
  z.strictObject({ type: z.literal('complete_task'), taskId: reference }),
  z.strictObject({ type: z.literal('defer_task'), taskId: reference, scheduledDate: nullableDate }),
  z.strictObject({ type: z.literal('extend_task'), taskId: reference, minutes: z.number().int().min(1).max(480) }),
  z.strictObject({ type: z.literal('create_meeting'), title: z.string().trim().min(1).max(200), startLocal: localDateTime, endLocal: localDateTime }),
  z.strictObject({ type: z.literal('add_note'), taskId: reference, note: z.string().trim().min(1).max(1000) }),
  z.strictObject({ type: z.literal('reschedule'), date: z.iso.date() }),
]);
export const assistantResponseSchema = z.strictObject({ reply: z.string().trim().min(1).max(4000), actions: z.array(actionSchema).max(24) });
export type AssistantResponse = z.infer<typeof assistantResponseSchema>;
export type AIAction = z.infer<typeof actionSchema>;
// All nullable fields remain required: compatible with strict JSON Schema providers.
export const responseJSONSchema = z.toJSONSchema(assistantResponseSchema, { target: 'draft-7' });
export class AIError extends Error {
  constructor(public code: 'configuration'|'network'|'timeout'|'cancelled'|'auth'|'credits'|'rate_limit'|'unavailable'|'invalid_response'|'invalid_action'|'stale'|'storage', message: string, public retryAfterSeconds?: number) { super(message); this.name = 'AIError'; }
}
export function redactSecrets(text: string, secrets: string[] = []) {
  let result = text;
  for (const secret of secrets.filter(Boolean)) result = result.split(secret).join('[redacted key]');
  return result.replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[redacted key]').replace(/\bAIza[A-Za-z0-9_-]{20,}/g, '[redacted key]');
}
export function parseAssistantResponse(raw: string, secrets: string[] = []): AssistantResponse {
  try {
    if (raw.length > 64_000) throw new Error();
    const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed=JSON.parse(text);
    const safe=JSON.parse(JSON.stringify(parsed,(_key,value)=>typeof value==='string'?redactSecrets(value,secrets):value));
    return assistantResponseSchema.parse(safe);
  } catch { throw new AIError('invalid_response', 'The model did not return valid task actions. No task data changed. Try again or choose another model.'); }
}
