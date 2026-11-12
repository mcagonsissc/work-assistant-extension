import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach,afterEach,it,expect } from 'vitest';
import { WorkdayDB,saveSettings,saveTask } from '../src/storage/db';
import { approvePlan,previewPlan,saveMeeting,deleteMeeting } from '../src/services/scheduling/service';
import { defaultSettings } from '../src/shared/settings';
let db:WorkdayDB;
const date='2026-11-12', now=Date.parse(`${date}T08:00:00Z`);
const input={title:'Build',description:'',priority:'medium' as const,status:'todo' as const,estimatedMinutes:60,scheduledDate:date};
beforeEach(async()=>{db=new WorkdayDB(`plans-${crypto.randomUUID()}`);await saveSettings({...defaultSettings(),timeZone:'UTC'},db);});
afterEach(async()=>{await db.delete();});
it('previews without writing, then atomically approves tasks and blocks',async()=>{
 const task=await saveTask({...input,scheduledDate:undefined},undefined,db,now);
 const preview=await previewPlan(date,undefined,db,now);
 expect(await db.blocks.count()).toBe(0);expect(await db.plans.count()).toBe(0);
 await approvePlan(preview,db,now+1000);
 expect(await db.blocks.count()).toBeGreaterThan(0);expect((await db.tasks.get(task.id))?.scheduledDate).toBe(date);expect((await db.plans.get(date))?.signature).toBeTruthy();
});
it('rejects stale and expired previews and leaves the existing plan intact',async()=>{
 const task=await saveTask(input,undefined,db,now);const original=await previewPlan(date,undefined,db,now);await approvePlan(original,db,now);
 const existing=await db.blocks.toArray();const preview=await previewPlan(date,undefined,db,now);
 await saveTask({...input,title:'Changed'},task.id,db,now+1000);
 await expect(approvePlan(preview,db,now+2000)).rejects.toThrow('changed');expect(await db.blocks.toArray()).toEqual(existing);
 const fresh=await previewPlan(date,undefined,db,now);await expect(approvePlan(fresh,db,now+61_000)).rejects.toThrow('expired');
});
it('extends an estimate only on approval and recalculates meeting conflicts',async()=>{
 const task=await saveTask(input,undefined,db,now);const extension=await previewPlan(date,{taskId:task.id,minutes:30},db,now);
 expect((await db.tasks.get(task.id))?.estimatedMinutes).toBe(60);await approvePlan(extension,db,now);
 expect((await db.tasks.get(task.id))?.estimatedMinutes).toBe(90);
 await saveMeeting({title:'Standup',start:`${date}T09:00:00.000Z`,end:`${date}T10:00:00.000Z`,timeZone:'UTC'},undefined,db);
 const plan=await previewPlan(date,undefined,db,now);expect(plan.result.blocks.find(b=>b.taskId===task.id)?.start).toBe(`${date}T10:00:00.000Z`);
 const event=(await db.events.toArray())[0];await deleteMeeting(event.id,db);expect(await db.events.count()).toBe(0);
});
it('upgrades a v1 database without losing existing task records',async()=>{
 const name=`legacy-${crypto.randomUUID()}`;const legacy=new Dexie(name);legacy.version(1).stores({ tasks:'id, status, scheduledDate, createdAt',blocks:'id, taskId, start',sessions:'id, taskId, startedAt',events:'id, externalId, start' });
 await legacy.table('tasks').put({...input,id:'legacy',actualSeconds:0,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),source:'manual',dependencyIds:[]});legacy.close();
 const upgraded=new WorkdayDB(name);try{expect((await upgraded.tasks.get('legacy'))?.title).toBe('Build');expect(await upgraded.settings.count()).toBe(0);}finally{await upgraded.delete();}
});
it('extending an overdue running task adds usable time beyond its actual elapsed work',async()=>{
 const task=await saveTask({...input,estimatedMinutes:30},undefined,db,now);
 await db.tasks.update(task.id,{actualSeconds:70*60});
 const preview=await previewPlan(date,{taskId:task.id,minutes:30},db,now);
 expect(preview.extension?.estimatedMinutes).toBe(100);
 await approvePlan(preview,db,now);
 expect((await db.tasks.get(task.id))?.estimatedMinutes).toBe(100);
 expect(preview.result.blocks.filter(b=>b.taskId===task.id).reduce((sum,b)=>sum+(Date.parse(b.end)-Date.parse(b.start))/60000,0)).toBe(30);
});
