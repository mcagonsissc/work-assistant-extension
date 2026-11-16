import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignJWT, generateKeyPair } from 'jose';
import { completeSignIn, directRequest, forgetBuiltInChatGPT, isSignInCallback, readCompletedStream, useIdentityKeyForTests } from '../src/services/ai/chatgpt-direct';

const AUTH = 'https://auth.openai.com', CLIENT = 'issued-client-1', PLAN = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
type Status = { accounts: { id: string; label: string; connected: boolean; planEnabled: boolean }[]; pending: string | null; result: { id: string; accountId?: string; error?: string } | null };
function area() {
  const data = new Map<string, unknown>();
  return { data,
    get: async (key: string) => (data.has(key) ? { [key]: structuredClone(data.get(key)) } : {}),
    set: async (items: Record<string, unknown>) => { for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v)); },
    remove: async (keys: string | string[]) => { for (const k of [keys].flat()) data.delete(k); } };
}
let local: ReturnType<typeof area>, session: ReturnType<typeof area>, opened: URL[], keys: Awaited<ReturnType<typeof generateKeyPair>>;
let tokenReplies: (Record<string, unknown> | { status: number; body: unknown })[], requests: { url: string; body: string; auth: string | null }[];
const idToken = (claims: Record<string, unknown>, audience = CLIENT) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256' }).setIssuer(AUTH).setAudience(audience).setSubject('user-1').setExpirationTime('5m').sign(keys.privateKey);
const sse = (events: unknown[]) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
const completed = (text: string) => ({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] } });
let inference: () => Response;

beforeEach(async () => {
  local = area(); session = area(); opened = []; tokenReplies = []; requests = [];
  keys = await generateKeyPair('RS256'); useIdentityKeyForTests(keys.publicKey);
  inference = () => sse([completed('{"reply":"ok","actions":[]}')]);
  vi.stubGlobal('chrome', { storage: { local, session }, tabs: { create: async ({ url }: { url: string }) => { opened.push(new URL(url)); return {}; } } });
  vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input), body = init.body instanceof URLSearchParams ? init.body.toString() : String(init.body ?? '');
    requests.push({ url, body, auth: new Headers(init.headers).get('authorization') });
    if (url === `${AUTH}/.well-known/openid-configuration`) return Response.json({ issuer: AUTH, jwks_uri: `${AUTH}/jwks`, revocation_endpoint: `${AUTH}/oauth/revoke` });
    if (url === `${AUTH}/oauth/revoke`) return new Response('', { status: 200 });
    if (url === `${AUTH}/api/accounts/oauth/token`) { const next = tokenReplies.shift()!; return 'status' in next && typeof next.status === 'number' ? Response.json(next.body, { status: next.status }) : Response.json(next); }
    if (url.endsWith('/v1/models')) return Response.json({ models: [{ slug: 'gpt-test', display_name: 'GPT Test', visibility: 'list' }, { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' }] });
    if (url.endsWith('/v1/responses')) return inference();
    throw new Error(`Unexpected request ${url}`);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); useIdentityKeyForTests(); });

async function signIn(scope = PLAN, expires_in = 3600) {
  const { id } = await directRequest({ op: 'start' }) as { id: string };
  const authorize = opened.at(-1)!, redirect = authorize.searchParams.get('redirect_uri')!;
  tokenReplies.push({ access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in, scope, id_token: await idToken({ nonce: authorize.searchParams.get('nonce'), email: 'person@example.com' }) });
  const callback = `${redirect}?code=code-1&state=${authorize.searchParams.get('state')}&client_id=${CLIENT}`;
  expect(await isSignInCallback(callback)).toBe(true);
  expect(await completeSignIn(callback)).toBe(true);
  const status = await directRequest({ op: 'status' }) as Status;
  return { id, authorize, redirect, callback, status, accountId: status.result?.accountId ?? '' };
}

it('signs in entirely inside the extension with PKCE, a loopback redirect and a verified identity', async () => {
  const { id, authorize, redirect, callback, status, accountId } = await signIn();
  expect(authorize.origin + authorize.pathname).toBe(`${AUTH}/api/accounts/authorize`);
  expect(authorize.searchParams.get('client_id')).toBe('dynamic_agent_client');
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorize.searchParams.get('ext_agent_host_id')).toMatch(/^urn:uuid:/);
  expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  const exchange = new URLSearchParams(requests.find(r => r.url.endsWith('/oauth/token'))!.body);
  expect(exchange.get('client_id')).toBe(CLIENT); expect(exchange.get('redirect_uri')).toBe(redirect); expect(exchange.get('code_verifier')).toBeTruthy();
  expect(status.result).toEqual({ id, accountId }); expect(status.pending).toBeNull();
  expect(status.accounts).toEqual([expect.objectContaining({ id: accountId, connected: true, planEnabled: true, label: expect.stringContaining('person@example.com') })]);
  expect(JSON.stringify(status)).not.toContain('access-1');
  expect(await completeSignIn(callback)).toBe(false); // The redirect is single use.
});

it('ignores callbacks with the wrong state and reports rejected identities', async () => {
  await directRequest({ op: 'start' });
  const authorize = opened[0], redirect = authorize.searchParams.get('redirect_uri')!;
  expect(await completeSignIn(`${redirect}?code=x&state=forged&client_id=${CLIENT}`)).toBe(false);
  expect(await isSignInCallback('http://127.0.0.1:1/auth/callback?code=x')).toBe(false);
  tokenReplies.push({ access_token: 'a', token_type: 'Bearer', expires_in: 60, scope: PLAN, id_token: await idToken({ nonce: 'someone-else' }) });
  await completeSignIn(`${redirect}?code=x&state=${authorize.searchParams.get('state')}&client_id=${CLIENT}`);
  const status = await directRequest({ op: 'status' }) as Status;
  expect(status.result?.error).toContain('did not match'); expect(status.accounts).toEqual([]);
});

it('cancels and times out a sign-in without saving anything', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  await directRequest({ op: 'start' });
  await expect(directRequest({ op: 'start' })).rejects.toMatchObject({ message: expect.stringContaining('already open') });
  await directRequest({ op: 'cancelAuth' });
  const { id } = await directRequest({ op: 'start' }) as { id: string };
  vi.setSystemTime(Date.now() + 301_000);
  const status = await directRequest({ op: 'status' }) as Status;
  expect(status.pending).toBeNull(); expect(status.result).toEqual({ id, error: expect.stringContaining('timed out') });
});

