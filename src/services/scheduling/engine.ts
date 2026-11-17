import type { CalendarEvent, FocusSession, OverflowItem, ScheduledBlock, Task } from '../../shared/models';
import { settingsSchema, type WorkdaySettings } from '../../shared/settings';
import { addDays, iso, MINUTE, workWindow, zonedTime } from './time';
export interface ScheduleInput { date: string; settings: WorkdaySettings; tasks: Task[]; events: CalendarEvent[]; existing: ScheduledBlock[]; sessions: FocusSession[]; now: number }
export interface ScheduleResult { date: string; timeZone: string; start: string; end: string; blocks: ScheduledBlock[]; overflow: OverflowItem[]; warnings: string[] }
export function spentSeconds(task: Task, sessions: FocusSession[], now: number) {
  return task.actualSeconds + sessions.filter(s => s.taskId === task.id && !s.endedAt).reduce((sum, s) => sum + Math.max(0, (now - Date.parse(s.startedAt)) / 1000), 0);
}
/** True when the task had a focus session at some point during [start, end). */
export function workedDuring(taskId: string | undefined, start: number, end: number, sessions: FocusSession[], now: number) {
  return !!taskId && sessions.some(s => s.taskId === taskId && Date.parse(s.startedAt) < end && Date.parse(s.endedAt ?? iso(now)) > start);
}
/** Past planned time is history only when it was used: the task was worked on then, or finished. */
function keepPast(task: Task, start: number, end: number, sessions: FocusSession[], now: number) {
  return end - start >= MINUTE && (task.status === 'completed' || workedDuring(task.id, start, end, sessions, now));
}
/**
 * The blocks the Today timeline shows for a saved plan. Hides past slots of tasks that were
 * not worked on and have since been deferred or moved to another day, and sub-minute pieces
 * left by earlier replanning, so a plan saved before a change reads like the current one.
 */
