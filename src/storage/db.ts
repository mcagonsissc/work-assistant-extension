import type { AIConfig, AIPreference, AIProposal, ChatMessage, ModelCache } from '../services/ai/types';
import Dexie, { type EntityTable } from 'dexie';
import { taskInput, type Task, type TaskInput, type ScheduledBlock, type FocusSession, type CalendarEvent, type DayPlan, type Reminder } from '../shared/models';
import { defaultSettings, settingsSchema, type WorkdaySettings } from '../shared/settings';
export class WorkdayDB extends Dexie {
  aiPreferences!: EntityTable<AIPreference, 'id'>;
  aiConfig!: EntityTable<AIConfig, 'id'>;
  modelCache!: EntityTable<ModelCache, 'id'>;
  chatMessages!: EntityTable<ChatMessage, 'id'>;
  aiProposals!: EntityTable<AIProposal, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  blocks!: EntityTable<ScheduledBlock, 'id'>;
  sessions!: EntityTable<FocusSession, 'id'>;
  events!: EntityTable<CalendarEvent, 'id'>;
  settings!: EntityTable<WorkdaySettings, 'id'>;
  plans!: EntityTable<DayPlan, 'date'>;
  reminders!: EntityTable<Reminder, 'id'>;
  constructor(name = 'workday-assistant') {
    super(name);
    this.version(1).stores({ tasks: 'id, status, scheduledDate, createdAt', blocks: 'id, taskId, start', sessions: 'id, taskId, startedAt', events: 'id, externalId, start' });
    this.version(2).stores({ blocks: 'id, taskId, start, planDate', settings: 'id', plans: 'date', reminders: 'id, at, taskId, date' });
    this.version(3).stores({ aiConfig: 'id', modelCache: 'id', chatMessages: 'id, createdAt, inReplyTo', aiProposals: 'id, status, userMessageId' });
    this.version(4).stores({ aiPreferences: 'id' });
  }
}
export const db = new WorkdayDB();
export async function getSettings(database = db) { return await database.settings.get('workday') ?? defaultSettings(); }
export function notifyBackground() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) void chrome.runtime.sendMessage({ type: 'WORKDAY_CHANGED' }).catch(() => { /* Worker will rebuild on startup. */ });
}
// Caller owns the tasks + sessions transaction. Closed sessions are credited once.
export async function closeSessions(database: WorkdayDB, now: number, taskId?: string) {
  const active = (await database.sessions.toArray()).filter(s => !s.endedAt && (!taskId || s.taskId === taskId));
  for (const session of active) {
    const end = Math.max(Date.parse(session.startedAt), now);
    await database.sessions.update(session.id, { endedAt: new Date(end).toISOString() });
    const task = await database.tasks.get(session.taskId);
    if (task) await database.tasks.update(task.id, { actualSeconds: task.actualSeconds + (end - Date.parse(session.startedAt)) / 1000, status: task.status === 'in_progress' ? 'paused' : task.status, updatedAt: new Date(now).toISOString() });
  }
}
export async function saveTask(input: TaskInput, id?: string, database = db, now = Date.now()) {
  const valid = taskInput.parse(input);
  const task = await database.transaction('rw', [database.tasks, database.sessions, database.blocks, database.reminders], async () => {
    let old = id ? await database.tasks.get(id) : undefined;
    if (id && !old) throw new Error('Task no longer exists.');
    if (id && valid.status !== 'in_progress') { await closeSessions(database, now, id); old = await database.tasks.get(id); }
    if (valid.status === 'in_progress') await closeSessions(database, now, undefined);
    if (id) old = await database.tasks.get(id);
    const instant = new Date(now).toISOString();
    const next: Task = { id: id ?? crypto.randomUUID(), actualSeconds: 0, createdAt: instant, source: 'manual', dependencyIds: [], ...old, ...valid, updatedAt: instant, completedAt: valid.status === 'completed' ? old?.completedAt ?? instant : undefined };
    next.dependencyIds = valid.dependencyIds ?? old?.dependencyIds ?? [];
    const all = await database.tasks.toArray();
    const dependencies = new Map(all.map(t => [t.id, t.dependencyIds]));
    dependencies.set(next.id, next.dependencyIds);
    const visiting = new Set<string>();
    const visited = new Set<string>();
    function visit(id: string) {
      if (visiting.has(id)) throw new Error('Task dependencies cannot contain a cycle.');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of dependencies.get(id) ?? []) visit(dependency);
      visiting.delete(id); visited.add(id);
    }
    visit(next.id);
    await database.tasks.put(next);
    if (valid.status === 'in_progress') await database.sessions.add({ id: crypto.randomUUID(), taskId: next.id, startedAt: instant });
    // Preserve elapsed blocks but remove the unused future of a completed/deferred task.
    if (valid.status === 'completed' || valid.status === 'deferred' || (old && old.scheduledDate !== next.scheduledDate)) {
      for (const b of await database.blocks.where('taskId').equals(next.id).toArray()) {
        if (Date.parse(b.start) >= now) await database.blocks.delete(b.id);
        else if (Date.parse(b.end) > now) await database.blocks.update(b.id, { end: instant });
      }
    }
    for (const reminder of await database.reminders.where('taskId').equals(next.id).toArray()) {
      if (!reminder.deliveredAt && !reminder.handledAt) await database.reminders.delete(reminder.id);
      else if (reminder.kind === 'checkin' && ['completed','deferred','paused'].includes(valid.status)) await database.reminders.update(reminder.id, { handledAt: instant });
    }
    return next;
  });
  notifyBackground(); return task;
}
export async function deleteTask(id: string, database = db) {
  await database.transaction('rw', [database.tasks, database.blocks, database.sessions, database.reminders], async () => {
    await database.blocks.where('taskId').equals(id).delete();
    await database.sessions.where('taskId').equals(id).delete();
    await database.reminders.where('taskId').equals(id).delete();
    await database.tasks.delete(id);
  }); notifyBackground();
}
export async function saveSettings(value: WorkdaySettings, database = db) {
  await database.settings.put(settingsSchema.parse(value)); notifyBackground();
}
export async function clearData() {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  notifyBackground();
}
