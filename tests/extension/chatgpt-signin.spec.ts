import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { answer, createAction } from '../ai-fixtures';
const AUTH = 'https://auth.openai.com', CLIENT = 'issued-extension-client';
test('packaged extension signs in to ChatGPT by itself: real tab redirect, token exchange in the worker, no helper', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'workday-chatgpt-extension-')), extensionPath = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: ['--host-resolver-rules=MAP auth.openai.com 127.0.0.1:1, MAP api.openai.com 127.0.0.1:1', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), extensionId = new URL(worker.url()).host;
    expect(await worker.evaluate(() => chrome.runtime.getManifest().permissions)).not.toContain('nativeMessaging');
    const keys = await generateKeyPair('RS256'), jwk = { ...await exportJWK(keys.publicKey), kid: 'test', alg: 'RS256', use: 'sig' };
    let nonce = '', redirect = '', exchange: URLSearchParams | undefined;
    await context.route(/https:\/\/(api|auth)\.openai\.com\//, async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/api/accounts/authorize') {
        // Stands in for OpenAI's login page: approve and send the browser to the loopback redirect.
        nonce = url.searchParams.get('nonce')!; redirect = url.searchParams.get('redirect_uri')!;
        await route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(`${redirect}?code=test-code&state=${url.searchParams.get('state')}&client_id=${CLIENT}`)})</script>` });
      } else if (url.pathname === '/.well-known/openid-configuration') await route.fulfill({ json: { issuer: AUTH, jwks_uri: `${AUTH}/jwks`, revocation_endpoint: `${AUTH}/oauth/revoke` } });
      else if (url.pathname === '/jwks') await route.fulfill({ json: { keys: [jwk] } });
      else if (url.pathname === '/api/accounts/oauth/token') {
        exchange = new URLSearchParams(request.postData() ?? '');
        const id_token = await new SignJWT({ nonce, email: 'person@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(AUTH).setAudience(CLIENT).setSubject('user-1').setExpirationTime('5m').sign(keys.privateKey);
        await route.fulfill({ json: { access_token: 'extension-access-token', refresh_token: 'extension-refresh-token', token_type: 'Bearer', expires_in: 3600, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', id_token } });
      } else if (url.pathname === '/v1/models') await route.fulfill({ json: { models: [{ slug: 'extension-test', display_name: 'Extension Test', visibility: 'list' }] } });
      else if (url.pathname === '/v1/responses') await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer(createAction({ title: 'Built-in ChatGPT task', scheduledDate: null }))) }] }] } })}\n\n` });
      else await route.fulfill({ status: 200, body: '' });
    });
    const page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'AI provider', exact: true }).selectOption('chatgpt');
    const signInTab = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
    const tab = await signInTab;
    // A tab opened by the extension starts loading before request interception attaches (the resolver rule above keeps that first load off the network); load the sign-in URL again so the stand-in page answers.
    await tab.waitForLoadState().catch(() => {});
    const pending = await worker.evaluate(async () => (await chrome.storage.session.get('workday.chatgpt.pending'))['workday.chatgpt.pending'] as { redirect: string; state: string; nonce: string });
    await tab.goto(`${AUTH}/api/accounts/authorize?${new URLSearchParams({ redirect_uri: pending.redirect, state: pending.state, nonce: pending.nonce })}`).catch(() => {});
    // Nothing listens on the loopback port; the worker swaps the failed page for the extension's own.
    await expect(tab).toHaveURL(`chrome-extension://${extensionId}/signed-in.html`);
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    await expect(page.getByText('You’re using your ChatGPT plan', { exact: true })).toBeVisible();
    expect(exchange?.get('code')).toBe('test-code'); expect(exchange?.get('client_id')).toBe(CLIENT); expect(exchange?.get('redirect_uri')).toBe(redirect); expect(exchange?.get('code_verifier')).toBeTruthy();
    await expect(page.getByText(/person@example\.com/)).toBeVisible();
    await page.getByRole('button', { name: 'Got it', exact: true }).click();
    // Models are fetched automatically after sign-in.
    await expect(page.getByRole('combobox', { name: 'ChatGPT model', exact: true })).toHaveValue('extension-test');
    await page.getByLabel('Allow sending my requests, selected workday context and this account’s recent chat to OpenAI using my ChatGPT plan.', { exact: true }).check();
    await page.getByRole('button', { name: 'Save ChatGPT settings', exact: true }).click();
    await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
    await page.getByLabel('Message to AI', { exact: true }).fill('Add a task with my plan.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review proposed changes', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Approve changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Changes approved', exact: true })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain('extension-access-token');
    // The session survives closing the panel; tokens live only in extension storage.
    await page.close(); const reopened = await context.newPage(); await reopened.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(reopened.getByText(/Using ChatGPT plan/)).toBeVisible();
    expect(await reopened.evaluate(() => JSON.stringify(localStorage))).not.toContain('extension-access-token');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
