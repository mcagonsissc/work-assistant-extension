import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarPlus, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { db, getSettings, saveTask } from '../../storage/db';
import type { CalendarEvent, Reminder, ScheduledBlock } from '../../shared/models';
import { defaultSettings, type WorkdaySettings } from '../../shared/settings';
import { approvePlan, deleteMeeting, planFingerprint, previewPlan, saveMeeting, taskName, type PlanProposal } from '../../services/scheduling/service';
import { addDays, dateInZone, formatTime, iso, localInput, parseLocalInput, workDate, workWindow } from '../../services/scheduling/time';
import { buildReminders, dismissCheckIn } from '../../services/notifications/reminders';
import { pauseFocus } from '../../services/focus/service';
export function MeetingForm({ date, settings, event, close, saved }: { date: string; settings: WorkdaySettings; event?: CalendarEvent; close: () => void; saved: () => Promise<void> }) {
  const window = workWindow(date, settings);
  const [title, setTitle] = useState(event?.title ?? '');
  const [start, setStart] = useState(event ? localInput(event.start, settings.timeZone) : localInput(iso(window.start), settings.timeZone));
  const [end, setEnd] = useState(event ? localInput(event.end, settings.timeZone) : localInput(iso(window.start + 30 * 60000), settings.timeZone));
  const [error, setError] = useState(''); const [busy,setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await saveMeeting({ title, start: parseLocalInput(start, settings.timeZone), end: parseLocalInput(end, settings.timeZone), timeZone: settings.timeZone }, event?.id); await saved(); close(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save meeting.'); } finally { setBusy(false); }
  }
  return <form className="editor" onSubmit={submit} aria-label="Meeting editor"><div className="row between"><h2>{event ? 'Edit meeting' : 'New meeting'}</h2><Button type="button" variant="ghost" onClick={close} aria-label="Close meeting editor"><X size={14}/></Button></div><p className="small muted">Times in {settings.timeZone}</p><label>Meeting title<input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)}/></label><label>Meeting starts<input type="datetime-local" required value={start} onChange={e => setStart(e.target.value)}/></label><label>Meeting ends<input type="datetime-local" required value={end} onChange={e => setEnd(e.target.value)}/></label>{error && <p role="alert" className="error">{error}</p>}<Button disabled={busy}>{busy ? 'Saving…' : 'Save meeting'}</Button></form>;
}
export function Planner({ report, now, extensionRequest, consumeExtension }: { consumeExtension: () => void; report: (message: string) => void; now: number; extensionRequest: { taskId: string; key: number } | null }) {
  const state = useLiveQuery(async () => db.transaction('r', db.tables, async () => ({ settings: await getSettings(), tasks: await db.tasks.toArray(), events: await db.events.toArray(), existing: await db.blocks.toArray(), sessions: await db.sessions.toArray(), plans: await db.plans.toArray(), reminders: await db.reminders.toArray() })), []);
  const settings = state?.settings ?? defaultSettings();
  const [selectedDate,setDate] = useState<string | null>(null);
  const date = selectedDate ?? workDate(now,settings);
  const [proposal,setProposal] = useState<PlanProposal | null>(null);
  const [meeting,setMeeting] = useState<CalendarEvent | 'new' | null>(null);
  const [deleteId,setDeleteId] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function preview(extension?: { taskId: string; minutes: number }) {
    setError(''); setBusy(true);
    try { const targetDate = extension ? state?.tasks.find(t => t.id === extension.taskId)?.scheduledDate ?? date : date; if (targetDate !== date) setDate(targetDate); setProposal(await previewPlan(targetDate, extension)); return true; } catch(e) { setError(e instanceof Error ? e.message : 'Unable to plan the day.'); return false; } finally { setBusy(false); }
  }
  useEffect(() => { if (extensionRequest) { void preview({ taskId: extensionRequest.taskId, minutes: 30 }); consumeExtension(); } }, [extensionRequest]); // User action opens a proposal; no storage mutation.
  if (!state) return <p className="muted small" role="status">Loading your schedule…</p>;
  const plan = state.plans.find(p => p.date === date);
  const stale = !!plan && plan.signature !== planFingerprint(state);
  const window = workWindow(date,settings);
  const events = state.events.filter(e => dateInZone(Date.parse(e.start),settings.timeZone) === date || (e.end > iso(window.start) && e.start < iso(window.end))).sort((a,b) => a.start.localeCompare(b.start));
  const savedBlocks = state.existing.filter(b => b.planDate === date).sort((a,b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
  const blocks = proposal?.result.blocks ?? savedBlocks;
  const overflow = proposal?.result.overflow ?? plan?.overflow ?? [];
  const warnings = proposal?.result.warnings ?? plan?.warnings ?? [];
  const next = state.events.filter(e => e.busy && Date.parse(e.end) > now).sort((a,b) => a.start.localeCompare(b.start))[0];
  const computed = buildReminders({ ...state, blocks: state.existing }, now);
  const checkins = [...state.reminders, ...computed.filter(r => !state.reminders.some(s => s.id === r.id))].filter(r => r.kind === 'checkin' && !r.handledAt && Date.parse(r.at) <= now && Date.parse(r.expiresAt) > now && state.tasks.some(t => t.id === r.taskId && !['completed','deferred'].includes(t.status)) && (!r.sessionId || state.sessions.some(s => s.id === r.sessionId && !s.endedAt))).sort((a,b) => b.at.localeCompare(a.at));
  const checkin = checkins[0];
  async function checkInAction(reminder: Reminder, action: 'completed' | 'extend' | 'pause' | 'skip') {
    try {
      const task = state!.tasks.find(t => t.id === reminder.taskId); if (!task) return;
      // Browser preview has no worker; persist the generated reminder before handling it.
      if (!state!.reminders.some(r => r.id === reminder.id)) await db.reminders.put(reminder);
      if (action === 'extend') { if (!(await preview({ taskId: task.id, minutes: 30 }))) return; }
      else if (action === 'pause') await pauseFocus(task.id);
      else await saveTask({ ...task, status: action === 'completed' ? 'completed' : 'deferred' }, task.id);
      // Resolve all due check-ins for this task together, including simultaneous block/session prompts.
      for (const r of checkins.filter(r => r.taskId === task.id)) { if (!state!.reminders.some(s => s.id === r.id)) await db.reminders.put(r); await dismissCheckIn(r.id); }
      report(action === 'extend' ? 'Review the extended estimate and updated plan below.' : 'Check-in saved. Preview the plan to adjust remaining work.');
    } catch(e) { setError(e instanceof Error ? e.message : 'Unable to save check-in.'); }
  }
  async function accept() { if (!proposal) return; setBusy(true); setError(''); try { await approvePlan(proposal); setProposal(null); report('Plan approved and saved.'); } catch(e) { setError(e instanceof Error ? e.message : 'Unable to approve plan.'); } finally { setBusy(false); } }
  return <section className="planner" aria-label="Day planner">
    {next && <div className="info upcoming-meeting"><strong>{Date.parse(next.start) <= now ? 'Meeting now' : 'Next meeting'}</strong><span>{next.title} · {formatTime(next.start,settings.timeZone)}</span></div>}
    {checkin && <div className="checkin"><h2>How is this task going?</h2><p>{taskName(state.tasks,checkin.taskId)}</p><div className="row wrap"><Button onClick={() => void checkInAction(checkin,'completed')}>Completed</Button><Button variant="outline" onClick={() => void checkInAction(checkin,'extend')}>Need more time (+30m)</Button><Button variant="outline" onClick={() => void checkInAction(checkin,'pause')}>Pause</Button><Button variant="ghost" onClick={() => void checkInAction(checkin,'skip')}>Skip for now</Button></div></div>}
    <div className="row between section-heading"><h2>Daily timeline</h2><Button variant="outline" disabled={busy} onClick={() => void preview()}>{busy ? 'Planning…' : 'Preview plan'}</Button></div>
    <label className="plan-date">Plan date<input type="date" required value={date} onChange={e => { if (e.target.value) { setDate(e.target.value); setProposal(null); setMeeting(null); } }}/></label><p className="small muted">{settings.timeZone} · {settings.start}–{settings.end}{settings.end < settings.start ? ' (next day)' : ''}</p>
    {stale && !proposal && <div className="info">Tasks or constraints changed. Preview and approve an updated plan before following this timeline.</div>}
    {error && <p role="alert" className="error">{error}</p>}
    {proposal && <div className="plan-approval"><h3>Review your proposed plan</h3><p className="small muted">{proposal.extension ? 'Includes 30 more minutes for the selected task. ' : ''}No changes are saved until approval. Preview expires in 60 seconds.</p><div className="row"><Button disabled={busy} onClick={() => void accept()}>Approve plan</Button><Button variant="outline" onClick={() => setProposal(null)}>Reject plan</Button></div></div>}
    {warnings.map(w => <p className="warning small" key={w}>{w}</p>)}
    {blocks.length ? <ol className="timeline" aria-label={proposal ? 'Proposed schedule' : 'Approved schedule'}>{blocks.map(block => <TimelineEntry key={block.id} block={block} zone={settings.timeZone} title={block.taskId ? taskName(state.tasks,block.taskId) : block.title ?? 'Commitment'} status={block.taskId ? state.tasks.find(t => t.id === block.taskId)?.status : undefined} now={now}/>)}</ol> : <p className="small muted">No saved schedule for this day. Preview a plan to arrange tasks around meetings and breaks.</p>}
    {overflow.length > 0 && <div className="overflow"><h3>Doesn’t fit in this workday</h3>{overflow.map(item => <p key={item.taskId}><strong>{taskName(state.tasks,item.taskId)}</strong> · {Math.ceil(item.remainingMinutes)} min<br/><span className="muted small">{item.reason}</span></p>)}<p className="small muted">Reduce scope, change constraints, or edit a task’s scheduled date to {addDays(date,1)}. Nothing is silently scheduled after hours.</p></div>}
    <div className="row between section-heading"><h2>Manual meetings</h2><Button variant="outline" onClick={() => setMeeting('new')}><CalendarPlus size={14}/> Add meeting</Button></div>
    {meeting && <MeetingForm key={meeting === 'new' ? 'new' : meeting.id} date={date} settings={settings} event={meeting === 'new' ? undefined : meeting} close={() => setMeeting(null)} saved={async () => { await preview(); report('Meeting saved. Review the updated plan.'); }}/>} 
    {events.length === 0 && <p className="small muted">No meetings for this day.</p>}
    {events.map(event => <div className="meeting-item" key={event.id}><div className="row between"><div><strong>{event.title}</strong><p className="small muted">{formatTime(event.start,settings.timeZone)}–{formatTime(event.end,settings.timeZone)}</p></div><div className="row"><Button variant="ghost" aria-label={`Edit meeting ${event.title}`} onClick={() => setMeeting(event)}><Pencil size={13}/></Button><Button variant="ghost" aria-label={`Delete meeting ${event.title}`} onClick={() => setDeleteId(event.id)}><Trash2 size={13}/></Button></div></div>{deleteId === event.id && <div className="confirm"><p>Delete this meeting?</p><div className="row"><Button variant="destructive" onClick={async () => { try { await deleteMeeting(event.id); setDeleteId(null); await preview(); report('Meeting deleted. Review the updated plan.'); } catch(e) { setError(String(e)); } }}>Delete meeting</Button><Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button></div></div>}</div>)}
    {state.reminders.some(r => r.deliveryError && !r.handledAt && Date.parse(r.expiresAt) > now) && <p className="error small">Browser notifications could not be delivered. Check Edge and OS permissions; your schedule and check-ins remain available here.</p>}
  </section>;
}
function TimelineEntry({ block, zone, title, status, now }: { block: ScheduledBlock; zone: string; title: string; status?: string; now: number }) {
  const current = now >= Date.parse(block.start) && now < Date.parse(block.end);
  return <li className={`timeline-entry ${block.kind} ${current ? 'current' : ''}`}><div className="timeline-time">{formatTime(block.start,zone)}<span>{formatTime(block.end,zone)}</span></div><div><strong>{title}</strong><p>{Math.round((Date.parse(block.end) - Date.parse(block.start))/60000)} min · {block.kind}{status ? ` · ${status.replace('_',' ')}` : ''}{current ? ' · now' : ''}</p></div></li>;
}
