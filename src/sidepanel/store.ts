import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { resolveLanguage, setLanguage, type LanguageChoice } from '../i18n';
// The background worker cannot read this store, so the resolved language is mirrored to extension storage for reminders.
function applyLanguage(choice?: LanguageChoice) {
  const language = resolveLanguage(choice); setLanguage(language);
  try { void globalThis.chrome?.storage?.local?.set({ 'workday.language': language }); } catch { /* preview without extension APIs */ }
}
applyLanguage();
type Tab = 'Today' | 'AI Chat' | 'Settings';
export const usePreferences = create<{ tab: Tab; theme: 'dark' | 'light'; assistantName: string; setAssistantName: (name: string) => void; language: LanguageChoice; setLanguageChoice: (language: LanguageChoice) => void; setTab: (tab: Tab) => void; toggleTheme: () => void }>()(persist((set) => ({ tab: 'AI Chat', theme: 'dark', language: 'auto', setLanguageChoice: language => { applyLanguage(language); set({ language }); }, assistantName: '', setAssistantName: name => set({ assistantName: name.replace(/[\u0000-\u001f<>{}]/g, '').slice(0, 40) }), setTab: tab => set({ tab }), toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })) }), { name: 'workday-preferences', version: 1, migrate: state => ({ ...(state as object), tab: 'AI Chat' as Tab }), onRehydrateStorage: () => state => applyLanguage(state?.language) }));
