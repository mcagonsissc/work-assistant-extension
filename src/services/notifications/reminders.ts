import type { CalendarEvent, DayPlan, FocusSession, Reminder, ScheduledBlock, Task } from '../../shared/models';
import type { WorkdaySettings } from '../../shared/settings';
import { db, getSettings, type WorkdayDB } from '../../storage/db';
import { planFingerprint } from '../scheduling/service';
import { addDays, clockInZone, dateInZone, iso, MINUTE, workWindow } from '../scheduling/time';
export interface ReminderState { settings: WorkdaySettings; plans: DayPlan[]; blocks: ScheduledBlock[]; tasks: Task[]; events: CalendarEvent[]; sessions: FocusSession[] }
export function isQuiet(now: number, settings: WorkdaySettings) {
  if (!settings.quietEnabled) return false;
  const time = clockInZone(now, settings.timeZone);
  return settings.quietStart === settings.quietEnd || (settings.quietStart < settings.quietEnd ? time >= settings.quietStart && time < settings.quietEnd : time >= settings.quietStart || time < settings.quietEnd);
}
export function buildReminders(state: ReminderState, now: number): Reminder[] {
  const { settings, plans, blocks, tasks, events, sessions } = state;
  const reminders: Reminder[] = [];
  const lead = settings.reminderLeadMinutes * MINUTE;
  const add = (r: Reminder) => { if (Date.parse(r.expiresAt) > now) reminders.push(r); };
  const validPlans = plans.filter(p => p.signature === planFingerprint(state));
  for (const block of blocks.filter(b => validPlans.some(p => p.date === b.planDate))) {
    const task = tasks.find(t => t.id === block.taskId);
    const start = Date.parse(block.start), end = Date.parse(block.end);
    if (block.kind === 'task' && task && !['completed','deferred'].includes(task.status)) {
      if (settings.taskReminders) add({ id: `start:${block.id}`, kind: 'task', at: iso(start - lead), expiresAt: iso(Math.min(end, start + 5 * MINUTE)), taskId: task.id, blockId: block.id, date: block.planDate, title: 'Time to focus', message: task.title });
      add({ id: `end:${block.id}:${end}`, kind: 'checkin', at: block.end, expiresAt: iso(end + 30 * MINUTE), taskId: task.id, blockId: block.id, date: block.planDate, title: 'How is this task going?', message: task.title });
    }
    if (block.kind === 'break' && settings.breakReminders) add({ id: `start:${block.id}`, kind: 'break', at: block.start, expiresAt: iso(Math.min(end, start + 5 * MINUTE)), blockId: block.id, date: block.planDate, title: 'Take a break', message: block.title ?? 'Break time' });
  }
  if (settings.meetingReminders) for (const event of events.filter(e => e.busy)) add({ id: `meeting:${event.id}:${event.start}`, kind: 'meeting', at: iso(Date.parse(event.start) - lead), expiresAt: iso(Math.min(Date.parse(event.end), Date.parse(event.start) + 5 * MINUTE)), blockId: `meeting:${event.id}`, title: 'Upcoming meeting', message: event.title });
  if (settings.workdayReminders) {
    const today = dateInZone(now, settings.timeZone);
    const dates = new Set([addDays(today,-1), today, addDays(today,1)]);
    for (const date of dates) {
      const window = workWindow(date, settings);
      if (window.working) add({ id: `workend:${date}:${iso(window.end)}`, kind: 'end', at: iso(window.end), expiresAt: iso(window.end + 15 * MINUTE), date, title: 'Your workday is ending', message: 'Review your progress and leave unfinished tasks for another day.' });
    }
  }
  if (settings.checkInMinutes > 0) for (const session of sessions.filter(s => !s.endedAt)) {
    const task = tasks.find(t => t.id === session.taskId);
    if (!task || task.status !== 'in_progress') continue;
    const interval = settings.checkInMinutes * MINUTE;
    const slot = Math.max(1, Math.floor((now - Date.parse(session.startedAt)) / interval));
    for (const n of [slot, slot + 1]) {
      const at = Date.parse(session.startedAt) + n * interval;
      add({ id: `focus:${session.id}:${n}`, sessionId: session.id, kind: 'checkin', at: iso(at), expiresAt: iso(at + interval), taskId: task.id, title: 'How is this task going?', message: task.title });
    }
  }
  return reminders.sort((a,b) => a.at.localeCompare(b.at));
}
export interface ReminderPlatform {
  listAlarms(): Promise<string[]>; setAlarm(name: string, when: number): Promise<void>; clearAlarm(name: string): Promise<void>;
  /** `sticky` keeps the notification on screen until the user dismisses it. */
  notify(id: string, title: string, message: string, sticky?: boolean): Promise<void>;
  /** Optional: show the reminder as a browser window. */
  popup?(title: string, message: string): Promise<void>;
}
export async function syncReminders(platform: ReminderPlatform, database: WorkdayDB = db, now = Date.now()) {
  const state = await database.transaction('r', database.tables, async (): Promise<ReminderState> => ({ settings: await getSettings(database), tasks: await database.tasks.toArray(), blocks: await database.blocks.toArray(), plans: await database.plans.toArray(), sessions: await database.sessions.toArray(), events: await database.events.toArray() }));
  const wanted = buildReminders(state, now);
  await database.transaction('rw', database.reminders, async () => {
    const ids = new Set(wanted.map(r => r.id));
    for (const old of await database.reminders.toArray()) {
      if ((!ids.has(old.id) && !old.deliveredAt && !old.handledAt) || Date.parse(old.expiresAt) < now - 7 * 86400_000) await database.reminders.delete(old.id);
    }
    for (const r of wanted) {
      const old = await database.reminders.get(r.id);
      await database.reminders.put({ ...r, deliveredAt: old?.deliveredAt, handledAt: old?.handledAt, deliveryError: old?.deliveryError });
    }
  });
  const pending = (await database.reminders.toArray()).filter(r => !r.deliveredAt && !r.handledAt && wanted.some(w => w.id === r.id));
  const future = pending.filter(r => Date.parse(r.at) > now).slice(0, 400);
  const alarmNames = new Set(future.map(r => `wd:${r.id}`));
  for (const name of await platform.listAlarms()) if (name.startsWith('wd:') && !alarmNames.has(name)) await platform.clearAlarm(name);
  for (const r of future) await platform.setAlarm(`wd:${r.id}`, Date.parse(r.at));
  for (const r of pending.filter(r => Date.parse(r.at) <= now && Date.parse(r.expiresAt) > now)) {
    // Claim before calling the OS: at-most-once delivery survives worker restarts.
    const claimed = await database.transaction('rw', database.reminders, async () => {
      const current = await database.reminders.get(r.id);
      if (!current || current.deliveredAt) return false;
      await database.reminders.update(r.id, { deliveredAt: iso(now) }); return true;
    });
    if (claimed && state.settings.notificationsEnabled && !isQuiet(now, state.settings)) {
      const message = `${r.message}${r.kind === 'checkin' ? ' — open Workday for Completed, Need more time, Pause or Skip.' : ''}`;
      try {
        if (state.settings.popupReminders !== false && platform.popup) await platform.popup(r.title, message);
        else await platform.notify(`wd:${r.id}`, r.title, message, r.kind === 'checkin');
      }
      catch { await database.reminders.update(r.id, { deliveryError: 'Reminder delivery failed. Check browser and OS notification permissions.' }); }
    }
  }
}
export async function dismissCheckIn(id: string, database = db) { await database.reminders.update(id, { handledAt: iso(Date.now()) }); }
