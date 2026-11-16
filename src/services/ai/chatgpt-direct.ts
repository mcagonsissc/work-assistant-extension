// Built-in ChatGPT sign-in: the whole OAuth flow runs inside the extension, with no helper process.
// The sign-in tab is redirected to a 127.0.0.1 address nobody listens on; the background worker
// reads the authorization code from that tab's URL and finishes the exchange.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AIError } from './schema';

const AUTH = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const VAULT = 'workday.chatgpt.vault', PENDING = 'workday.chatgpt.pending', RESULT = 'workday.chatgpt.result';
const LOGIN_MS = 300_000;

interface Tokens { access: string; refresh?: string; id?: string; expires: number; scopes: string[] }
interface Account { id: string; clientId: string; subject?: string; email?: string; tokens?: Tokens; welcomeAcknowledged?: boolean }
interface Vault { hostId: string; accounts: Account[] }
interface Pending { id: string; state: string; nonce: string; verifier: string; redirect: string; accountId?: string; expires: number; consumed?: boolean }
type Result = { id: string; accountId?: string; error?: string } | null;
type Fail = AIError & { terminal?: boolean };

function areas() {
  const storage = globalThis.chrome?.storage;
  if (!storage?.local) throw new AIError('configuration', 'ChatGPT sign-in needs the installed extension. Load it in Edge, then retry.');
  return { local: storage.local, session: storage.session ?? storage.local };
}
async function read<T>(area: chrome.storage.StorageArea, key: string): Promise<T | undefined> { return (await area.get(key))[key] as T | undefined; }

// One writer at a time across the side panel and the background worker, so a rotating
// refresh token is never used twice.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  if (globalThis.navigator?.locks) return navigator.locks.request('workday-chatgpt', fn) as Promise<T>;
  const next = chain.then(fn, fn); chain = next.catch(() => {}); return next;
}
async function loadVault(): Promise<Vault> {
  return await read<Vault>(areas().local, VAULT) ?? { hostId: `urn:uuid:${crypto.randomUUID()}`, accounts: [] };
}
function withVault<T>(fn: (vault: Vault) => Promise<T> | T): Promise<T> {
  return locked(async () => { const vault = await loadVault(); try { return await fn(vault); } finally { await areas().local.set({ [VAULT]: vault }); } });
}

