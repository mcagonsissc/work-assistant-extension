import { expect, it } from 'vitest';
import { describeInvalidResponse, parseAssistantResponse } from '../src/services/ai/schema';
import { OpenRouterProvider } from '../src/services/ai/openrouter';
import { AI_KEY } from './ai-fixtures';

it('accepts the near-miss answers small models give for a meeting', () => {
  const wrapped = 'Sure! Here is the JSON:\n```json\n' + JSON.stringify({ reply: 'Adding it.', actions: [{ type: 'create_meeting', title: 'Director meeting', start: '2026-11-16 15:00:00Z', durationMinutes: 30, note: 'urgent' }] }) + '\n```\nLet me know!';
  expect(parseAssistantResponse(wrapped).actions).toEqual([{ type: 'create_meeting', title: 'Director meeting', startLocal: '2026-11-16T15:00:00', endLocal: '2026-11-16T15:30' }]);
});

it('fills optional task details but never invents which task or when a meeting starts', () => {
  const created = parseAssistantResponse(JSON.stringify({ message: 'Done', actions: [{ type: 'create_task', title: 'Write report', priority: 'HIGH', duration: 45 }] }));
  expect(created).toEqual({ reply: 'Done', actions: [{ type: 'create_task', clientId: 'task_1', title: 'Write report', description: '', estimatedMinutes: 45, priority: 'high', category: 'other', scheduledDate: null, deadline: null, dependencyIds: [] }] });
  expect(parseAssistantResponse(JSON.stringify({ reply: 'ok', actions: [{ type: 'update_task', taskId: 't1', patch: { title: 'New title' } }] })).actions[0]).toMatchObject({ patch: { title: 'New title', estimatedMinutes: null, clearDeadline: false } });
  expect(parseAssistantResponse(JSON.stringify({ reply: 'Which task do you mean?' }))).toEqual({ reply: 'Which task do you mean?', actions: [] });
  expect(() => parseAssistantResponse(JSON.stringify({ reply: 'ok', actions: [{ type: 'complete_task' }] }))).toThrow();
  expect(() => parseAssistantResponse(JSON.stringify({ reply: 'ok', actions: [{ type: 'create_meeting', title: 'Sync', durationMinutes: 30 }] }))).toThrow();
  expect(() => parseAssistantResponse('I cannot do that.')).toThrow();
});

it('tells the model exactly what was wrong on the single retry', async () => {
  const bodies: { messages: { role: string; content: string }[] }[] = [];
  const bad = JSON.stringify({ reply: 'ok', actions: [{ type: 'create_meeting', title: 'Sync' }] });
  const good = JSON.stringify({ reply: 'When does it start?', actions: [] });
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ choices: [{ message: { content: bodies.length === 1 ? bad : good }, finish_reason: 'stop' }] }); }) as typeof fetch;
  const result = await new OpenRouterProvider(fetcher).complete({ apiKey: AI_KEY, model: { id: 'test/model', structured: false }, messages: [{ role: 'user', content: 'add a sync' }] });
  expect(result).toEqual({ response: { reply: 'When does it start?', actions: [] }, attempts: 2 });
  const retry = bodies[1].messages;
  expect(retry.at(-2)).toEqual({ role: 'assistant', content: bad });
  expect(retry.at(-1)?.content).toContain('actions.0.startLocal');
  expect(describeInvalidResponse(good)).toBe('');
});
