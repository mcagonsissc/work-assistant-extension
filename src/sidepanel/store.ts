import { create } from 'zustand';
import { persist } from 'zustand/middleware';
type Tab = 'Today' | 'AI Chat' | 'Settings';
export const usePreferences = create<{ tab: Tab; theme: 'dark' | 'light'; assistantName: string; setAssistantName: (name: string) => void; setTab: (tab: Tab) => void; toggleTheme: () => void }>()(persist((set) => ({ tab: 'AI Chat', theme: 'dark', assistantName: '', setAssistantName: name => set({ assistantName: name.replace(/[\u0000-\u001f<>{}]/g, '').slice(0, 40) }), setTab: tab => set({ tab }), toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })) }), { name: 'workday-preferences', version: 1, migrate: state => ({ ...(state as object), tab: 'AI Chat' as Tab }) }));