function random(bytes: number) { return base64url(crypto.getRandomValues(new Uint8Array(bytes))); }
function base64url(bytes: Uint8Array) { let text = ''; for (const b of bytes) text += String.fromCharCode(b); return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function sameText(a: string | null, b: string) { if (typeof a !== 'string' || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }

function httpFailure(status: number, body: unknown): Fail {
  const raw = body && typeof body === 'object' && 'error' in body ? (body as { error: unknown }).error : undefined;
  const code = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && 'code' in raw ? String((raw as { code: unknown }).code) : '';
  const error: Fail = status === 429 ? new AIError('rate_limit', 'ChatGPT usage limit reached. Manage usage in ChatGPT, then retry here.')
    : status === 403 ? new AIError('auth', 'ChatGPT plan access is unavailable for this account, workspace or region.')
    : status === 401 ? new AIError('auth', 'ChatGPT authorization expired. Sign in again.')
    : new AIError('unavailable', 'ChatGPT could not complete this request. Please retry later.');
  error.terminal = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(code);
  return error;
}
async function jsonRequest(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let response: Response, text: string;
  try {
    response = await fetch(url, { ...init, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: signal ?? AbortSignal.timeout(30_000) });
    text = await response.text();
  } catch {
    if (signal?.aborted) throw new AIError('cancelled', 'ChatGPT request cancelled.');
    throw new AIError('network', 'ChatGPT could not be reached. Your saved sign-in is kept.');
  }
  if (text.length > 2_000_000) throw new AIError('invalid_response', 'ChatGPT returned an oversized response.');
  let body: unknown = null; try { body = JSON.parse(text); } catch { /* handled below */ }
  if (!response.ok) throw httpFailure(response.status, body);
  if (!body || typeof body !== 'object') throw new AIError('invalid_response', 'ChatGPT returned an unreadable response.');
  return body as Record<string, unknown>;
}

let discovery: Promise<Record<string, unknown>> | undefined;
async function metadata() {
  discovery ??= jsonRequest(`${AUTH}/.well-known/openid-configuration`).catch(e => { discovery = undefined; throw e; });
  const value = await discovery;
  if (value.issuer !== AUTH) throw new AIError('auth', 'ChatGPT identity discovery failed.');
  for (const key of ['jwks_uri', 'revocation_endpoint']) if (typeof value[key] === 'string' && new URL(value[key]).origin !== AUTH) throw new AIError('auth', 'ChatGPT identity endpoint could not be verified.');
  return value;
}
type KeySource = Parameters<typeof jwtVerify>[1];
let testKey: KeySource | undefined;
/** Test seam: verify ID tokens against a local key instead of fetching OpenAI's key set. */
export function useIdentityKeyForTests(key?: KeySource) { testKey = key; discovery = undefined; }
async function verifyIdentity(token: unknown, clientId: string, nonce?: string, subject?: string) {
  if (typeof token !== 'string') throw new AIError('auth', 'ChatGPT did not return an identity. Sign in again.');
  let payload;
  try {
    const key = testKey ?? createRemoteJWKSet(new URL(String((await metadata()).jwks_uri)));
    ({ payload } = await jwtVerify(token, key as Parameters<typeof jwtVerify>[1], { issuer: AUTH, audience: clientId, algorithms: ['RS256', 'ES256'], requiredClaims: ['exp', 'sub'] }));
  } catch (e) { if (e instanceof AIError) throw e; throw new AIError('auth', 'ChatGPT identity verification failed. Please retry sign-in.'); }
  if (!payload.sub || (nonce && payload.nonce !== nonce) || (subject && payload.sub !== subject)) throw new AIError('auth', 'ChatGPT identity did not match the selected sign-in.');
  return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email.slice(0, 200) : 'ChatGPT account' };
}
function applyTokens(account: Account, body: Record<string, unknown>, refresh = false) {
  if (typeof body.access_token !== 'string' || String(body.token_type).toLowerCase() !== 'bearer' || typeof body.expires_in !== 'number' || !(body.expires_in > 0)) throw new AIError('auth', 'ChatGPT returned incomplete credentials. Sign in again.');
  const old = refresh ? account.tokens : undefined;
  account.tokens = {
    access: body.access_token,
    refresh: typeof body.refresh_token === 'string' ? body.refresh_token : old?.refresh,
    id: typeof body.id_token === 'string' ? body.id_token : old?.id,
    expires: Date.now() + body.expires_in * 1000,
    scopes: typeof body.scope === 'string' ? body.scope.split(' ') : old?.scopes ?? [],
  };
}
function publicAccount(a: Account) {
  return { id: a.id, label: `${a.email || 'Registration pending'} · ${a.id.slice(0, 6)}`, connected: !!a.tokens, planEnabled: !!a.tokens?.scopes.includes(PLAN_SCOPE), welcomeAcknowledged: !!a.welcomeAcknowledged };
}
function redact(text: string, tokens: Tokens) {
  let safe = text;
  for (const secret of [tokens.access, tokens.refresh, tokens.id]) if (secret) safe = safe.split(secret).join('[redacted credential]');
  return safe.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted credential]');
}

