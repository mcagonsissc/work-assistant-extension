import { test, expect } from '@playwright/test';
test('the interface switches language from Settings and remembers it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Display language', exact: true }).selectOption('fr');
  await expect(page.getByRole('heading', { name: 'Paramètres', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await page.getByRole('button', { name: 'Aujourd’hui', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter une tâche', exact: true }).click();
  await page.getByLabel('Titre de la tâche').fill('Rédiger le rapport');
  await page.getByRole('button', { name: 'Enregistrer la tâche', exact: true }).click();
  await expect(page.locator('.task .metadata')).toContainText('À faire');
  await expect(page.locator('.task .priority')).toHaveText('moyenne');
  for (const width of [320, 360]) { await page.setViewportSize({ width, height: 850 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.screenshot({ path: 'test-results/today-fr.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ajouter une tâche', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Paramètres', exact: true }).click();
  await page.screenshot({ path: 'test-results/settings-de-source.png', fullPage: true });
  await page.getByRole('combobox', { name: 'Langue d’affichage', exact: true }).selectOption('de');
  await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible();
  for (const width of [320, 360]) { await page.setViewportSize({ width, height: 850 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.screenshot({ path: 'test-results/settings-de.png', fullPage: true });
  await page.getByRole('combobox', { name: 'Anzeigesprache', exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});
