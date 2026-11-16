import { db } from './storage/db';
import { syncReminders, type ReminderPlatform } from './services/notifications/reminders';
import { completeSignIn, isSignInCallback } from './services/ai/chatgpt-direct';
import { showReminderWindow } from './services/notifications/popup';
import { languages, setLanguage, t, type Language } from './i18n';
const platform: ReminderPlatform = {
  listAlarms: async () => (await chrome.alarms.getAll()).map(a => a.name),
  setAlarm: async (name, when) => { const old = await chrome.alarms.get(name); if (old?.scheduledTime !== when) await chrome.alarms.create(name, { when }); },
  clearAlarm: async name => { await chrome.alarms.clear(name); },
  popup: async (title, message) => { await useSavedLanguage(); const text = translateReminder(title, message); await showReminderWindow(text.title, text.message); },
  // Check-ins stay on screen until dismissed so they are not missed.
  notify: async (id, title, message, sticky) => { await useSavedLanguage(); const text = translateReminder(title, message); await chrome.notifications.create(id, { type: 'basic', iconUrl: 'icon128.png', title: text.title, message: text.message, priority: 2, requireInteraction: !!sticky }); },
};
// Reminder text is produced in English and translated here, in the language chosen in the side panel.
async function useSavedLanguage() {
  try { const saved = (await chrome.storage.local.get('workday.language'))['workday.language']; if (saved in languages) setLanguage(saved as Language); } catch { /* keep English */ }
}
const CHECKIN_HINT = ' — open Workday for Completed, Need more time, Pause or Skip.';
function translateReminder(title: string, message: string) {
  const hinted = message.endsWith(CHECKIN_HINT);
  const body = hinted ? message.slice(0, -CHECKIN_HINT.length) : message;
  return { title: t(title), message: t(body) + (hinted ? t(CHECKIN_HINT) : '') };
}
let queue = Promise.resolve();
function refresh() {
  queue = queue.catch(() => {}).then(() => syncReminders(platform, db)).catch(() => { console.error('Unable to refresh local reminders. Reopen Workday to check your data.'); });
  return queue;
}
async function initialize() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    // Reconstruct alarms on every worker load; do not rely on browser persistence.
    await chrome.alarms.create('workday-maintenance', { periodInMinutes: 1 });
    await refresh();
  } catch { console.error('Unable to initialize Workday.'); }
}
chrome.runtime.onInstalled.addListener(() => { // Built-in ChatGPT sign-in: the login tab is redirected to a loopback address that nothing
// listens on. Replace it with a friendly page, then finish the exchange from its URL.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  const url = change.url;
  if (!url?.startsWith('http://127.0.0.1:')) return;
  void (async () => {
    if (!(await isSignInCallback(url))) return;
    void chrome.tabs.update(tabId, { url: chrome.runtime.getURL('signed-in.html') }).catch(() => {});
    await completeSignIn(url);
  })().catch(() => { console.error('Unable to finish ChatGPT sign-in.'); });
});
void initialize(); });
chrome.runtime.onStartup.addListener(() => { void initialize(); });
chrome.alarms.onAlarm.addListener(() => { void refresh(); });
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== 'WORKDAY_CHANGED') return false;
  void refresh().then(() => reply({ ok: true })); return true;
});
chrome.notifications.onClicked.addListener(() => { void chrome.action.setBadgeText({ text: '•' }); });
chrome.action.onClicked.addListener(() => { void chrome.action.setBadgeText({ text: '' }); });
void initialize();