async function currentPending() {
  const { session } = areas();
  const pending = await read<Pending>(session, PENDING);
  if (pending && pending.expires < Date.now()) {
    await session.remove(PENDING);
    await session.set({ [RESULT]: { id: pending.id, error: 'ChatGPT sign-in timed out. Please try again.' } });
    return undefined;
  }
  return pending;
}
async function status() {
  const pending = await currentPending();
  return { accounts: (await loadVault()).accounts.map(publicAccount), pending: pending?.id ?? null, result: await read<Result>(areas().session, RESULT) ?? null };
}
async function sha256(text: string) { return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))); }
async function start(accountId?: string, consent = false) {
  if (await currentPending()) throw new AIError('configuration', 'A ChatGPT sign-in is already open. Finish or cancel it first.');
  const vault = await withVault(v => structuredClone(v)); // Also persists a newly created host ID.
  const account = accountId ? vault.accounts.find(a => a.id === accountId) : undefined;
  if (accountId && !account) throw new AIError('configuration', 'The selected ChatGPT account no longer exists.');
  // One ChatGPT account at a time: a different account needs the current one signed out first.
  if (!accountId && vault.accounts.some(a => a.tokens)) throw new AIError('configuration', 'Sign out of the current ChatGPT account before signing in to another.');
  // Nothing listens on this port. It only has to be a loopback address the extension can recognize.
  const port = 49152 + crypto.getRandomValues(new Uint16Array(1))[0] % 16000;
  const pending: Pending = { id: crypto.randomUUID(), state: random(32), nonce: random(32), verifier: random(48), redirect: `http://127.0.0.1:${port}/auth/callback`, accountId, expires: Date.now() + LOGIN_MS };
  const params: Record<string, string> = { client_id: account?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: vault.hostId, response_type: 'code', redirect_uri: pending.redirect, scope: SCOPES, resource: RESOURCE, state: pending.state, nonce: pending.nonce, code_challenge_method: 'S256', code_challenge: await sha256(pending.verifier) };
  if (!account) params.agent_name_hint = 'AI Workday Assistant';
  if (account?.email) params.login_hint = account.email;
  if (consent) params.prompt = 'consent';
  const { session } = areas();
  await session.remove(RESULT); await session.set({ [PENDING]: pending });
  try { await chrome.tabs.create({ url: `${AUTH}/api/accounts/authorize?${new URLSearchParams(params)}` }); }
  catch { await session.remove(PENDING); throw new AIError('unavailable', 'Unable to open the ChatGPT sign-in tab.'); }
  return { id: pending.id };
}
async function cancelAuth() { const { session } = areas(); await session.remove([PENDING, RESULT]); return {}; }

