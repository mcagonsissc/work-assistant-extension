import { t } from '../../i18n';
import { useState, type FormEvent } from 'react';
import { BellRing, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { saveSettings } from '../../storage/db';
import { showReminderWindow } from '../../services/notifications/popup';
import type { WorkdaySettings } from '../../shared/settings';
export function WorkdaySettingsForm({ settings, report }: { settings: WorkdaySettings; report: (message: string) => void }) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState('');
  async function testNotification() {
    if (!globalThis.chrome?.windows || !chrome.notifications) { setTestResult(t('Reminders only pop up in the installed extension.')); return; }
    const title = t('Workday reminders are on'), message = t('Reminders and check-ins will appear like this.');
    try {
      if (draft.popupReminders !== false) { await showReminderWindow(title, message); setTestResult(t('A reminder window should have opened.')); }
      else {
        await chrome.notifications.create(`wd:test:${Date.now()}`, { type: 'basic', iconUrl: 'icon128.png', title, message, priority: 2 });
        setTestResult(t('Sent to Windows. If nothing appeared, Windows is blocking notifications from Microsoft Edge (Settings → System → Notifications, or Do not disturb). Switch on “Pop up in a browser window” above to avoid that.'));
      }
    } catch { setTestResult(t('The reminder could not be shown. Try the other reminder style.')); }
  }
  function field<K extends keyof WorkdaySettings>(key: K, value: WorkdaySettings[K]) { setDraft(s => ({ ...s, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await saveSettings(draft); report(t('Workday settings saved. Preview your schedule to apply changed constraints.')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save settings.'); }
    finally { setBusy(false); }
  }
  return <form className="settings-section settings-form" onSubmit={submit} aria-label={t('Workday settings')}>
    <h2>{t('Workday')}</h2>
    <div className="grid grid-cols-2 gap-3"><label>{t('Workday start')}<input type="time" required value={draft.start} onChange={e => field('start', e.target.value)}/></label><label>{t('Workday end')}<input type="time" required value={draft.end} onChange={e => field('end', e.target.value)}/></label></div>
    <p className="small muted">{t('An end time before the start means an overnight shift.')}</p>
    <label>{t('Timezone')}<input required value={draft.timeZone} onChange={e => field('timeZone', e.target.value)} placeholder={t('America/St_Johns')}/></label>
    <fieldset><legend>{t('Working days')}</legend><div className="days">{[t('Mon'),t('Tue'),t('Wed'),t('Thu'),t('Fri'),t('Sat'),t('Sun')].map((day,i) => <label key={day}><input type="checkbox" checked={draft.workingDays.includes(i+1)} onChange={e => field('workingDays', e.target.checked ? [...draft.workingDays, i+1].sort() : draft.workingDays.filter(d => d !== i+1))}/>{day}</label>)}</div></fieldset>
    <label className="check-label"><input type="checkbox" checked={draft.lunchEnabled} onChange={e => field('lunchEnabled', e.target.checked)}/>{' '}{t('Reserve lunch')}</label>
    {draft.lunchEnabled && <div className="grid grid-cols-2 gap-3"><label>{t('Lunch starts')}<input type="time" required value={draft.lunchStart} onChange={e => field('lunchStart', e.target.value)}/></label><label>{t('Lunch · minutes')}<input type="number" required min={1} max={240} value={draft.lunchMinutes} onChange={e => field('lunchMinutes', e.target.valueAsNumber)}/></label></div>}
    <h3>{t('Additional breaks')}</h3>{draft.breaks.map((item,i) => <div key={item.id} className="break-editor"><label>{t('Break name')}<input required maxLength={80} value={item.title} onChange={e => field('breaks', draft.breaks.map((b,j) => j===i ? { ...b, title: e.target.value } : b))}/></label><div className="grid grid-cols-2 gap-3"><label>{t('Break starts')}<input type="time" required value={item.start} onChange={e => field('breaks', draft.breaks.map((b,j) => j===i ? { ...b, start: e.target.value } : b))}/></label><label>{t('Break · minutes')}<input type="number" required min={1} max={240} value={item.minutes} onChange={e => field('breaks', draft.breaks.map((b,j) => j===i ? { ...b, minutes: e.target.valueAsNumber } : b))}/></label></div><Button type="button" variant="ghost" aria-label={`${t('Remove')} ${item.title}`} onClick={() => field('breaks', draft.breaks.filter(b => b.id !== item.id))}><Trash2 size={13}/>{' '}{t('Remove break')}</Button></div>)}
    <Button type="button" variant="outline" disabled={draft.breaks.length >= 12} onClick={() => field('breaks', [...draft.breaks, { id: crypto.randomUUID(), title: t('Short break'), start: '15:00', minutes: 15 }])}><Plus size={13}/>{' '}{t('Add break')}</Button>
    <h2 className="subheading">{t('Reminders')}</h2>
    <label className="check-label"><input type="checkbox" checked={draft.notificationsEnabled} onChange={e => field('notificationsEnabled', e.target.checked)}/>{' '}{t('Pop up reminders and check-ins')}</label>
    <label className="check-label"><input type="checkbox" checked={draft.popupReminders !== false} disabled={!draft.notificationsEnabled} onChange={e => field('popupReminders', e.target.checked)}/>{' '}{t('Pop up in a browser window (works even when Windows notifications are off)')}</label>
    <p className="small muted">{t('Reminders appear while Edge is running, even with this panel closed. Untick the second box to use Windows system notifications instead. Save after changing these.')}</p>
    <Button type="button" variant="outline" onClick={() => void testNotification()}><BellRing size={13}/>{' '}{t('Send a test reminder')}</Button>
    {testResult && <p className="small muted" role="status">{testResult}</p>}
    {(['taskReminders','meetingReminders','breakReminders','workdayReminders'] as const).map((key,i) => <label className="check-label" key={key}><input type="checkbox" checked={draft[key]} onChange={e => field(key, e.target.checked)}/>{[t('Task-start reminders'),t('Upcoming meetings'),t('Break reminders'),t('Workday-end reminder')][i]}</label>)}
    <div className="grid grid-cols-2 gap-3"><label>{t('Lead time · minutes')}<input type="number" required min={0} max={60} value={draft.reminderLeadMinutes} onChange={e => field('reminderLeadMinutes', e.target.valueAsNumber)}/></label><label>{t('Check-in · minutes')}<input type="number" required min={0} max={240} value={draft.checkInMinutes} onChange={e => field('checkInMinutes', e.target.valueAsNumber)}/></label></div>
    <p className="small muted">{t('Set check-in to 0 to turn off periodic check-ins.')}</p>
    <label className="check-label"><input type="checkbox" checked={draft.quietEnabled} onChange={e => field('quietEnabled', e.target.checked)}/>{' '}{t('Quiet hours for notifications')}</label>
    {draft.quietEnabled && <div className="grid grid-cols-2 gap-3"><label>{t('Quiet hours start')}<input type="time" required value={draft.quietStart} onChange={e => field('quietStart', e.target.value)}/></label><label>{t('Quiet hours end')}<input type="time" required value={draft.quietEnd} onChange={e => field('quietEnd', e.target.value)}/></label></div>}
    {error && <p role="alert" className="error">{t(error)}</p>}<Button disabled={busy} className="save-settings">{busy ? t('Saving…') : t('Save workday settings')}</Button>
  </form>;
}