export function timelineBlocks(blocks: ScheduledBlock[], tasks: Task[], sessions: FocusSession[], date: string, now: number) {
  return blocks.filter(block => {
    if (block.kind !== 'task') return true;
    const task = tasks.find(t => t.id === block.taskId);
    if (!task) return false;
    const start = Date.parse(block.start), end = Date.parse(block.end);
    if (end <= now && !keepPast(task, start, end, sessions, now)) return false;
    const offPlan = task.status === 'deferred' || (!!task.scheduledDate && task.scheduledDate !== date);
    return !offPlan || workedDuring(task.id, start, end, sessions, now);
  });
}
export function scheduleDay(input: ScheduleInput): ScheduleResult {
  const { date, tasks, events, existing, sessions, now } = input;
  const settings = settingsSchema.parse(input.settings);
  const window = workWindow(date, settings);
  const warnings: string[] = [];
  const blocks: ScheduledBlock[] = [];
  const overflow: OverflowItem[] = [];
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const add = (block: ScheduledBlock) => {
    if (Date.parse(block.end) > window.start && Date.parse(block.start) < window.end) blocks.push(block);
  };
  for (const event of events.filter(e => e.busy)) add({ id: `meeting:${date}:${event.id}`, calendarEventId: event.id, kind: 'meeting', start: event.start, end: event.end, fixed: true, title: event.title, planDate: date });
  const breaks = [...settings.breaks, ...(settings.lunchEnabled ? [{ id: 'lunch', title: 'Lunch', start: settings.lunchStart, minutes: settings.lunchMinutes }] : [])];
  if (window.working) for (const item of breaks) {
    const onDate = settings.end < settings.start && item.start < settings.start ? addDays(date, 1) : date;
    const start = zonedTime(onDate, item.start, settings.timeZone);
    const end = start + item.minutes * MINUTE;
    if (start < window.start || end > window.end) { warnings.push(`${item.title} is outside working hours and was not reserved.`); continue; }
    add({ id: `break:${date}:${item.id}`, kind: 'break', start: iso(start), end: iso(end), fixed: true, title: item.title, planDate: date });
  }
  // Keep elapsed work, releasing a completed task's unused planned time.
  for (const block of existing.filter(b => b.kind === 'task' && (!b.planDate || b.planDate === date))) {
    const task = block.taskId ? taskMap.get(block.taskId) : undefined;
    if (!task) continue;
    const start = Date.parse(block.start);
    let end = Date.parse(block.end);
    if (task.status === 'completed') end = Math.min(end, Date.parse(task.completedAt ?? iso(now)), now);
    else if (!block.fixed) end = Math.min(end, now);
    if ((start < now || block.fixed) && end > start) {
      // Planned time that has passed without being used is dropped, not kept as fragments.
      if ((!block.fixed || end <= now) && !keepPast(task, start, Math.min(end, now), sessions, now)) continue;
      const kept = { ...block, end: iso(end), planDate: date };
      if (block.planDate === date) blocks.push(kept);
      else add(kept);
    }
  }
  // A timezone/work-hour change can make an adjacent saved plan overlap this window.
  // Reserve its work without copying or reassigning its records to this plan.
  const foreign = existing.filter(b => b.kind === 'task' && b.planDate && b.planDate !== date && Date.parse(b.end) > window.start && Date.parse(b.start) < window.end && (Date.parse(b.start) < now || b.fixed || taskMap.get(b.taskId ?? '')?.scheduledDate === b.planDate));
  if (foreign.length) warnings.push('Work from another saved plan reserves time in this window.');
  const fixed = [...blocks, ...foreign].sort((a,b) => Date.parse(a.start) - Date.parse(b.start));
  for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) {
    if (Date.parse(fixed[j].start) >= Date.parse(fixed[i].end)) break;
    warnings.push(`Fixed commitments overlap: ${fixed[i].title ?? 'Previous work'} / ${fixed[j].title ?? 'Previous work'}.`);
  }
  const occupied = [...blocks, ...foreign].map(b => [Math.max(window.start, Date.parse(b.start)), Math.min(window.end, Date.parse(b.end))]).filter(([start,end]) => end > start).sort((a,b) => a[0] - b[0]);
  const gaps: number[][] = [];
  let cursor = Math.max(window.start, now);
  for (const [start, end] of occupied) { if (start > cursor) gaps.push([cursor, start]); cursor = Math.max(cursor, end); }
  if (cursor < window.end) gaps.push([cursor, window.end]);
  if (!window.working) { gaps.length = 0; warnings.push('This is not a configured working day.'); }
  const rank = { high: 0, medium: 1, low: 2 };
  let pending = tasks.filter(t => t.status !== 'completed' && t.status !== 'deferred' && (!t.scheduledDate || t.scheduledDate === date)).sort((a,b) => rank[a.priority] - rank[b.priority] || ((a.deadline ? Date.parse(a.deadline) : 8640000000000000) - (b.deadline ? Date.parse(b.deadline) : 8640000000000000)) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const finishes = new Map<string, number>();
  for (const task of tasks.filter(t => t.status === 'completed')) finishes.set(task.id, Date.parse(task.completedAt ?? iso(window.start)));
  while (pending.length) {
    const index = pending.findIndex(t => t.dependencyIds.every(id => finishes.has(id)));
    if (index < 0) { for (const t of pending) overflow.push({ taskId: t.id, remainingMinutes: Math.max(0, (t.estimatedMinutes * 60 - spentSeconds(t, sessions, now)) / 60), reason: 'Unfinished, missing or circular dependency' }); break; }
    const [task] = pending.splice(index, 1);
    const futureFixed = blocks.filter(b => b.taskId === task.id && b.fixed).reduce((sum,b) => sum + Math.max(0, Date.parse(b.end) - Math.max(now, Date.parse(b.start))), 0);
    let need = Math.max(0, task.estimatedMinutes * MINUTE - spentSeconds(task, sessions, now) * 1000 - futureFixed);
    if (need === 0 && futureFixed === 0) { overflow.push({ taskId: task.id, remainingMinutes: 0, reason: 'Estimate used up; complete this task or add more time' }); continue; }
    let finish = Math.max(window.start, now, ...blocks.filter(b => b.taskId === task.id && b.fixed).map(b => Date.parse(b.end)));
    const ready = Math.max(window.start, ...task.dependencyIds.map(id => finishes.get(id)!));
    const deadline = task.deadline ? Date.parse(task.deadline) : Infinity;
    for (const gap of gaps) {
      const start = Math.max(gap[0], ready);
      const end = Math.min(gap[1], deadline);
      const duration = Math.min(need, Math.max(0, end - start));
      if (duration <= 0) continue;
      blocks.push({ id: `task:${task.id}:${start}`, taskId: task.id, kind: 'task', start: iso(start), end: iso(start + duration), fixed: false, title: task.title, planDate: date });
      // Dependencies may leave an earlier gap available for another task.
      if (start > gap[0]) gaps.push([gap[0], start]);
      gap[0] = start + duration; need -= duration; finish = Math.max(finish, gap[0]);
      if (need <= 0) break;
    }
    gaps.sort((a,b) => a[0] - b[0]);
    if (need > 0) overflow.push({ taskId: task.id, remainingMinutes: Math.ceil(need / MINUTE), reason: deadline < window.end ? 'Insufficient time before deadline' : 'Insufficient working time' });
    else finishes.set(task.id, finish);
  }
  return { date, timeZone: settings.timeZone, start: iso(window.start), end: iso(window.end), blocks: blocks.sort((a,b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id)), overflow, warnings: [...new Set(warnings)] };
}
