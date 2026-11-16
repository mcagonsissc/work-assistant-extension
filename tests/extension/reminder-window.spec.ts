import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
test('the test reminder opens a browser window with the reminder text', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'workday-reminder-')), extensionPath = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const page = await context.newPage(); await page.goto(`chrome-extension://${id}/index.html`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const opened = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Send a test reminder', exact: true }).click();
    const reminder = await opened;
    await expect(reminder.getByRole('heading', { name: 'Workday reminders are on', exact: true })).toBeVisible();
    await expect(reminder.getByText('Reminders and check-ins will appear like this.', { exact: true })).toBeVisible();
    await reminder.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect.poll(() => reminder.isClosed()).toBe(true);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
