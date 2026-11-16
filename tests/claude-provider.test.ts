import { expect, it } from 'vitest';
import { ClaudeProvider, claudeMessages } from '../src/services/ai/claude';
import { answer, createAction } from './ai-fixtures';

const KEY = 'sk-ant-test-only-not-a-real-claude-key';
type Call = { url: string; headers: Headers; body: Record<string, unknown> | null };
function provider(reply: (call: Call, index: number) => Response) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();
    const call = { url: request.url, headers: request.headers, body: text ? JSON.parse(text) : null };
    calls.push(call); return reply(call, calls.length - 1);
  }) as typeof fetch;
  return { claude: new ClaudeProvider(fetcher, 5000), calls };
}
const message = (text: string, stop_reason = 'end_turn') => Response.json({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
const apiError = (status: number, type: string, headers: Record<string, string> = {}) => Response.json({ type: 'error', error: { type, message: 'nope' } }, { status, headers });
const options = { apiKey: KEY, model: { id: 'claude-opus-5-5', structured: true }, messages: [{ role: 'system' as const, content: 'Rules' }, { role: 'user' as const, content: 'Plan my day' }] };

it('lists Claude models with the key in a header', async () => {
  const { claude, calls } = provider(() => Response.json({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', type: 'model', created_at: '2026-01-01T00:00:00Z', max_input_tokens: 1_000_000 }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' }));
  expect(await claude.listModels(undefined, KEY)).toEqual([expect.objectContaining({ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', contextLength: 1_000_000, structured: true })]);
  expect(new URL(calls[0].url).origin + new URL(calls[0].url).pathname).toBe('https://api.anthropic.com/v1/models');
  expect(calls[0].headers.get('authorization') ?? calls[0].headers.get('x-api-key')).toContain(KEY); expect(calls[0].url).not.toContain(KEY);
  await expect(claude.listModels()).rejects.toMatchObject({ code: 'configuration' });
});

it('sends system text separately, asks for schema-constrained JSON and validates the answer', async () => {
  const expected = answer(createAction({ title: 'Claude task' }));
  const { claude, calls } = provider(() => message(JSON.stringify(expected)));
  expect(await claude.complete(options)).toEqual({ response: expected, attempts: 1 });
  const body = calls[0].body as { model: string; system: string; messages: unknown; max_tokens: number; output_config: { format: { type: string } }; temperature?: number };
  expect(body).toMatchObject({ model: 'claude-opus-5-5', system: 'Rules', messages: [{ role: 'user', content: 'Plan my day' }] });
  expect(body.output_config.format.type).toBe('json_schema'); expect(body.temperature).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain(KEY);
  expect(claudeMessages([{ role: 'system', content: 'a' }, { role: 'assistant', content: 'b' }])).toEqual({ system: 'a', messages: [{ role: 'assistant', content: 'b' }] });
});

it('falls back to schema-guided text once when a model rejects structured output, and retries one invalid answer', async () => {
  const expected = answer();
  const fallback = provider((_call, i) => i === 0 ? apiError(400, 'invalid_request_error') : message(JSON.stringify(expected)));
  expect(await fallback.claude.complete(options)).toEqual({ response: expected, attempts: 2 });
  expect(fallback.calls[1].body).not.toHaveProperty('output_config');
  const corrected = provider((_call, i) => message(i === 0 ? 'not json' : JSON.stringify(expected)));
  expect((await corrected.claude.complete(options)).attempts).toBe(2);
  expect(JSON.stringify(corrected.calls[1].body)).toContain('could not be validated');
});

it('maps refusals, truncation and API errors to safe messages without retry storms', async () => {
  for (const reason of ['refusal', 'max_tokens']) {
    const stopped = provider(() => message('{}', reason));
    await expect(stopped.claude.complete(options)).rejects.toMatchObject({ code: 'invalid_response' }); expect(stopped.calls).toHaveLength(2);
  }
  const auth = provider(() => apiError(401, 'authentication_error'));
  await expect(auth.claude.complete(options)).rejects.toMatchObject({ code: 'auth' }); expect(auth.calls).toHaveLength(1);
  const limited = provider(() => apiError(429, 'rate_limit_error', { 'retry-after': '12' }));
  await expect(limited.claude.complete(options)).rejects.toMatchObject({ code: 'rate_limit', retryAfterSeconds: 12 }); expect(limited.calls).toHaveLength(1);
  const down = provider(() => apiError(529, 'overloaded_error'));
  await expect(down.claude.listModels(undefined, KEY)).rejects.toMatchObject({ code: 'unavailable' });
  const aborted = new AbortController(); aborted.abort();
  await expect(provider(() => message('{}')).claude.complete({ ...options, signal: aborted.signal })).rejects.toMatchObject({ code: 'cancelled' });
});
