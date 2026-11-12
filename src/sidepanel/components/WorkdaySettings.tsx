import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { saveSettings } from '../../storage/db';
import type { WorkdaySettings } from '../../shared/settings';
export function WorkdaySettingsForm({ settings, report }: { settings: WorkdaySettings; report: (message: string) => void }) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function field<K extends keyof WorkdaySettings>(key: K, value: WorkdaySettings[K]) { setDraft(s => ({ ...s, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await saveSettings(draft); report('Workday settings saved. Preview your schedule to apply changed constraints.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save settings.'); }
    finally { setBusy(false); }
  }
  return <form className="settings-section settings-form" onSubmit={submit} aria-label="Workday settings">
    <h2>Workday & scheduling</h2>
    <div className="grid grid-cols-2 gap-3"><label>Workday start<input type="time" required value={draft.start} onChange={e => field('start', e.target.value)}/></label><label>Workday end<input type="time" required value={draft.end} onChange={e => field('end', e.target.value)}/></label></div>
    <p className="small muted">An end earlier than the start means an overnight workday. Working days refer to the day your shift starts.</p>
    <label>Timezone<input required value={draft.timeZone} onChange={e => field('timeZone', e.target.value)} placeholder="America/St_Johns"/></label>
    <fieldset><legend>Working days</legend><div className="days">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day,i) => <label key={day}><input type="checkbox" checked={draft.workingDays.includes(i+1)} onChange={e => field('workingDays', e.target.checked ? [...draft.workingDays, i+1].sort() : draft.workingDays.filter(d => d !== i+1))}/>{day}</label>)}</div></fieldset>
    <label className="check-label"><input type="checkbox" checked={draft.lunchEnabled} onChange={e => field('lunchEnabled', e.target.checked)}/> Reserve lunch</label>
    {draft.lunchEnabled && <div className="grid grid-cols-2 gap-3"><label>Lunch starts<input type="time" required value={draft.lunchStart} onChange={e => field('lunchStart', e.target.value)}/></label><label>Lunch · minutes<input type="number" required min={1} max={240} value={draft.lunchMinutes} onChange={e => field('lunchMinutes', e.target.valueAsNumber)}/></label></div>}
    <h3>Additional breaks</h3>{draft.breaks.map((item,i) => <div key={item.id} className="break-editor"><label>Break name<input required maxLength={80} value={item.title} onChange={e => field('breaks', draft.breaks.map((b,j) => j===i ? { ...b, title: e.target.value } : b))}/></label><div className="grid grid-cols-2 gap-3"><label>Break starts<input type="time" required value={item.start} onChange={e => field('breaks', draft.breaks.map((b,j) => j===i ? { ...b, start: e.target.value } : b))}/></label><label>Break · minutes<input type="number" required min={1} max={240} value={item.minutes} onChange={e => field('breaks', draft.breaks.map((b,j) => j===i ? { ...b, minutes: e.target.valueAsNumber } : b))}/></label></div><Button type="button" variant="ghost" aria-label={`Remove ${item.title}`} onClick={() => field('breaks', draft.breaks.filter(b => b.id !== item.id))}><Trash2 size={13}/> Remove break</Button></div>)}
    <Button type="button" variant="outline" disabled={draft.breaks.length >= 12} onClick={() => field('breaks', [...draft.breaks, { id: crypto.randomUUID(), title: 'Short break', start: '15:00', minutes: 15 }])}><Plus size={13}/> Add break</Button>
    <h2 className="section-heading">Reminders & check-ins</h2>
    <label className="check-label"><input type="checkbox" checked={draft.notificationsEnabled} onChange={e => field('notificationsEnabled', e.target.checked)}/> Enable browser notifications</label>
    <p className="small muted">Notifications need Edge running and OS notifications enabled. Missed reminders may be delayed after sleep. Check-ins are also available in this panel.</p>
    {(['taskReminders','meetingReminders','breakReminders','workdayReminders'] as const).map((key,i) => <label className="check-label" key={key}><input type="checkbox" checked={draft[key]} onChange={e => field(key, e.target.checked)}/>{['Task-start reminders','Upcoming meetings','Break reminders','Workday-end reminder'][i]}</label>)}
    <div className="grid grid-cols-2 gap-3"><label>Lead time · minutes<input type="number" required min={0} max={60} value={draft.reminderLeadMinutes} onChange={e => field('reminderLeadMinutes', e.target.valueAsNumber)}/></label><label>Check-in · minutes<input type="number" required min={0} max={240} value={draft.checkInMinutes} onChange={e => field('checkInMinutes', e.target.valueAsNumber)}/></label></div>
    <p className="small muted">Set check-in frequency to 0 to disable periodic check-ins. Scheduled task-end check-ins remain available.</p>
    <label className="check-label"><input type="checkbox" checked={draft.quietEnabled} onChange={e => field('quietEnabled', e.target.checked)}/> Quiet hours for browser notifications</label>
    {draft.quietEnabled && <div className="grid grid-cols-2 gap-3"><label>Quiet hours start<input type="time" required value={draft.quietStart} onChange={e => field('quietStart', e.target.value)}/></label><label>Quiet hours end<input type="time" required value={draft.quietEnd} onChange={e => field('quietEnd', e.target.value)}/></label></div>}
    {error && <p role="alert" className="error">{error}</p>}<Button disabled={busy} className="save-settings">{busy ? 'Saving…' : 'Save workday settings'}</Button>
  </form>;
}
