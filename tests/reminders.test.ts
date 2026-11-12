import 'fake-indexeddb/auto';
import { beforeEach,afterEach,describe,it,expect } from 'vitest';
import { WorkdayDB,saveTask,saveSettings } from '../src/storage/db';
import { defaultSettings } from '../src/shared/settings';
import { approvePlan,previewPlan,saveMeeting } from '../src/services/scheduling/service';
import { startFocus,pauseFocus } from '../src/services/focus/service';
import { buildReminders,isQuiet,syncReminders,type ReminderPlatform } from '../src/services/notifications/reminders';
let db:WorkdayDB;
const date='2026-11-12', base=Date.parse(`${date}T08:00:00Z`);
const settings={...defaultSettings(),timeZone:'UTC',notificationsEnabled:true,checkInMinutes:5,workdayReminders:false};
const input={title:'Build',description:'',priority:'medium' as const,status:'todo' as const,estimatedMinutes:60,scheduledDate:date};
function platform(){const alarms=new Map<string,number>(),sent:string[]=[]; const api:ReminderPlatform={listAlarms:async()=>[...alarms.keys()],setAlarm:async(n,t)=>{alarms.set(n,t);},clearAlarm:async n=>{alarms.delete(n);},notify:async id=>{sent.push(id);}};return {api,alarms,sent};}
beforeEach(async()=>{db=new WorkdayDB(`reminders-${crypto.randomUUID()}`);await saveSettings(settings,db);});
afterEach(async()=>{await db.delete();});
async function seed(){await saveTask(input,undefined,db,base);await approvePlan(await previewPlan(date,undefined,db,base),db,base);}
describe('persisted reminders',()=>{
 it('restores future alarms and delivers once despite rebuilds or concurrent syncs',async()=>{
  await seed();const first=platform();await syncReminders(first.api,db,base);expect(first.alarms.size).toBeGreaterThan(0);
  const restored=platform();await syncReminders(restored.api,db,base);expect([...restored.alarms]).toEqual([...first.alarms]);
  const due=Date.parse(`${date}T08:55:00Z`);await Promise.all([syncReminders(restored.api,db,due),syncReminders(restored.api,db,due)]);
  expect(restored.sent).toHaveLength(1);await syncReminders(restored.api,db,due+1000);expect(restored.sent).toHaveLength(1);
 });
 it('does not repeat a start reminder after editing the same task',async()=>{
  await seed();const browser=platform(),due=Date.parse(`${date}T08:55:00Z`);await syncReminders(browser.api,db,due);
  const task=(await db.tasks.toArray())[0];await saveTask({...task,description:'Edited'},task.id,db,due);
  await approvePlan(await previewPlan(date,undefined,db,due),db,due);await syncReminders(browser.api,db,due);
  expect(browser.sent).toHaveLength(1);
 });
 it('respects notification opt-out and overnight quiet hours while retaining panel check-ins',async()=>{
  expect(isQuiet(Date.parse(`${date}T22:00:00Z`),{...settings,quietEnabled:true,quietStart:'20:00',quietEnd:'08:00'})).toBe(true);
  expect(isQuiet(Date.parse(`${date}T12:00:00Z`),{...settings,quietEnabled:true,quietStart:'20:00',quietEnd:'08:00'})).toBe(false);
  await saveSettings({...settings,notificationsEnabled:false},db);const task=await saveTask(input,undefined,db,base);await startFocus(task.id,db,base);
  const browser=platform();await syncReminders(browser.api,db,base+5*60000);
  expect(browser.sent).toHaveLength(0);expect((await db.reminders.toArray()).some(r=>r.kind==='checkin'&&r.deliveredAt)).toBe(true);
 });
 it('does not catch up expired reminders after prolonged sleep and clears obsolete alarms',async()=>{
  await seed();const browser=platform();await syncReminders(browser.api,db,base);expect(browser.alarms.size).toBeGreaterThan(0);
  await syncReminders(browser.api,db,Date.parse(`${date}T20:00:00Z`));expect(browser.sent).toHaveLength(0);expect(browser.alarms.size).toBe(0);
 });
 it('records failed notification delivery without endlessly duplicating attempts',async()=>{
  await seed();const browser=platform();let attempts=0;browser.api.notify=async()=>{attempts++;throw new Error('OS blocked');};
  await syncReminders(browser.api,db,Date.parse(`${date}T08:55:00Z`));await syncReminders(browser.api,db,Date.parse(`${date}T08:56:00Z`));
  expect(attempts).toBe(1);expect((await db.reminders.toArray()).some(r=>r.deliveryError)).toBe(true);
 });
 it('creates periodic check-ins from persisted sessions and cancels future ones when paused',async()=>{
  const task=await saveTask(input,undefined,db,base);await startFocus(task.id,db,base);const browser=platform();
  await syncReminders(browser.api,db,base);expect([...browser.alarms.keys()].some(n=>n.includes('focus:'))).toBe(true);
  await pauseFocus(task.id,db,base+60000);await syncReminders(browser.api,db,base+60000);expect(browser.alarms.size).toBe(0);
 });
 it('meeting reminders are independent of an approved task plan',async()=>{
  await saveMeeting({title:'Meeting',start:`${date}T09:00:00.000Z`,end:`${date}T10:00:00.000Z`,timeZone:'UTC'},undefined,db);
  const browser=platform();await syncReminders(browser.api,db,Date.parse(`${date}T08:55:00Z`));expect(browser.sent).toHaveLength(1);
 });
 it('quiet time suppresses due OS notifications and frequency zero disables periodic checks',async()=>{
  await saveSettings({...settings,quietEnabled:true,quietStart:'08:00',quietEnd:'10:00'},db);await seed();const browser=platform();
  await syncReminders(browser.api,db,Date.parse(`${date}T08:55:00Z`));expect(browser.sent).toHaveLength(0);
  const task=(await db.tasks.toArray())[0];await startFocus(task.id,db,base);
  const reminders=buildReminders({settings:{...settings,checkInMinutes:0},tasks:await db.tasks.toArray(),sessions:await db.sessions.toArray(),plans:[],blocks:[],events:[]},base+60000);
  expect(reminders).toHaveLength(0);
 });
});
it('does not redeliver a meeting reminder after editing its title',async()=>{
 const meeting={title:'Standup',start:`${date}T09:00:00.000Z`,end:`${date}T10:00:00.000Z`,timeZone:'UTC'};
 await saveMeeting(meeting,undefined,db);const browser=platform(),due=Date.parse(`${date}T08:55:00Z`);await syncReminders(browser.api,db,due);
 const event=(await db.events.toArray())[0];await saveMeeting({...meeting,title:'Updated standup'},event.id,db);await syncReminders(browser.api,db,due);
 expect(browser.sent).toHaveLength(1);
});
it('reminds at an overnight shift end without requiring an approved plan',async()=>{
 await saveSettings({...settings,start:'22:00',end:'06:00',workdayReminders:true},db);
 const browser=platform();await syncReminders(browser.api,db,Date.parse('2026-11-13T06:00:00Z'));
 expect(browser.sent).toHaveLength(1);expect(browser.sent[0]).toContain('workend:2026-11-12');
});
