import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { WorkdayDB, saveSettings } from '../src/storage/db';
import { defaultSettings } from '../src/shared/settings';
import { saveMeeting, snapshot } from '../src/services/scheduling/service';
import { buildAIContext } from '../src/services/ai/context';
import { prepareProposal, approveAIProposal } from '../src/services/ai/proposals';
import { parseAssistantResponse, type AIAction } from '../src/services/ai/schema';
import { AI_DATE, AI_NOW } from './ai-fixtures';
let db: WorkdayDB, standup: string, review: string;
const propose = async (...actions: AIAction[]) => prepareProposal(await snapshot(db), parseAssistantResponse(JSON.stringify({ reply: 'ok', actions })), AI_DATE, [], crypto.randomUUID(), AI_NOW);
const approve = async (...actions: AIAction[]) => { const proposal = await propose(...actions); await db.aiProposals.add(proposal); await approveAIProposal(proposal.id, db, AI_NOW); return proposal; };
beforeEach(async () => {
  db = new WorkdayDB(`ai-meetings-${crypto.randomUUID()}`); await saveSettings({ ...defaultSettings(), timeZone: 'UTC' }, db);
  await saveMeeting({ title: 'Standup', start: `${AI_DATE}T10:00:00.000Z`, end: `${AI_DATE}T10:30:00.000Z`, timeZone: 'UTC' }, undefined, db);
  await saveMeeting({ title: 'Design review', start: `${AI_DATE}T14:00:00.000Z`, end: `${AI_DATE}T15:00:00.000Z`, timeZone: 'UTC' }, undefined, db);
  const events = await db.events.toArray(); standup = events.find(e => e.title === 'Standup')!.id; review = events.find(e => e.title === 'Design review')!.id;
});
afterEach(async () => { await db.delete(); });

it('shares meeting ids and times, and titles only when allowed', async () => {
  const options = { date: AI_DATE, scope: 'day' as const, includeDescriptions: false };
  const hidden = buildAIContext(await snapshot(db), options, AI_NOW);
  expect(hidden.meetings.map(m => m.id).sort()).toEqual([standup, review].sort()); expect(JSON.stringify(hidden)).not.toContain('Standup');
  expect(buildAIContext(await snapshot(db), { ...options, includeMeetingTitles: true }, AI_NOW).meetings.find(m => m.id === standup)).toMatchObject({ title: 'Standup', start: `${AI_DATE}T10:00:00.000Z` });
});

it('moves a meeting keeping its length, renames it, and saves only after approval', async () => {
  const proposal = await propose({ type: 'update_meeting', meetingId: standup, title: 'Daily standup', startLocal: `${AI_DATE}T11:00`, endLocal: null });
  expect(proposal.changes[0]).toMatchObject({ kind: 'meeting', id: standup, before: { title: 'Standup' }, after: { title: 'Daily standup', start: `${AI_DATE}T11:00:00.000Z`, end: `${AI_DATE}T11:30:00.000Z` } });
  expect((await db.events.get(standup))?.title).toBe('Standup');
  await db.aiProposals.add(proposal); await approveAIProposal(proposal.id, db, AI_NOW);
  expect(await db.events.get(standup)).toMatchObject({ title: 'Daily standup', start: `${AI_DATE}T11:00:00.000Z`, end: `${AI_DATE}T11:30:00.000Z` });
  const blocks = (await db.blocks.toArray()).filter(b => b.calendarEventId === standup);
  expect(blocks).toHaveLength(1); expect(blocks[0].start).toBe(`${AI_DATE}T11:00:00.000Z`);
});

it('deletes a meeting and frees its time, leaving other meetings alone', async () => {
  const proposal = await approve({ type: 'delete_meeting', meetingId: review });
  expect(proposal.changes[0]).toMatchObject({ kind: 'meeting', id: review, title: 'Design review', removed: true });
  expect((await db.events.toArray()).map(e => e.id)).toEqual([standup]);
  expect((await db.blocks.toArray()).some(b => b.calendarEventId === review)).toBe(false);
});

it('rejects unknown meetings, empty or conflicting changes and impossible times', async () => {
  await expect(propose({ type: 'delete_meeting', meetingId: 'made-up' })).rejects.toMatchObject({ code: 'invalid_action' });
  await expect(propose({ type: 'update_meeting', meetingId: standup, title: null, startLocal: null, endLocal: null })).rejects.toMatchObject({ code: 'invalid_action' });
  await expect(propose({ type: 'update_meeting', meetingId: standup, title: null, startLocal: null, endLocal: `${AI_DATE}T09:00` })).rejects.toMatchObject({ code: 'invalid_action' });
  await expect(propose({ type: 'delete_meeting', meetingId: standup }, { type: 'update_meeting', meetingId: standup, title: 'x', startLocal: null, endLocal: null })).rejects.toMatchObject({ code: 'invalid_action' });
  expect(await db.events.count()).toBe(2);
});