it('lists models and returns only completed, credential-redacted answers', async () => {
  const { accountId } = await signIn();
  expect(await directRequest({ op: 'models', accountId })).toEqual([expect.objectContaining({ id: 'gpt-test', name: 'GPT Test' })]);
  inference = () => sse([{ type: 'response.output_text.delta', delta: 'partial' }, completed('token access-1 leaked')]);
  expect(await directRequest({ op: 'complete', accountId, model: 'gpt-test', messages: [{ role: 'system', content: 'Rules' }, { role: 'user', content: 'Hi' }] })).toEqual({ text: 'token [redacted credential] leaked' });
  const sent = requests.find(r => r.url.endsWith('/v1/responses'))!, body = JSON.parse(sent.body);
  expect(sent.auth).toBe('Bearer access-1');
  expect(body).toMatchObject({ model: 'gpt-test', store: false, stream: true, instructions: 'Rules', input: [{ role: 'user', content: 'Hi' }] });
  inference = () => sse([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }]);
  await expect(directRequest({ op: 'complete', accountId, model: 'gpt-test', messages: [] })).rejects.toMatchObject({ code: 'rate_limit' });
  inference = () => sse([{ type: 'response.failed', response: { error: { code: 'some_new_code', message: 'You have reached your plan session limit.' } } }]);
  await expect(directRequest({ op: 'complete', accountId, model: 'gpt-test', messages: [] })).rejects.toMatchObject({ code: 'rate_limit', message: expect.stringContaining('usage limit') });
  inference = () => sse([{ type: 'response.failed', response: { error: { code: 'server_error', message: 'Something broke' } } }]);
  await expect(directRequest({ op: 'complete', accountId, model: 'gpt-test', messages: [] })).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('Something broke') });
  inference = () => sse([{ type: 'response.output_text.delta', delta: 'cut off' }]);
  await expect(directRequest({ op: 'complete', accountId, model: 'gpt-test', messages: [] })).rejects.toMatchObject({ code: 'invalid_response' });
  await expect(readCompletedStream(null)).rejects.toMatchObject({ code: 'invalid_response' });
});

it('rotates refresh tokens before use and clears a session the server has ended', async () => {
  const { accountId } = await signIn(PLAN, 1); // Already inside the refresh window.
  tokenReplies.push({ access_token: 'access-2', refresh_token: 'refresh-2', token_type: 'Bearer', expires_in: 1 });
  await directRequest({ op: 'models', accountId });
  expect(new URLSearchParams(requests.filter(r => r.url.endsWith('/oauth/token'))[1].body).get('refresh_token')).toBe('refresh-1');
  expect(requests.find(r => r.url.endsWith('/v1/models'))!.auth).toBe('Bearer access-2');
  tokenReplies.push({ status: 400, body: { error: 'invalid_grant' } });
  await expect(directRequest({ op: 'models', accountId })).rejects.toMatchObject({ code: 'unavailable' });
  expect(new URLSearchParams(requests.filter(r => r.url.endsWith('/oauth/token'))[2].body).get('refresh_token')).toBe('refresh-2');
  expect((await directRequest({ op: 'status' }) as Status).accounts[0].connected).toBe(false);
});

it('requires plan access, and sign-out revokes the session and removes the whole account', async () => {
  const { accountId } = await signIn('openid profile email');
  await expect(directRequest({ op: 'models', accountId })).rejects.toMatchObject({ message: expect.stringContaining('Enable plan access') });
  expect(await directRequest({ op: 'signOut', accountId })).toEqual({ revoked: true });
  expect(new URLSearchParams(requests.find(r => r.url.endsWith('/oauth/revoke'))!.body).get('token')).toBe('refresh-1');
  expect(JSON.stringify([...local.data.values()])).not.toContain('refresh-1');
  expect(JSON.stringify([...local.data.values()])).not.toContain('person@example.com');
  expect((await directRequest({ op: 'status' }) as Status).accounts).toEqual([]);
  const second = await signIn();
  await expect(directRequest({ op: 'start' })).rejects.toMatchObject({ message: expect.stringContaining('Sign out of the current') });
  expect(second.status.accounts).toHaveLength(1);
  await forgetBuiltInChatGPT(); expect(local.data.size).toBe(0);
});
