import { test, expect } from '@playwright/test';
import { answer, createAction, AI_DATE } from '../ai-fixtures';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const accountId = '11111111-1111-4111-8111-111111111111';
test('built-in ChatGPT session discovers models, proposes changes and signs out (mocked OpenAI)', async ({ page }) => {
  // The dev page has no extension APIs: provide in-memory extension storage holding a signed-in session.
  await page.addInitScript(({ accountId }) => {
    const area = (data: Record<string, unknown>) => ({
      get: async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
      set: async (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)); },
      remove: async (keys: string | string[]) => { for (const key of [keys].flat()) delete data[key]; },
    });
    const vault = { hostId: 'urn:uuid:test', accounts: [{ id: accountId, clientId: 'issued-client', subject: 'user-1', email: 'person@example.com', tokens: { access: 'oauth-access-token', refresh: 'oauth-refresh-token', expires: Date.now() + 3_600_000, scopes: ['openid', 'chatgpt.tokens.use.direct'] } }] };
    Object.defineProperty(window, 'chrome', { configurable: true, value: { runtime: { id: 'a'.repeat(32), sendMessage: async () => ({}) }, storage: { local: area({ 'workday.chatgpt.vault': vault }), session: area({}) }, tabs: { create: async () => ({}) } } });
  }, { accountId });
  const calls: { url: string; auth: string | null; body: string | null }[] = [];
  await page.route(/https:\/\/(api|auth)\.openai\.com\//, async route => {
    const request = route.request(), url = request.url();
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    calls.push({ url, auth: await request.headerValue('authorization'), body: request.postData() });
    if (url.endsWith('/v1/models')) await route.fulfill({ headers, json: { models: [{ slug: 'chatgpt-test', display_name: 'ChatGPT Test', visibility: 'list' }] } });
    else if (url.endsWith('/v1/responses')) await route.fulfill({ headers, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer(createAction({ title: 'ChatGPT proposed task', scheduledDate: AI_DATE }))) }] }] } })}\n\n` });
    else if (url.endsWith('/.well-known/openid-configuration')) await route.fulfill({ headers, json: { issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/jwks', revocation_endpoint: 'https://auth.openai.com/oauth/revoke' } });
    else if (url.endsWith('/oauth/revoke')) await route.fulfill({ headers, status: 200, body: '' });
    else await route.fulfill({ headers, status: 404, json: {} });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'AI provider', exact: true }).selectOption('chatgpt');
  await expect(page.getByLabel('OpenAI API key', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/person@example\.com/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Use account', exact: true }).click();
  await expect(page.getByText('You’re using your ChatGPT plan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh ChatGPT models', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'ChatGPT model', exact: true })).toHaveValue('chatgpt-test');
  await page.getByLabel('Allow sending my requests, selected workday context and this account’s recent chat to OpenAI using my ChatGPT plan.', { exact: true }).check();
  await page.getByRole('button', { name: 'Save ChatGPT settings', exact: true }).click();
  await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
  await expect(page.getByText(/Using ChatGPT plan/)).toBeVisible();
  await page.getByLabel('Message to AI', { exact: true }).fill('Add a task with my ChatGPT plan.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review proposed changes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Today', exact: true }).click(); await expect(page.locator('.task')).toHaveCount(0);
  await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Approve changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Changes approved', exact: true })).toBeVisible();
  const inference = calls.find(c => c.url.endsWith('/v1/responses'))!;
  expect(inference.auth).toBe('Bearer oauth-access-token');
  expect(JSON.parse(inference.body!)).toMatchObject({ model: 'chatgpt-test', store: false, stream: true });
  expect(await page.locator('body').innerText()).not.toContain('oauth-access-token');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toBeVisible();
  await expect(page.getByText(/person@example\.com/)).toHaveCount(0);
  expect(calls.find(c => c.url.endsWith('/oauth/revoke'))?.body).toContain('oauth-refresh-token');
  await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
});
