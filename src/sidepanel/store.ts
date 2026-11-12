import { create } from 'zustand';
import { persist } from 'zustand/middleware';
type Tab = 'Today' | 'AI Chat' | 'Settings';
export const usePreferences = create<{ tab: Tab; theme: 'dark' | 'light'; setTab: (tab: Tab) => void; toggleTheme: () => void }>()(persist((set) => ({ tab: 'Today', theme: 'dark', setTab: tab => set({ tab }), toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })) }), { name: 'workday-preferences' }));
