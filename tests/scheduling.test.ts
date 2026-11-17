import { describe, expect, it } from 'vitest';
import { scheduleDay, timelineBlocks, type ScheduleInput } from '../src/services/scheduling/engine';
import { defaultSettings } from '../src/shared/settings';
import { addDays, parseLocalInput, workDate, workWindow, zonedTime } from '../src/services/scheduling/time';
import type { CalendarEvent, ScheduledBlock, Task } from '../src/shared/models';
const date = '2026-11-12';
const settings = { ...defaultSettings(), timeZone: 'UTC', lunchEnabled: false };
const instant = (time: string) => `${date}T${time}:00.000Z`;
const ms = (time: string) => Date.parse(instant(time));
function task(id: string, minutes = 60, patch: Partial<Task> = {}): Task { return { id, title: id, description: '', priority: 'medium', status: 'todo', estimatedMinutes: minutes, actualSeconds: 0, createdAt: instant('08:00'), updatedAt: instant('08:00'), source: 'manual', dependencyIds: [], scheduledDate: date, ...patch }; }
function event(id: string, start: string, end: string): CalendarEvent { return { id, title: id, source: 'manual', start: instant(start), end: instant(end), timeZone: 'UTC', busy: true }; }
function plan(patch: Partial<ScheduleInput> = {}) { return scheduleDay({ date, settings, tasks: [], events: [], existing: [], sessions: [], now: ms('08:00'), ...patch }); }
function minutes(blocks: ScheduledBlock[]) { return blocks.reduce((sum,b) => sum + (Date.parse(b.end) - Date.parse(b.start)) / 60000, 0); }
function assertNoTaskConflicts(blocks: ScheduledBlock[]) {
  for (const a of blocks.filter(b => b.kind === 'task')) for (const b of blocks.filter(b => b.id !== a.id)) expect(Date.parse(a.end) <= Date.parse(b.start) || Date.parse(a.start) >= Date.parse(b.end)).toBe(true);
}
describe('deterministic workday scheduling', () => {
  it('merges overlapping meetings for capacity, warns and splits work without collisions', () => {
    const result = plan({ tasks: [task('build', 300)], events: [event('a','10:00','11:00'),event('b','10:30','12:00')] });
    const blocks = result.blocks.filter(b => b.kind === 'task');
    expect(blocks.map(b => [b.start,b.end])).toEqual([[instant('09:00'),instant('10:00')],[instant('12:00'),instant('16:00')]]);
    expect(result.warnings[0]).toContain('overlap'); expect(result.overflow).toEqual([]); assertNoTaskConflicts(result.blocks);
  });
  it('reserves lunch and extra breaks; reports overflow and never extends working hours', () => {
    const result = plan({ settings: { ...settings, lunchEnabled: true, breaks: [{ id: 'tea', title: 'Tea', start: '15:00', minutes: 15 }] }, tasks: [task('large', 600)] });
    expect(minutes(result.blocks.filter(b => b.kind === 'task'))).toBe(435);
    expect(result.overflow).toEqual([{ taskId: 'large', remainingMinutes: 165, reason: 'Insufficient working time' }]);
    assertNoTaskConflicts(result.blocks);
    expect(result.blocks.every(b => b.end <= instant('17:00'))).toBe(true);
  });
  it('sorts by priority then deadline and excludes deferred, completed and other dates', () => {
    const result = plan({ tasks: [task('low',60,{priority:'low'}),task('later',60,{priority:'high',deadline:instant('15:00')}),task('early',60,{priority:'high',deadline:instant('12:00')}),task('done',60,{status:'completed'}),task('deferred',60,{status:'deferred'}),task('tomorrow',60,{scheduledDate:addDays(date,1)})] });
    expect(result.blocks.map(b => b.taskId)).toEqual(['early','later','low']);
  });
  it('respects deadlines even when work hours remain', () => {
    const result = plan({ tasks: [task('urgent',120,{deadline:instant('10:00')})] });
    expect(minutes(result.blocks)).toBe(60); expect(result.overflow[0].remainingMinutes).toBe(60);
    expect(result.overflow[0].reason).toContain('deadline');
  });
  it('orders dependencies and detects cycles/missing/unfinished dependencies', () => {
    const result = plan({ tasks: [task('after',60,{priority:'high',dependencyIds:['before']}),task('before',60,{priority:'low'}),task('missing',60,{dependencyIds:['absent']}),task('cycleA',60,{dependencyIds:['cycleB']}),task('cycleB',60,{dependencyIds:['cycleA']})] });
    expect(result.blocks.map(b => b.taskId)).toEqual(['before','after']); expect(result.overflow).toHaveLength(3); assertNoTaskConflicts(result.blocks);
    const insufficient = plan({ tasks:[task('before',600),task('after',60,{dependencyIds:['before']})] });
    expect(insufficient.overflow.map(o => o.taskId)).toEqual(['before','after']);
  });
  it('retains an earlier gap for independent work when a dependency finishes later', () => {
    const result = plan({ tasks: [task('after',60,{priority:'high',dependencyIds:['done']}), task('independent',120)], existing: [], now: ms('08:00') });
    expect(result.overflow[0].taskId).toBe('after'); // Missing dependency is explicit overflow.
    const withCompleted = plan({ tasks: [task('after',60,{priority:'high',dependencyIds:['done']}), task('independent',120), task('done',60,{status:'completed',completedAt:instant('12:00')})] });
    expect(withCompleted.blocks.find(b => b.taskId === 'independent')?.start).toBe(instant('09:00'));
    expect(withCompleted.blocks.find(b => b.taskId === 'after')?.start).toBe(instant('12:00'));
    assertNoTaskConflicts(withCompleted.blocks);
  });
  it('reschedules only remaining actual work after now and preserves elapsed blocks', () => {
    const existing: ScheduledBlock = { id:'old', taskId:'build', kind:'task', start:instant('09:00'), end:instant('12:00'),fixed:false };
    const result = plan({ now:ms('10:00'), tasks:[task('build',180,{actualSeconds:1800,status:'in_progress'})], sessions:[{id:'active',taskId:'build',startedAt:instant('09:30')}], existing:[existing], events:[event('meeting','11:00','12:00')] });
    expect(result.blocks.find(b => b.id === 'old')?.end).toBe(instant('10:00'));
    expect(minutes(result.blocks.filter(b => b.kind === 'task' && b.id !== 'old'))).toBe(120);
    assertNoTaskConflicts(result.blocks);
  });
  it('releases unused time when work finishes early while retaining completed work', () => {
    const result = plan({ now:ms('10:00'), tasks:[task('done',180,{status:'completed',completedAt:instant('09:45')}),task('next',60)], existing:[{id:'old',taskId:'done',kind:'task',start:instant('09:00'),end:instant('12:00'),fixed:false}] });
    expect(result.blocks.find(b => b.id === 'old')?.end).toBe(instant('09:45'));
    expect(result.blocks.find(b => b.taskId === 'next')?.start).toBe(instant('10:00'));
  });
  it('drops past planned time nobody used, including leftover fragments', () => {
    const old = (id: string, taskId: string, start: string, end: string): ScheduledBlock => ({ id, taskId, kind: 'task', start: instant(start), end: instant(end), fixed: false, planDate: date });
    const result = plan({ now: ms('10:00'),
      tasks: [task('skipped', 60, { status: 'deferred' }), task('worked', 60, { actualSeconds: 600, status: 'paused' }), task('idle', 60)],
      sessions: [{ id: 's', taskId: 'worked', startedAt: instant('09:30'), endedAt: instant('09:40') }],
      existing: [old('a', 'skipped', '09:00', '09:30'), old('b', 'worked', '09:30', '09:50'), old('c', 'idle', '09:50', '09:55'), old('d', 'idle', '09:59', '09:59')] });
    expect(result.blocks.map(b => b.id).filter(id => ['a', 'b', 'c', 'd'].includes(id))).toEqual(['b']);
    expect(result.blocks.filter(b => b.taskId === 'idle').map(b => b.start)).toEqual([instant('10:00')]);
  });
  it('shows the current plan on the timeline even before it is replanned', () => {
    const saved: ScheduledBlock[] = [
      { id: 'past-deferred', taskId: 'litellm', kind: 'task', start: instant('10:01'), end: instant('10:04'), fixed: false, planDate: date },
      { id: 'stub', taskId: 'deploy', kind: 'task', start: instant('10:06'), end: instant('10:06'), fixed: false, planDate: date },
      { id: 'later-deferred', taskId: 'litellm', kind: 'task', start: instant('14:00'), end: instant('15:00'), fixed: false, planDate: date },
      { id: 'worked', taskId: 'form', kind: 'task', start: instant('09:00'), end: instant('09:30'), fixed: false, planDate: date },
      { id: 'next', taskId: 'deploy', kind: 'task', start: instant('11:00'), end: instant('11:30'), fixed: false, planDate: date },
      { id: 'meeting', calendarEventId: 'm', kind: 'meeting', start: instant('10:30'), end: instant('11:00'), fixed: true, planDate: date }];
    const tasks = [task('litellm', 60, { status: 'deferred' }), task('deploy', 60), task('form', 30, { status: 'paused', actualSeconds: 900 })];
    const sessions = [{ id: 's', taskId: 'form', startedAt: instant('09:00'), endedAt: instant('09:15') }];
    expect(timelineBlocks(saved, tasks, sessions, date, ms('10:10')).map(b => b.id)).toEqual(['worked', 'next', 'meeting']);
  });
  it('preserves future fixed task commitments and does not allocate that work twice', () => {
    const result = plan({ tasks:[task('a',120)], existing:[{id:'fixed',taskId:'a',kind:'task',start:instant('14:00'),end:instant('15:00'),fixed:true}] });
    expect(minutes(result.blocks)).toBe(120); expect(result.blocks.find(b => b.id === 'fixed')).toBeDefined(); assertNoTaskConflicts(result.blocks);
  });
  it('reports all remaining work after hours and on nonworking days', () => {
    expect(plan({now:ms('18:00'),tasks:[task('a')]}).overflow[0].remainingMinutes).toBe(60);
    expect(plan({date:'2026-11-14',tasks:[task('a',60,{scheduledDate:'2026-11-14'})]}).blocks).toHaveLength(0);
  });
  it('produces identical output from identical input', () => { expect(plan({ tasks:[task('a')] })).toEqual(plan({ tasks:[task('a')] })); });
});
describe('timezones and daylight saving', () => {
  it('uses Newfoundland half-hour offset', () => { expect(new Date(zonedTime(date,'09:00','America/St_Johns')).toISOString()).toBe(instant('12:30')); });
  it('handles spring-forward and fall-back shift lengths', () => {
    const s = {...settings,timeZone:'America/New_York',start:'00:00',end:'08:00',workingDays:[7]};
    const spring = workWindow('2026-03-08',s), fall = workWindow('2026-11-01',s);
    expect((spring.end - spring.start)/3600000).toBe(7); expect((fall.end - fall.start)/3600000).toBe(9);
  });
  it('handles overnight work, after-midnight breaks and active work date', () => {
    const s = {...settings,start:'22:00',end:'06:00',lunchEnabled:true,lunchStart:'02:00'};
    const result = plan({settings:s,tasks:[task('night',480)],now:ms('21:00')});
    expect(result.end).toBe('2026-11-13T06:00:00.000Z'); expect(result.overflow[0].remainingMinutes).toBe(30); assertNoTaskConflicts(result.blocks);
    expect(workDate(Date.parse('2026-11-13T03:00:00Z'),s)).toBe(date);
  });
  it('rejects ambiguous or nonexistent manual meeting times rather than guessing', () => {
    expect(() => parseLocalInput('2026-03-08T02:30','America/New_York')).toThrow('daylight saving');
    expect(() => parseLocalInput('2026-11-01T01:30','America/New_York')).toThrow('daylight saving');
  });
});
it('retains completed history when changed work hours no longer cover it',()=>{
 const result=plan({settings:{...settings,start:'12:00'},now:ms('13:00'),tasks:[task('done',60,{status:'completed',completedAt:instant('10:00')})],existing:[{id:'history',taskId:'done',kind:'task',start:instant('09:00'),end:instant('10:00'),fixed:false,planDate:date}]});
 expect(result.blocks.find(b=>b.id==='history')?.start).toBe(instant('09:00'));
});
it('reserves overlapping adjacent plans without moving their records',()=>{
 const other=task('other',60,{scheduledDate:'2026-11-11'});
 const foreign:ScheduledBlock={id:'foreign',taskId:'other',kind:'task',start:instant('09:00'),end:instant('10:00'),planDate:'2026-11-11',fixed:false};
 const result=plan({tasks:[other,task('new')],existing:[foreign]});
 expect(result.blocks.some(b=>b.id==='foreign')).toBe(false);
 expect(result.blocks.find(b=>b.taskId==='new')?.start).toBe(instant('10:00'));
 expect(result.warnings.join()).toContain('another saved plan');
});
it('does not assume an unfinished task is completed when its estimate is exhausted',()=>{
 const result=plan({tasks:[task('over',60,{actualSeconds:3600}),task('after',60,{dependencyIds:['over']})]});
 expect(result.blocks).toHaveLength(0);expect(result.overflow[0].reason).toContain('Estimate used up');expect(result.overflow[1].reason).toContain('dependency');
});
