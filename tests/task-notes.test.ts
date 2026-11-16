import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { WorkdayDB, saveTask, saveSettings } from '../src/storage/db';
import { defaultSettings } from '../src/shared/settings';
import { snapshot } from '../src/services/scheduling/service';
import { buildAIContext } from '../src/services/ai/context';
import { prepareProposal, approveAIProposal } from '../src/services/ai/proposals';
import { parseAssistantResponse } from '../src/services/ai/schema';
import { answer, createAction, AI_DATE, AI_NOW } from './ai-fixtures';
let db: WorkdayDB;
beforeEach(async () => { db = new WorkdayDB(`notes-${crypto.randomUUID()}`); await saveSettings({ ...defaultSettings(), timeZone: 'UTC' }, db); });
afterEach(async () => { await db.delete(); });
const input = { title: 'Call the supplier', description: '', priority: 'medium' as const, status: 'todo' as const, estimatedMinutes: 30, scheduledDate: AI_DATE };

it('saves notes on a task and shares them with the AI only when descriptions are shared', async () => {
  const task = await saveTask({ ...input, notes: 'Ask about the March invoice' }, undefined, db);
  expect((await db.tasks.get(task.id))?.notes).toBe('Ask about the March invoice');
  const base = await snapshot(db), options = { date: AI_DATE, scope: 'day' as const };
  expect(JSON.stringify(buildAIContext(base, { ...options, includeDescriptions: false }, AI_NOW))).not.toContain('March invoice');
  expect(buildAIContext(base, { ...options, includeDescriptions: true }, AI_NOW).tasks[0]).toMatchObject({ notes: 'Ask about the March invoice' });
});

it('lets the assistant append a note, on an existing task or one it creates, only after approval', async () => {
  const task = await saveTask({ ...input, notes: 'First note' }, undefined, db);
  const response = parseAssistantResponse(JSON.stringify(answer(createAction({ clientId: 'new_task', title: 'Send contract' }), { type: 'add_note', taskId: 'new_task', note: 'Use the 2026 template' }, { type: 'add_note', taskId: task.id, note: 'Second note' })));
  const proposal = prepareProposal(await snapshot(db), response, AI_DATE, [task.id], crypto.randomUUID(), AI_NOW);
  expect(proposal.changes.find(c => c.id === task.id)?.after.notes).toBe('First note\nSecond note');
  expect((await db.tasks.get(task.id))?.notes).toBe('First note');
  await db.aiProposals.add(proposal); await approveAIProposal(proposal.id, db, AI_NOW);
  const tasks = await db.tasks.toArray();
  expect(tasks.find(t => t.id === task.id)?.notes).toBe('First note\nSecond note');
  expect(tasks.find(t => t.title === 'Send contract')?.notes).toBe('Use the 2026 template');
});
