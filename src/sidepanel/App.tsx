import { getLanguage, languages, t, type LanguageChoice } from '../i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, Check, CheckCheck, ChevronRight, Circle, Download, ListTodo, MessageSquare, Moon, Pencil, Plus, Settings2, Sparkles, StickyNote, Sun, Trash2, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { clearData, db, deleteTask, getSettings, saveTask } from '../storage/db';
import type { Task, TaskInput } from '../shared/models';
import { usePreferences } from './store';
import { defaultSettings } from '../shared/settings';
import { localInput, parseLocalInput, workDate, workWindow } from '../services/scheduling/time';
import { spentSeconds } from '../services/scheduling/engine';
import { WorkdaySettingsForm } from './components/WorkdaySettings';
import { FocusPanel, TaskFocusControl } from './components/FocusPanel';
import { AIChat } from './components/AIChat';
import { AISettings } from './components/AISettings';
import { exportWorkData } from '../storage/export';
import { categorySchema } from '../shared/categories';
import { Planner } from './components/Planner';

// The extension's own version, so Settings always shows the installed release.
const appVersion = globalThis.chrome?.runtime?.getManifest?.().version ?? '';
const blank: TaskInput = { title: '', description: '', priority: 'medium', status: 'todo', estimatedMinutes: 30 };
const labels = { todo: 'To do', in_progress: 'In progress', paused: 'Paused', completed: 'Completed', deferred: 'Deferred' };
function errorText(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }

function TaskForm({ task, close, report, date, zone, allTasks }: { task?: Task; allTasks: Task[]; date: string; zone: string; close: () => void; report: (s: string) => void }) {
  const [value, setValue] = useState<TaskInput>(task ?? { ...blank, scheduledDate: date });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deadlineDraft, setDeadlineDraft] = useState(task?.deadline ? localInput(task.deadline, zone) : '');
  function field<K extends keyof TaskInput>(key: K, val: TaskInput[K]) { setValue(v => ({ ...v, [key]: val })); }
  async function submit(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try { await saveTask({ ...value, deadline: deadlineDraft ? parseLocalInput(deadlineDraft, zone) : undefined }, task?.id); report(task ? 'Task updated.' : 'Task created.'); close(); }
    catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  }
  return <form onSubmit={submit} className="editor" aria-label={task ? t('Edit task') : t('New task')}>
    <div className="row between"><h2>{task ? t('Edit task') : t('New task')}</h2><Button type="button" variant="ghost" onClick={close} aria-label={t('Close task editor')}><X size={16}/></Button></div>
    <label>{t('Task title')}<input autoFocus required maxLength={200} value={value.title} onChange={e => field('title', e.target.value)} placeholder={t('What needs your attention?')}/></label>
    <label>{t('Category')}<select value={value.category ?? 'other'} onChange={e => field('category', e.target.value as TaskInput['category'])}>{categorySchema.options.map(category => <option key={category} value={category}>{t(category)}</option>)}</select></label>
    <label>{t('Description')}<textarea maxLength={5000} value={value.description} onChange={e => field('description', e.target.value)} rows={2}/></label>
    <label>{t('Notes')}<textarea maxLength={5000} value={value.notes ?? ''} onChange={e => field('notes', e.target.value || undefined)} rows={2} placeholder={t('Anything you don’t want to forget')}/></label>
    <div className="grid grid-cols-2 gap-3"><label>{t('Priority')}<select value={value.priority} onChange={e => field('priority', e.target.value as TaskInput['priority'])}><option value="high">{t('High')}</option><option value="medium">{t('Medium')}</option><option value="low">{t('Low')}</option></select></label><label>{t('Estimate · minutes')}<input type="number" min={1} max={1440} required value={value.estimatedMinutes} onChange={e => field('estimatedMinutes', e.target.valueAsNumber)}/></label></div>
    <div className="grid grid-cols-2 gap-3"><label>{t('Scheduled date')}<input type="date" value={value.scheduledDate ?? ''} onChange={e => field('scheduledDate', e.target.value || undefined)}/></label><label>{t('Status')}<select value={value.status} onChange={e => field('status', e.target.value as TaskInput['status'])}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label></div>
    <label>{t('Deadline ({zone})', { zone })}<input type="datetime-local" value={deadlineDraft} onChange={e => setDeadlineDraft(e.target.value)}/></label>
    {(allTasks.some(t => t.id !== task?.id) || !!value.dependencyIds?.length) && <fieldset><legend>{t('Dependencies (optional)')}</legend>{allTasks.filter(t => t.id !== task?.id).map(t => <label className="check-label" key={t.id}><input type="checkbox" checked={value.dependencyIds?.includes(t.id) ?? false} onChange={e => field('dependencyIds', e.target.checked ? [...(value.dependencyIds ?? []), t.id] : value.dependencyIds?.filter(id => id !== t.id))}/>{t.title}</label>)}{value.dependencyIds?.filter(id => !allTasks.some(t => t.id === id)).map(id => <label className="check-label" key={id}><input type="checkbox" checked onChange={() => field('dependencyIds', value.dependencyIds?.filter(d => d !== id))}/>{t('Missing prerequisite ({id}) — uncheck to remove', { id: id.slice(0,8) })}</label>)}</fieldset>}
    {error && <p role="alert" className="error">{t(error)}</p>}<div className="row justify-end"><Button type="button" variant="outline" onClick={close}>{t('Cancel')}</Button><Button disabled={saving}>{saving ? t('Saving…') : t('Save task')}</Button></div>
  </form>;
}

