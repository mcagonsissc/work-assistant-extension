/** Shows a reminder as a small browser window. Unlike system notifications, this does not depend on Windows notification settings. */
import { t } from '../../i18n';
export async function showReminderWindow(title: string, message: string) {
  const details = encodeURIComponent(JSON.stringify({ title, message, dismiss: t('Dismiss'), open: t('Open Workday') }));
  await chrome.windows.create({ url: chrome.runtime.getURL(`reminder.html#${details}`), type: 'popup', width: 400, height: 230, focused: true });
}
