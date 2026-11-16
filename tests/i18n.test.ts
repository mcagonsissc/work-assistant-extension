import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { resolveLanguage, setLanguage, t } from '../src/i18n';
import fr from '../src/i18n/fr.json';
import es from '../src/i18n/es.json';
import de from '../src/i18n/de.json';
import pt from '../src/i18n/pt.json';
const dictionaries: Record<string, Record<string, string>> = { fr, es, de, pt };
afterEach(() => setLanguage('en'));
const placeholders = (text: string) => (text.match(/\{[a-z]+\}/g) ?? []).sort();
function sources(dir: string): string[] { return readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : []; }); }

it('every language covers the same strings and keeps placeholders and edge spacing intact', () => {
  const keys = Object.keys(fr).sort();
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    expect(Object.keys(dictionary).sort(), language).toEqual(keys);
    for (const [key, value] of Object.entries(dictionary)) {
      expect(value.trim(), `${language}: ${key}`).not.toBe('');
      expect(placeholders(value), `${language}: ${key}`).toEqual(placeholders(key));
      expect([/^\s/.test(value), /\s$/.test(value)], `${language}: ${key}`).toEqual([/^\s/.test(key), /\s$/.test(key)]);
    }
  }
});

it('has a translation for every string the interface asks for', () => {
  const untranslated = new Set(['Workday', 'America/St_Johns', 'Workday AI', 'Workday Assistant v0.6', '+30 min']);
  const missing: string[] = [];
  for (const file of sources('src')) for (const match of readFileSync(file, 'utf8').matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
    const key = match[1].replace(/\\'/g, "'").replace(/\\n/g, '\n');
    if (!untranslated.has(key) && !(key in fr)) missing.push(`${file}: ${key}`);
  }
  expect(missing).toEqual([]);
});

it('translates, fills values, and falls back to English', () => {
  expect(t('Add task')).toBe('Add task');
  setLanguage('fr');
  expect(t('Add task')).toBe('Ajouter une tâche');
  expect(t('{done} of {total} done', { done: 1, total: 3 })).toBe('1 sur 3 terminées');
  expect(t('A string nobody translated')).toBe('A string nobody translated');
  // Messages built in the services: provider name, the proposal suffix and a provider detail.
  expect(t('Gemini rejected this key or access policy. Check the key and account permissions in Settings.')).toContain('Gemini a refusé cette clé');
  expect(t('This task is already completed. No task changes were applied.')).toBe('Cette tâche est déjà terminée. Aucune modification de tâche n’a été appliquée.');
  expect(t('You’ve reached your ChatGPT plan’s usage limit. Wait for it to reset, or choose another AI provider in Settings. (usage_limit: weekly)')).toMatch(/^Vous avez atteint.*\(usage_limit: weekly\)$/);
});

it('picks the browser language when it is supported', () => {
  expect(resolveLanguage('auto', 'pt-BR')).toBe('pt'); expect(resolveLanguage('auto', 'ja-JP')).toBe('en');
  expect(resolveLanguage('de', 'fr-FR')).toBe('de'); expect(resolveLanguage(undefined, 'es-MX')).toBe('es');
});
