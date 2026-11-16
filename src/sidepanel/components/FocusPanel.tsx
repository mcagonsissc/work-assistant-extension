import { Pause, Play, Check, Timer } from 'lucide-react';
import { Button } from '../../components/ui/button';
import type { FocusSession, Task } from '../../shared/models';
import { pauseFocus, startFocus } from '../../services/focus/service';
import { spentSeconds } from '../../services/scheduling/engine';
import { saveTask } from '../../storage/db';
export function duration(seconds: number) { const total = Math.max(0, Math.floor(seconds)); return `${Math.floor(total / 3600) ? `${Math.floor(total / 3600)}:` : ''}${String(Math.floor(total / 60) % 60).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`; }
export function FocusPanel({ tasks, sessions, now, extend, run }: { tasks: Task[]; sessions: FocusSession[]; now: number; extend: (taskId: string) => void; run: (action: () => Promise<unknown>, message: string) => Promise<void> }) {
  const active = sessions.find(s => !s.endedAt);
  const task = tasks.find(t => t.id === active?.taskId) ?? tasks.find(t => t.status === 'paused');
  if (!task) return null;
  const elapsed = spentSeconds(task, sessions, now);
  const running = active?.taskId === task.id;
  const remaining = task.estimatedMinutes * 60 - elapsed;
  return <section className="focus-card" aria-label="Focus timer"><div className="row between"><span className="row"><Timer size={15}/>{running ? 'Focusing now' : 'Focus paused'}</span><span className="timer">{duration(elapsed)}</span></div><h2>{task.title}</h2><p className="small muted">{remaining >= 0 ? `${duration(remaining)} remaining` : `${duration(-remaining)} over estimate`}</p><div className="row wrap"><Button variant="outline" onClick={() => void run(() => running ? pauseFocus(task.id) : startFocus(task.id), running ? 'Focus paused.' : 'Focus resumed.')} >{running ? <Pause size={13}/> : <Play size={13}/>} {running ? 'Pause' : 'Resume'}</Button><Button variant="outline" onClick={() => extend(task.id)}>+30 min</Button><Button onClick={() => void run(() => saveTask({ ...task, status: 'completed' }, task.id), 'Task completed. Preview the plan to reuse the free time.')}><Check size={13}/> Complete</Button></div></section>;
}
export function TaskFocusControl({ task, sessions, run }: { task: Task; sessions: FocusSession[]; run: (action: () => Promise<unknown>, message: string) => Promise<void> }) {
  if (task.status === 'completed' || task.status === 'deferred') return null;
  const active = sessions.some(s => s.taskId === task.id && !s.endedAt);
  return <Button variant="ghost" onClick={() => void run(() => active ? pauseFocus(task.id) : startFocus(task.id), active ? 'Focus paused.' : 'Focus started.')} aria-label={`${active ? 'Pause' : task.status === 'paused' ? 'Resume' : 'Start'} focus: ${task.title}`}>{active ? <Pause size={13}/> : <Play size={13}/>} {active ? 'Pause' : task.status === 'paused' ? 'Resume' : 'Focus'}</Button>;
}