/** True when a tab URL is the redirect of the sign-in currently in progress. */
export async function isSignInCallback(url: string) {
  if (!url.startsWith('http://127.0.0.1:')) return false;
  const pending = await read<Pending>(areas().session, PENDING);
  return !!pending && url.startsWith(`${pending.redirect}?`);
}
/** Finishes sign-in from the redirected tab URL. Called by the background worker. */
export async function completeSignIn(callback: string) {
  const { session } = areas();
  const pending = await locked(async () => {
    const value = await currentPending();
    if (!value || value.consumed || !callback.startsWith(`${value.redirect}?`)) return undefined;
    if (!sameText(new URL(callback).searchParams.get('state'), value.state)) return undefined;
    await session.set({ [PENDING]: { ...value, consumed: true } }); // One-time use.
    return value;
  });
  if (!pending) return false;
  let result: NonNullable<Result>;
  try {
    const query = new URL(callback).searchParams;
    if (query.has('error')) throw new AIError('auth', 'ChatGPT sign-in was not authorized.');
    const account = pending.accountId ? (await loadVault()).accounts.find(a => a.id === pending.accountId) : undefined;
    if (pending.accountId && !account) throw new AIError('auth', 'The selected ChatGPT account no longer exists.');
    const clientId = query.get('client_id') || account?.clientId, code = query.get('code');
    if (!code || !clientId || clientId === 'dynamic_agent_client' || clientId.length > 256 || (account && clientId !== account.clientId)) throw new AIError('auth', 'ChatGPT registration could not be verified.');
    const tokens = await jsonRequest(`${AUTH}/api/accounts/oauth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: pending.verifier, redirect_uri: pending.redirect, resource: RESOURCE }) });
    const identity = await verifyIdentity(tokens.id_token, clientId, pending.nonce, account?.subject);
    const accountId = await withVault(async vault => {
      if ((await read<Pending>(session, PENDING))?.id !== pending.id) throw new AIError('cancelled', 'ChatGPT sign-in was cancelled.');
      let row = vault.accounts.find(a => a.id === pending.accountId);
      if (!row) { row = { id: crypto.randomUUID(), clientId }; vault.accounts = [row]; } // Replaces any expired leftover account.
      const next = { ...row, ...identity }; applyTokens(next, tokens); Object.assign(row, next);
      return row.id;
    });
    result = { id: pending.id, accountId };
  } catch (e) { result = { id: pending.id, error: e instanceof AIError ? e.message : 'ChatGPT sign-in did not complete. Please retry.' }; }
  if ((await read<Pending>(session, PENDING))?.id === pending.id) { await session.remove(PENDING); await session.set({ [RESULT]: result }); }
  return true;
}

async function authorized<T>(accountId: string, fn: (tokens: Tokens) => Promise<T>): Promise<T> {
  const tokens = await withVault(async vault => {
    const row = vault.accounts.find(a => a.id === accountId);
    if (!row?.tokens) throw new AIError('auth', 'Sign in with ChatGPT first.');
    if (row.tokens.expires < Date.now() + 30_000) {
      if (!row.tokens.refresh) { delete row.tokens; throw new AIError('auth', 'Your ChatGPT session expired. Sign in again.'); }
      try {
        const body = await jsonRequest(`${AUTH}/api/accounts/oauth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: row.clientId, refresh_token: row.tokens.refresh, resource: RESOURCE }) });
        if (typeof body.id_token === 'string') await verifyIdentity(body.id_token, row.clientId, undefined, row.subject);
        applyTokens(row, body, true); // Saved by withVault before any inference can fail.
      } catch (e) { if ((e as Fail).terminal) delete row.tokens; throw e; }
    }
    if (!row.tokens.scopes.includes(PLAN_SCOPE)) throw new AIError('auth', 'ChatGPT plan use is not enabled. Choose Enable plan access in Settings.');
    return structuredClone(row.tokens);
  });
  return fn(tokens);
}
const modelId = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/;
async function models(accountId: string, signal?: AbortSignal) {
  return authorized(accountId, async tokens => {
    const body = await jsonRequest(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${tokens.access}` } }, signal);
    if (!Array.isArray(body.models)) throw new AIError('invalid_response', 'ChatGPT returned an unreadable model list.');
    return (body.models as { slug?: unknown; display_name?: unknown; visibility?: unknown }[])
      .filter((m): m is { slug: string; display_name?: unknown } => m?.visibility === 'list' && typeof m.slug === 'string' && modelId.test(m.slug) && redact(m.slug, tokens) === m.slug)
      .map(m => ({ id: m.slug, name: redact(typeof m.display_name === 'string' ? m.display_name.slice(0, 200) : m.slug, tokens), free: false, promptPrice: null, completionPrice: null, structured: false, contextLength: null }));
  });
}
type Message = { role: 'system' | 'user' | 'assistant'; content: string };
async function complete(accountId: string, model: string, messages: Message[], signal?: AbortSignal) {
  if (!modelId.test(model)) throw new AIError('configuration', 'Choose a ChatGPT model in Settings.');
  return authorized(accountId, async tokens => {
    const controller = new AbortController(), abort = () => controller.abort();
    let timedOut = false; const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
    if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${RESOURCE}/responses`, { method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { Authorization: `Bearer ${tokens.access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, store: false, stream: true, instructions: messages.filter(m => m.role === 'system').map(m => m.content).join('\n'), input: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })) }) });
      if (!response.ok) { let body: unknown = null; try { body = await response.json(); } catch { /* status is enough */ } throw httpFailure(response.status, body); }
      return { text: redact(await readCompletedStream(response.body), tokens) };
    } catch (e) {
      if (signal?.aborted) throw new AIError('cancelled', 'ChatGPT request cancelled.');
      if (timedOut) throw new AIError('timeout', 'ChatGPT took too long to answer. No task changes were applied.');
      if (e instanceof AIError) throw e;
      throw new AIError('network', 'ChatGPT request interrupted. No task changes were applied.');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  });
}
type StreamError = { code?: unknown; message?: unknown } | null;
type StreamEvent = { type?: string; code?: unknown; message?: unknown; error?: StreamError; response?: { status?: string; error?: StreamError; incomplete_details?: { reason?: unknown } | null; output?: { type?: string; content?: { type?: string; text?: string }[] }[] } };
/** OpenAI's own explanation for a failed stream, trimmed and safe to show. */
function streamFailure(event: StreamEvent) {
  const error = event.response?.error ?? event.error ?? (event.type === 'error' ? event : null);
  const parts = [error?.code, error?.message, event.response?.incomplete_details?.reason].filter((v): v is string => typeof v === 'string' && !!v);
  return [...new Set(parts)].join(': ').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]').replace(/\s+/g, ' ').slice(0, 300);
}
/** Returns the text of a streamed response only once the server reports it completed. */
export async function readCompletedStream(body: ReadableStream<Uint8Array> | null) {
  if (!body) throw new AIError('invalid_response', 'ChatGPT returned no response stream.');
  const reader = body.getReader(), decoder = new TextDecoder(); let buffer = '', total = 0, completed: string | undefined;
  try {
    while (completed === undefined) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length; if (total > 2_000_000) throw new AIError('invalid_response', 'ChatGPT response exceeded the safe size limit.');
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        let parsed: StreamEvent;
        try { parsed = JSON.parse(data); } catch { throw new AIError('invalid_response', 'ChatGPT returned an invalid stream.'); }
        if (parsed.type === 'response.failed' || parsed.type === 'response.incomplete' || parsed.type === 'error') {
          const reason = streamFailure(parsed);
          if (/usage_(limit_exceeded|unavailable)/.test(reason)) throw new AIError('rate_limit', 'ChatGPT usage limit reached. Manage usage in ChatGPT, then retry here.');
          throw new AIError('unavailable', `ChatGPT did not finish its response${reason ? ` (${reason})` : ''}. No task changes were applied.`);
        }
        if (parsed.type === 'response.completed') {
          if (parsed.response?.status !== 'completed') throw new AIError('invalid_response', 'ChatGPT response was incomplete.');
          completed = (parsed.response.output ?? []).filter(i => i.type === 'message').flatMap(i => i.content ?? []).filter(c => c.type === 'output_text').map(c => c.text ?? '').join('');
        }
      }
    }
    if (!completed || completed.length > 64_000) throw new AIError('invalid_response', 'ChatGPT response was interrupted or empty. No task changes were applied.');
    return completed;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function revoke(account: Account) {
  if (!account.tokens) return true;
  try {
    const endpoint = (await metadata()).revocation_endpoint;
    if (typeof endpoint !== 'string') return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await fetch(endpoint, { method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10_000), body: new URLSearchParams({ token: account.tokens.refresh || account.tokens.access, token_type_hint: account.tokens.refresh ? 'refresh_token' : 'access_token', client_id: account.clientId }) });
        if (result.ok) return true; if (result.status < 500) return false;
      } catch { /* retry once */ }
    }
  } catch { /* reported as unconfirmed */ }
  return false;
}
async function signOut(accountId: string) {
  await cancelAuth();
  return withVault(async vault => {
    const account = vault.accounts.find(a => a.id === accountId); if (!account) return { revoked: true };
    const revoked = await revoke(account);
    // Nothing about a signed-out account is kept: no email, client registration or tokens.
    vault.accounts = vault.accounts.filter(a => a.id !== accountId);
    return { revoked };
  });
}
/** Signs out every built-in account and removes saved sign-in data. Used by "Delete all local data". */
export async function forgetBuiltInChatGPT() {
  if (!globalThis.chrome?.storage?.local) return;
  const { local, session } = areas();
  await locked(async () => { for (const account of (await loadVault()).accounts) await revoke(account); await local.remove(VAULT); await session.remove([PENDING, RESULT]); });
}
async function acknowledge(accountId: string) { return withVault(vault => { const account = vault.accounts.find(a => a.id === accountId); if (account) account.welcomeAcknowledged = true; return {}; }); }

/** Same command set as the optional local helper, served from inside the extension. */
export async function directRequest(command: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const id = typeof command.accountId === 'string' ? command.accountId : '';
  switch (command.op) {
    case 'status': return status();
    case 'start': return start(id || undefined, command.consent === true);
    case 'cancelAuth': return cancelAuth();
    case 'models': return models(id, signal);
    case 'complete': return complete(id, String(command.model), command.messages as Message[], signal);
    case 'signOut': return signOut(id);
    case 'acknowledge': return acknowledge(id);
    default: throw new AIError('configuration', 'Unsupported ChatGPT request.');
  }
}
