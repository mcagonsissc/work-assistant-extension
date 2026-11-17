import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { WorkdayDB, saveSettings, saveTask } from '../src/storage/db';
import { defaultSettings } from '../src/shared/settings';
import { approvePlan, planFingerprint, previewPlan, saveMeeting, snapshot } from '../src/services/scheduling/service';
import { approveAIProposal, prepareProposal } from '../src/services/ai/proposals';
import { parseAssistantResponse, type AIAction } from '../src/services/ai/schema';
import { AI_DATE, AI_NOW } from './ai-fixtures';

let db: WorkdayDB, report: string, review: string;
const day = (time: string) => `${AI_DATE}T${time}:00.000Z`;
const ids = async () => (await db.tasks.toArray()).map(t => t.id);
const propose = async (...actions: AIAction[]) => prepareProposal(await snapshot(db), parseAssistantResponse(JSON.stringify({ reply: 'ok', actions })), AI_DATE, await ids(), crypto.randomUUID(), AI_NOW);
async function approve(...actions: AIAction[]) { const proposal = await propose(...actions); await db.aiProposals.add(proposal); await approveAIProposal(proposal.id, db, AI_NOW); return proposal; }
/** What the Today timeline shows: saved task blocks for the day, in order. */
async function timeline() {
  const tasks = await db.tasks.toArray(), blocks = (await db.blocks.toArray()).filter(b => b.kind === 'task' && b.planDate === AI_DATE).sort((a, b) => a.start.localeCompare(b.start));
  return blocks.map(b => `${b.start.slice(11, 16)}-${b.end.slice(11, 16)} ${tasks.find(t => t.id === b.taskId)!.title}${b.fixed ? ' (set)' : ''}`);
}
async function planIsCurrent() { const state = await snapshot(db); return (await db.plans.get(AI_DATE))?.signature === planFingerprint(state); }

beforeEach(async () => {
  db = new WorkdayDB(`ai-schedule-${crypto.randomUUID()}`);
  await saveSettings({ ...defaultSettings(), timeZone: 'UTC', lunchEnabled: false }, db);
  report = (await saveTask({ title: 'Write report', description: '', priority: 'high', status: 'todo', estimatedMinutes: 60, scheduledDate: AI_DATE }, undefined, db, AI_NOW)).id;
  review = (await saveTask({ title: 'Review code', description: '', priority: 'medium', status: 'todo', estimatedMinutes: 30, scheduledDate: AI_DATE }, undefined, db, AI_NOW)).id;
  await approvePlan(await previewPlan(AI_DATE, undefined, db, AI_NOW), db, AI_NOW);
});
afterEach(async () => { await db.delete(); });

it('starts from the automatic plan', async () => {
  expect(await timeline()).toEqual(['09:00-10:00 Write report', '10:00-10:30 Review code']);
});

it('switches two tasks', async () => {
  await approve({ type: 'schedule_task', taskId: review, startLocal: `${AI_DATE}T09:00`, endLocal: null }, { type: 'schedule_task', taskId: report, startLocal: `${AI_DATE}T09:30`, endLocal: null });
  expect(await timeline()).toEqual(['09:00-09:30 Review code (set)', '09:30-10:30 Write report (set)']);
  expect(await planIsCurrent()).toBe(true);
});

it('moves a task to another time and plans the rest around it', async () => {
  const proposal = await approve({ type: 'schedule_task', taskId: report, startLocal: `${AI_DATE}T14:00`, endLocal: null });
  expect(proposal.changes[0]).toMatchObject({ action: 'schedule', title: 'Write report', before: { start: day('09:00') }, after: { start: day('14:00'), end: day('15:00') } });
  expect(await timeline()).toEqual(['09:00-09:30 Review code', '14:00-15:00 Write report (set)']);
  // A later plan preview keeps the set time.
  await approvePlan(await previewPlan(AI_DATE, undefined, db, AI_NOW), db, AI_NOW);
  expect(await timeline()).toEqual(['09:00-09:30 Review code', '14:00-15:00 Write report (set)']);
});

it('cancels a task from today and moves the next one up', async () => {
  await approve({ type: 'defer_task', taskId: report, scheduledDate: null });
  expect(await timeline()).toEqual(['09:00-09:30 Review code']);
});

it('uses a stated end time as the new length, and can clear a set time', async () => {
  const proposal = await approve({ type: 'schedule_task', taskId: review, startLocal: `${AI_DATE}T11:00`, endLocal: `${AI_DATE}T12:00` });
  expect(proposal.changes.find(c => c.id === review)?.after.estimatedMinutes).toBe(60);
  expect(await timeline()).toEqual(['09:00-10:00 Write report', '11:00-12:00 Review code (set)']);
  await approve({ type: 'schedule_task', taskId: review, startLocal: null, endLocal: null });
  expect(await timeline()).toEqual(['09:00-10:00 Write report', '10:00-11:00 Review code']);
});

it('refuses times that cannot work, changing nothing', async () => {
  await saveMeeting({ title: 'Standup', start: day('15:00'), end: day('15:30'), timeZone: 'UTC' }, undefined, db);
  const at = (taskId: string, time: string): AIAction => ({ type: 'schedule_task', taskId, startLocal: `${AI_DATE}T${time}`, endLocal: null });
  await expect(propose(at(report, '15:00'))).rejects.toMatchObject({ message: expect.stringContaining('overlaps a meeting') });
  await expect(propose(at(report, '08:30'))).rejects.toMatchObject({ message: expect.stringContaining('outside your working hours') });
  await expect(propose(at(report, '16:30'))).rejects.toMatchObject({ message: expect.stringContaining('outside your working hours') });
  await expect(propose({ type: 'schedule_task', taskId: report, startLocal: '2026-11-11T10:00', endLocal: null })).rejects.toMatchObject({ message: expect.stringContaining('already passed') });
  await expect(propose(at(report, '11:00'), at(review, '11:30'))).rejects.toMatchObject({ message: expect.stringContaining('overlapping times') });
  await expect(propose(at(report, '11:00'), at(report, '13:00'))).rejects.toMatchObject({ message: expect.stringContaining('conflicting times') });
  await expect(propose({ type: 'schedule_task', taskId: report, startLocal: null, endLocal: null })).rejects.toMatchObject({ message: expect.stringContaining('does not have a set time') });
});

it('accepts the move wording small models use', () => {
  expect(parseAssistantResponse(JSON.stringify({ reply: 'ok', actions: [{ type: 'move_task', task_id: 't1', start: '2026-11-12 14:00' }] })).actions[0]).toEqual({ type: 'schedule_task', taskId: 't1', startLocal: '2026-11-12T14:00', endLocal: null });
});
