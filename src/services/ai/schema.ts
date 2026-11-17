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
  z.strictObject({ type: z.literal('update_meeting'), meetingId: reference, title: z.string().trim().min(1).max(200).nullable(), startLocal: localDateTime.nullable(), endLocal: localDateTime.nullable() }),
  z.strictObject({ type: z.literal('delete_meeting'), meetingId: reference }),
  // A set time for a task. startLocal null clears it so the planner chooses again.
  z.strictObject({ type: z.literal('schedule_task'), taskId: reference, startLocal: localDateTime.nullable(), endLocal: localDateTime.nullable() }),
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
// Smaller models often get the shape slightly wrong: prose around the JSON, a missing optional
// field, an extra key, a date with a space. These helpers tidy such answers without guessing
// anything that matters (which task, a meeting's start). Whatever results is still validated
// against the strict schema and shown to the user for approval.
function extractJSON(raw: string) {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { /* look for an object inside surrounding prose */ }
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error();
  return JSON.parse(text.slice(start, end + 1));
}
const text = (value: unknown) => typeof value === 'string' ? value : undefined;
function localTime(value: unknown) {
  if (typeof value !== 'string') return value;
  return value.trim().replace(' ', 'T').replace(/(Z|[+-]\d{2}:?\d{2})$/i, '').replace(/(\.\d{3})\d+$/, '$1');
}
function repairAction(value: unknown, index: number): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const a = value as Record<string, unknown>, type = typeof a.type === 'string' ? a.type.trim().toLowerCase() : a.type;
  const taskId = a.taskId ?? a.task_id ?? a.id;
  const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v ?? null;
  const priority = (v: unknown) => typeof v === 'string' ? v.toLowerCase() : v;
  switch (type) {
    case 'create_task': {
      const minutes = Number(a.estimatedMinutes ?? a.minutes ?? a.duration);
      return { type, clientId: typeof a.clientId === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(a.clientId) ? a.clientId : `task_${index + 1}`, title: a.title, description: text(a.description) ?? '',
        estimatedMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 30, priority: ['high', 'medium', 'low'].includes(priority(a.priority) as string) ? priority(a.priority) : 'medium',
        category: categorySchema.safeParse(a.category).success ? a.category : 'other', scheduledDate: date(a.scheduledDate ?? a.date), deadline: a.deadline ?? null, dependencyIds: Array.isArray(a.dependencyIds) ? a.dependencyIds : [] };
    }
    case 'update_task': {
      const p = (a.patch && typeof a.patch === 'object' ? a.patch : a) as Record<string, unknown>;
      return { type, taskId, patch: { title: p.title ?? null, description: p.description ?? null, estimatedMinutes: p.estimatedMinutes ?? null, priority: priority(p.priority) ?? null, category: p.category ?? null, scheduledDate: p.scheduledDate === undefined ? null : date(p.scheduledDate), clearScheduledDate: p.clearScheduledDate === true, deadline: p.deadline ?? null, clearDeadline: p.clearDeadline === true } };
    }
    case 'complete_task': return { type, taskId };
    case 'defer_task': return { type, taskId, scheduledDate: date(a.scheduledDate ?? a.date) };
    case 'extend_task': return { type, taskId, minutes: a.minutes ?? a.extraMinutes };
    case 'add_note': return { type, taskId, note: a.note ?? a.text };
    case 'schedule_task': case 'move_task': case 'pin_task': return { type: 'schedule_task', taskId, startLocal: localTime(a.startLocal ?? a.start ?? a.startTime) ?? null, endLocal: localTime(a.endLocal ?? a.end ?? a.endTime) ?? null };
    case 'reschedule': return { type, date: date(a.date ?? a.scheduledDate) };
    case 'create_meeting': {
      const startLocal = localTime(a.startLocal ?? a.start ?? a.startTime); let endLocal = localTime(a.endLocal ?? a.end ?? a.endTime);
      const minutes = Number(a.durationMinutes ?? a.duration ?? a.minutes);
      // A stated duration is turned into an end time; a missing start is never invented.
      if (typeof endLocal !== 'string' && typeof startLocal === 'string' && Number.isFinite(minutes) && minutes > 0) { const end = Date.parse(`${startLocal}Z`) + minutes * 60_000; if (Number.isFinite(end)) endLocal = new Date(end).toISOString().slice(0, 16); }
      return { type, title: a.title ?? a.name, startLocal, endLocal };
    }
    case 'update_meeting': return { type, meetingId: a.meetingId ?? a.meeting_id ?? a.id, title: a.title ?? null, startLocal: localTime(a.startLocal ?? a.start ?? a.startTime) ?? null, endLocal: localTime(a.endLocal ?? a.end ?? a.endTime) ?? null };
    case 'delete_meeting': return { type, meetingId: a.meetingId ?? a.meeting_id ?? a.id };
    default: return value;
  }
}
function repairResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  const actions = Array.isArray(v.actions) ? v.actions.map(repairAction) : [];
  const reply = [v.reply, v.message, v.response, v.text, v.answer].map(text).find(t => t?.trim()) ?? (actions.length ? 'Here are the changes for you to review.' : undefined);
  return { reply, actions };
}
function prepare(raw: string, secrets: string[]) {
  if (raw.length > 64_000) throw new Error();
  const parsed = repairResponse(extractJSON(raw));
  return JSON.parse(JSON.stringify(parsed, (_key, value) => typeof value === 'string' ? redactSecrets(value, secrets) : value));
}
/** Short, specific description of what was wrong with a model's answer, to send back to it. */
export function describeInvalidResponse(raw: string): string {
  let prepared: unknown;
  try { prepared = prepare(raw, []); } catch { return 'The response was not a single JSON object.'; }
  const result = assistantResponseSchema.safeParse(prepared);
  if (result.success) return '';
  return result.error.issues.slice(0, 8).map(issue => `${issue.path.join('.') || 'response'}: ${issue.message}`).join('; ').slice(0, 700);
}
export function parseAssistantResponse(raw: string, secrets: string[] = []): AssistantResponse {
  try {
    return assistantResponseSchema.parse(prepare(raw, secrets));
  } catch { throw new AIError('invalid_response', 'The model did not return valid task actions. No task data changed. Try again or choose another model.'); }
}