export default function App() {
  const { tab, setTab, theme, toggleTheme, language, setLanguageChoice } = usePreferences();
  const [storageError, setStorageError] = useState('');
  const tasks = useLiveQuery(async () => { try { const result = await db.tasks.orderBy('createdAt').toArray(); setStorageError(''); return result; } catch (err) { setStorageError(errorText(err)); return []; } }, []);
  const [editor, setEditor] = useState<Task | 'new' | null>(null);
  const [filter, setFilter] = useState<'today' | 'all' | 'completed'>('today');
  const [message, setMessage] = useState('');
  const [chatSeed,setChatSeed] = useState<string|null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [now, setNow] = useState(new Date());
  const settings = useLiveQuery(() => getSettings(), []) ?? defaultSettings();
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];
  const [extensionRequest, setExtensionRequest] = useState<{ taskId: string; key: number } | null>(null);
  function extend(taskId: string) { setExtensionRequest({ taskId, key: Date.now() }); }
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  const today = workDate(now.getTime(), settings);
  const window = workWindow(today, settings);
  const daily = (tasks ?? []).filter(t => t.scheduledDate === today);
  const completed = daily.filter(t => t.status === 'completed').length;
  const remaining = daily.filter(t => t.status !== 'completed' && t.status !== 'deferred').reduce((sum, t) => sum + Math.max(0, t.estimatedMinutes - spentSeconds(t, sessions, now.getTime()) / 60), 0);
  const visible = (tasks ?? []).filter(t => filter === 'all' || (filter === 'completed' ? t.status === 'completed' : t.scheduledDate === today));
  async function run(action: () => Promise<unknown>, success: string) { try { await action(); setMessage(success); } catch (err) { setMessage(errorText(err)); } }
  async function exportData() {
    try {
      const data = await exportWorkData();
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `workday-${today}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage(t('Local data exported.'));
    } catch (err) { setMessage(errorText(err)); }
  }
  return <div className={`app${tab === 'AI Chat' ? ' chat-mode' : ''}`}>
    <header className="row between"><div className="row"><div className="brand"><Sparkles size={16}/></div><strong>{t('Workday')}</strong></div><Button variant="ghost" onClick={toggleTheme} aria-label={t(theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme')}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</Button></header>
    <nav aria-label={t('Main navigation')}>{(['AI Chat', 'Today', 'Settings'] as const).map((name, i) => { const Icon = [MessageSquare, CalendarDays, Settings2][i]; return <button key={name} aria-current={tab === name ? 'page' : undefined} onClick={() => { setTab(name); if (name === 'AI Chat') setMessage(''); }}><Icon size={15}/>{t(name)}</button>; })}</nav>
    <main>
      {storageError && <div className="error" role="alert">{t('Local storage unavailable: {error}. Reload the panel to retry.', { error: t(storageError) })}</div>}
      {message && <div className="notice row between" role="status"><span>{t(message)}</span><Button variant="ghost" aria-label={t('Dismiss message')} onClick={() => setMessage('')}><X size={14}/></Button></div>}
      {tab === 'Today' && <>
        <div className="row between section-heading"><div><h1>{new Date(`${today}T12:00:00Z`).toLocaleDateString(getLanguage(), { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })}</h1><p className="small muted">{!window.working ? t('Day off') : now.getTime() < window.start ? t('Before work') : now.getTime() >= window.end ? t('Workday ended') : t('Workday in progress')} · {settings.timeZone}</p></div></div>
        <section className="progress-card" aria-label={t('Daily task progress')}><div className="row between"><strong className="row"><CheckCheck size={16}/> {t('{done} of {total} done', { done: completed, total: daily.length })}</strong><span className="muted small">{t('{minutes} min left', { minutes: Math.ceil(remaining) })}</span></div><progress max={daily.length || 1} value={completed} aria-label={t('{done} of {total} tasks completed', { done: completed, total: daily.length })}/></section>
        <FocusPanel tasks={tasks ?? []} sessions={sessions} now={now.getTime()} extend={extend} run={run}/><Planner consumeExtension={() => setExtensionRequest(null)} report={setMessage} now={now.getTime()} extensionRequest={extensionRequest}/>
        <div className="row between section-heading"><h2>{t('Tasks')}{' '}<span className="count">{visible.length}</span></h2><Button onClick={() => { setEditor('new'); setDeleteId(null); }}><Plus size={15}/>{' '}{t('Add task')}</Button></div>
        <div className="filters" aria-label={t('Filter tasks')}>{(['today', 'all', 'completed'] as const).map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'today' ? t('Today') : f === 'all' ? t('All tasks') : t('Completed')}</button>)}</div>
        {editor && <TaskForm allTasks={tasks ?? []} date={today} zone={settings.timeZone} key={editor === 'new' ? 'new' : editor.id} task={editor === 'new' ? undefined : editor} close={() => setEditor(null)} report={setMessage}/>}
        {tasks === undefined ? <p role="status">{t('Loading local tasks…')}</p> : visible.length === 0 ? <section className="empty"><div className="empty-icon"><ListTodo size={26}/></div><h2>{filter === 'completed' ? t('Your wins will appear here') : t('Make room for your best work')}</h2><p>{filter === 'today' ? t('Add your first task for today. Keep it small, give it an estimate, and take it from there.') : t('Create a task to get started.')}</p><Button variant="outline" onClick={() => setEditor('new')}><Plus size={15}/>{' '}{t('Create a task')}</Button></section> : <div className="task-list">{visible.map(task => <article className={`task ${task.status === 'completed' ? 'done' : ''}`} key={task.id}>
          <button className="complete-control" aria-label={`${task.status === 'completed' ? t('Reopen') : t('Complete')} ${task.title}`} onClick={() => void run(() => saveTask({ ...task, status: task.status === 'completed' ? 'todo' : 'completed' }, task.id), task.status === 'completed' ? t('Task reopened.') : t('Task completed.'))} disabled={!!storageError}>{task.status === 'completed' ? <Check size={18}/> : <Circle size={18}/>}</button>
          <div className="task-body"><div className="row between"><h3>{task.title}</h3><span className={`priority ${task.priority}`}>{t(task.priority)}</span></div>{task.description && <p className="description">{task.description}</p>}{task.notes && <p className="task-notes"><StickyNote size={13} aria-hidden="true"/><span>{task.notes}</span></p>}<p className="metadata">{task.estimatedMinutes}{' '}{t('min')}{' '}<span>·</span> {t(labels[task.status])}{task.scheduledDate && <> <span>·</span> {task.scheduledDate === today ? t('Today') : task.scheduledDate}</>}</p>{task.deadline && <p className="metadata">{t('Due')}{' '}{new Date(task.deadline).toLocaleString(getLanguage(), { timeZone: settings.timeZone })}</p>}
          <div className="row task-actions wrap"><TaskFocusControl task={task} sessions={sessions} run={run}/><Button variant="ghost" onClick={() => { setEditor(task); setDeleteId(null); }}><Pencil size={13}/>{' '}{t('Edit')}</Button>{task.status !== 'deferred' && task.status !== 'completed' && <Button variant="ghost" onClick={() => void run(() => saveTask({ ...task, status: 'deferred' }, task.id), t('Task deferred.'))}><ChevronRight size={13}/>{' '}{t('Defer')}</Button>}<Button variant="ghost" aria-label={`${t('Delete')} ${task.title}`} onClick={() => setDeleteId(task.id)}><Trash2 size={13}/></Button></div>
          {deleteId === task.id && <div className="confirm"><p>{t('Delete this task and its work records?')}</p><div className="row"><Button variant="destructive" onClick={() => void run(async () => { await deleteTask(task.id); setDeleteId(null); if (editor !== 'new' && editor?.id === task.id) setEditor(null); }, t('Task deleted.'))}>{t('Delete task')}</Button><Button variant="outline" onClick={() => setDeleteId(null)}>{t('Cancel')}</Button></div></div>}</div>
        </article>)}</div>}
        <Button variant="outline" className="ask-ai" onClick={() => { setChatSeed(t('Help me adjust my remaining schedule for today.')); setMessage(''); setTab('AI Chat'); }}><Sparkles size={13}/>{' '}{t('Ask AI to adjust my day')}</Button>
      </>}
      {tab === 'AI Chat' && <AIChat date={today} seed={chatSeed} consumeSeed={() => setChatSeed(null)} openSettings={() => setTab('Settings')} showToday={() => setTab('Today')}/>}
      {tab === 'Settings' && <><h1 className="section-heading">{t('Settings')}</h1><AISettings report={setMessage}/><WorkdaySettingsForm key={JSON.stringify(settings)} settings={settings} report={setMessage}/><section className="settings-section"><h2>{t('Appearance')}</h2><div className="row between"><p>{t('Color theme')}</p><Button variant="outline" onClick={toggleTheme}>{theme === 'dark' ? <Moon size={14}/> : <Sun size={14}/>} {t(theme)}</Button></div></section><section className="settings-section"><h2>{t('Language')}</h2><label htmlFor="language" className="provider-picker">{t('Display language')}</label><select id="language" value={language} onChange={e => setLanguageChoice(e.target.value as LanguageChoice)}><option value="auto">{t('Same as browser')}</option>{Object.entries(languages).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select><p className="small muted">{t('The assistant also replies in this language.')}</p></section><section className="settings-section"><h2>{t('Your data')}</h2><p className="muted small">{t('Everything is saved in this browser on this device and works offline. Uninstalling the extension or clearing browser data removes it.')}</p><Button variant="outline" onClick={() => void exportData()}><Download size={15}/>{' '}{t('Export local data')}</Button><p className="small muted">{t('Exports contain tasks and work records, never keys or sign-ins.')}</p>{!confirmClear ? <Button variant="destructive" onClick={() => setConfirmClear(true)}><Trash2 size={15}/>{' '}{t('Delete all local data')}</Button> : <div className="confirm"><p>{t('Permanently delete all tasks, work records, chats and AI settings, and sign out of ChatGPT? Export a backup first if you need one.')}</p><div className="row"><Button variant="destructive" onClick={() => void run(async () => { await clearData(); setConfirmClear(false); setEditor(null); }, t('All task and work records deleted.'))}>{t('Delete permanently')}</Button><Button variant="outline" onClick={() => setConfirmClear(false)}>{t('Cancel')}</Button></div></div>}</section><p className="small muted version">Workday Assistant v{appVersion}</p></>}
    </main>
  </div>;
}
