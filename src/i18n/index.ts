// Translations use the English text as the key, so English needs no dictionary and a missing
// translation falls back to readable English instead of a blank.
import fr from './fr.json';
import es from './es.json';
import de from './de.json';
import pt from './pt.json';

export const languages = { en: 'English', fr: 'Français', es: 'Español', de: 'Deutsch', pt: 'Português' } as const;
export type Language = keyof typeof languages;
export type LanguageChoice = Language | 'auto';
const dictionaries: Record<Exclude<Language, 'en'>, Record<string, string>> = { fr, es, de, pt };
const providers = ['ChatGPT plan', 'OpenRouter', 'OpenAI', 'Gemini', 'Claude', 'ChatGPT'];

export function resolveLanguage(choice: LanguageChoice | undefined, browser = globalThis.navigator?.language ?? 'en'): Language {
  if (choice && choice !== 'auto' && choice in languages) return choice;
  const code = browser.toLowerCase().split('-')[0];
  return code in languages ? code as Language : 'en';
}
let current: Language = 'en';
export function setLanguage(language: Language) { current = language; if (globalThis.document) document.documentElement.lang = language; }
export function getLanguage() { return current; }

/** Translates English `text` into the current language. `{name}` placeholders are filled from `values`. */
export function t(text: string, values?: Record<string, string | number>): string {
  const dictionary = current === 'en' ? undefined : dictionaries[current];
  let result = dictionary?.[text];
  if (result === undefined && dictionary) {
    // Messages built in the services name a provider; look them up with the name taken out.
    for (const provider of providers) {
      if (!text.includes(provider)) continue;
      const found = dictionary[text.split(provider).join('{provider}')];
      if (found !== undefined) { result = found.split('{provider}').join(provider); break; }
    }
  }
  if (result === undefined && dictionary) {
    // "<message> No task changes were applied." and "<message> (detail from the provider)".
    const suffix = ' No task changes were applied.', detail = /^(.*\S)( \([^()]*\))$/s.exec(text);
    if (text.endsWith(suffix) && text.length > suffix.length) result = `${t(text.slice(0, -suffix.length))} ${t(suffix.trim())}`;
    else if (detail) { const head = t(detail[1]); if (head !== detail[1]) result = head + detail[2]; }
  }
  result ??= text;
  if (values) for (const [name, value] of Object.entries(values)) result = result.split(`{${name}}`).join(String(value));
  return result;
}
