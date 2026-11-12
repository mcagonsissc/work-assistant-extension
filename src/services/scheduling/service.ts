import { z } from 'zod';
import { db, getSettings, notifyBackground, type WorkdayDB } from '../../storage/db';
import type { CalendarEvent, Task } from '../../shared/models';
import { scheduleDay, spentSeconds, type ScheduleResult } from './engine';
export async function snapshot(database = db) {
  return { settings: await getSettings(database), tasks: await database.tasks.toArray(), events: await database.events.toArray(), existing: await database.blocks.toArray(), sessions: await database.sessions.toArray() };
}
export function planFingerprint(state: Pick<Awaited<ReturnType<typeof snapshot>>, 'settings' | 'tasks' | 'events'>) {
  const s = state.settings;
  return JSON.stringify({ settings: { timeZone: s.timeZone, start: s.start, end: s.end, workingDays: s.workingDays, lunchEnabled: s.lunchEnabled, lunchStart: s.lunchStart, lunchMinutes: s.lunchMinutes, breaks: s.breaks }, tasks: [...state.tasks].sort((a,b) => a.id.localeCompare(b.id)).map(t => ({ id: t.id, title: t.title, priority: t.priority, status: ['todo','paused','in_progress'].includes(t.status) ? 'active' : t.status, estimatedMinutes: t.estimatedMinutes, actualSeconds: t.actualSeconds, deadline: t.deadline, scheduledDate: t.scheduledDate, dependencyIds: t.dependencyIds, completedAt: t.completedAt })), events: [...state.events].sort((a,b) => a.id.localeCompare(b.id)) });
}
export interface PlanProposal { result: ScheduleResult; signature: string; createdAt: number; extension?: { taskId: string; minutes: number; estimatedMinutes: number } }
export async function previewPlan(date: string, extension?: { taskId: string; minutes: number }, database: WorkdayDB = db, now = Date.now()): Promise<PlanProposal> {
  return database.transaction('r', [database.tasks, database.events, database.blocks, database.sessions, database.settings], async () => {
    const state = await snapshot(database);
    const signature = JSON.stringify(state);
    let approvedExtension: PlanProposal['extension'];
    if (extension) {
      z.number().int().min(1).max(240).parse(extension.minutes);
      const task = state.tasks.find(t => t.id === extension.taskId);
      if (!task || task.status === 'completed' || task.status === 'deferred') throw new Error('This task is no longer available to extend.');
      const estimate = Math.max(task.estimatedMinutes, Math.ceil(spentSeconds(task, state.sessions, now) / 60)) + extension.minutes;
      if (estimate > 1440) throw new Error('The task estimate cannot exceed 1440 minutes.');
      state.tasks = state.tasks.map(t => t.id === extension.taskId ? { ...t, estimatedMinutes: estimate } : t);
      approvedExtension = { ...extension, estimatedMinutes: estimate };
    }
    return { result: scheduleDay({ ...state, date, now }), signature, createdAt: now, extension: approvedExtension };
  });
}
export async function approvePlan(proposal: PlanProposal, database: WorkdayDB = db, now = Date.now()) {
  await database.transaction('rw', [database.tasks, database.events, database.blocks, database.sessions, database.settings, database.plans, database.reminders], async () => {
    if (now - proposal.createdAt > 60_000 || now < proposal.createdAt) throw new Error('This preview expired. Preview the plan again.');
    const state = await snapshot(database);
    if (JSON.stringify(state) !== proposal.signature) throw new Error('Your tasks, focus, meetings or settings changed. Preview the plan again.');
    if (proposal.extension) {
      const task = state.tasks.find(t => t.id === proposal.extension!.taskId)!;
      await database.tasks.update(task.id, { estimatedMinutes: proposal.extension.estimatedMinutes, updatedAt: new Date(now).toISOString() });
    }
    const result = proposal.result;
    // Legacy v1 blocks have no planDate. Only replace blocks intersecting this workday.
    const replace = state.existing.filter(b => b.planDate === result.date || (!b.planDate && b.end > result.start && b.start < result.end));
    await database.blocks.bulkDelete(replace.map(b => b.id));
    await database.blocks.bulkPut(result.blocks);
    const plannedIds = new Set(result.blocks.filter(b => b.kind === 'task').map(b => b.taskId));
    for (const task of state.tasks.filter(t => !t.scheduledDate && plannedIds.has(t.id))) await database.tasks.update(task.id, { scheduledDate: result.date, updatedAt: new Date(now).toISOString() });
    await database.plans.put({ date: result.date, timeZone: result.timeZone, start: result.start, end: result.end, overflow: result.overflow, warnings: result.warnings, approvedAt: new Date(now).toISOString(), signature: planFingerprint(await snapshot(database)) });
    // Keep already delivered reminders to prevent repeat delivery after replanning.
    for (const reminder of await database.reminders.where('date').equals(result.date).toArray()) if (!reminder.deliveredAt && !reminder.handledAt) await database.reminders.delete(reminder.id);
  }); notifyBackground();
}
const eventInput = z.object({ title: z.string().trim().min(1).max(200), start: z.iso.datetime(), end: z.iso.datetime(), timeZone: z.string() }).refine(e => Date.parse(e.end) > Date.parse(e.start), 'Meeting end must be after its start.');
export async function saveMeeting(value: Pick<CalendarEvent, 'title' | 'start' | 'end' | 'timeZone'>, id?: string, database: WorkdayDB = db) {
  const valid = eventInput.parse(value);
  await database.transaction('rw', [database.events, database.blocks, database.reminders], async () => {
    if (id && !(await database.events.get(id))) throw new Error('Meeting no longer exists.');
    const event: CalendarEvent = { ...valid, id: id ?? crypto.randomUUID(), source: 'manual', busy: true };
    await database.events.put(event);
    // Remove obsolete committed blocks; the UI flags the plan for review.
    for (const block of (await database.blocks.toArray()).filter(b => b.calendarEventId === event.id)) await database.blocks.delete(block.id);
    for (const reminder of (await database.reminders.toArray()).filter(r => r.blockId?.includes(event.id) && !r.deliveredAt && !r.handledAt)) await database.reminders.delete(reminder.id);
  }); notifyBackground();
}
export async function deleteMeeting(id: string, database: WorkdayDB = db) {
  await database.transaction('rw', [database.events, database.blocks, database.reminders], async () => {
    await database.events.delete(id);
    for (const b of (await database.blocks.toArray()).filter(b => b.calendarEventId === id)) await database.blocks.delete(b.id);
    for (const r of (await database.reminders.toArray()).filter(r => r.blockId?.includes(id))) await database.reminders.delete(r.id);
  }); notifyBackground();
}
export function taskName(tasks: Task[], id?: string) { return tasks.find(t => t.id === id)?.title ?? 'Task'; }
