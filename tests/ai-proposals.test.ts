import 'fake-indexeddb/auto';
import { afterEach,beforeEach,it,expect,describe,vi } from 'vitest';
import { WorkdayDB,getSettings,saveSettings,saveTask } from '../src/storage/db';
import { approveAIProposal,prepareProposal,refreshAIProposal,rejectAIProposal } from '../src/services/ai/proposals';
import { snapshot,planFingerprint } from '../src/services/scheduling/service';
import { defaultSettings } from '../src/shared/settings';
import { startFocus } from '../src/services/focus/service';
import { AI_DATE,AI_NOW,answer,blankPatch,createAction } from './ai-fixtures';
let db:WorkdayDB;
beforeEach(async()=>{db=new WorkdayDB(`ai-proposal-${crypto.randomUUID()}`);await saveSettings({...defaultSettings(),timeZone:'UTC'},db);});
afterEach(async()=>{await db.delete();vi.restoreAllMocks();});
const input={title:'Write documentation',description:'',priority:'medium' as const,status:'todo' as const,estimatedMinutes:60,scheduledDate:AI_DATE};
async function proposal(response=answer(createAction()),allowed?:string[]){const base=await snapshot(db);const p=prepareProposal(base,response,AI_DATE,allowed??base.tasks.map(t=>t.id),'user',AI_NOW);await db.aiProposals.put(p);return p;}
describe('validated approval boundary',()=>{
 it('previews new tasks and meetings without mutating work data, then approves once',async()=>{
  const p=await proposal(answer(createAction(),{type:'create_meeting',title:'Standup',startLocal:`${AI_DATE}T10:00:00`,endLocal:`${AI_DATE}T11:00:00`}));
  expect(await db.tasks.count()).toBe(0);expect(await db.blocks.count()).toBe(0);expect(await db.events.count()).toBe(0);expect(p.plans[0].blocks.some(b=>b.kind==='meeting')).toBe(true);
  await approveAIProposal(p.id,db,AI_NOW+1000);expect(await db.tasks.count()).toBe(1);expect((await db.tasks.toArray())[0].source).toBe('ai');expect(await db.events.count()).toBe(1);
  const state=await snapshot(db);expect((await db.plans.get(AI_DATE))?.signature).toBe(planFingerprint(state));
  await expect(approveAIProposal(p.id,db,AI_NOW+2000)).rejects.toMatchObject({code:'stale'});expect(await db.tasks.count()).toBe(1);
 });
 it('rejecting or refreshing never applies task changes',async()=>{
  const p=await proposal();await refreshAIProposal(p.id,db,AI_NOW+61_000);expect(await db.tasks.count()).toBe(0);
  await rejectAIProposal(p.id,db);expect((await db.aiProposals.get(p.id))?.status).toBe('rejected');expect(await db.tasks.count()).toBe(0);
 });
 it('rejects expired and changed snapshots; refresh keeps IDs stable and requires review',async()=>{
  const p=await proposal();await expect(approveAIProposal(p.id,db,AI_NOW+61_000)).rejects.toMatchObject({code:'stale'});
  await saveTask(input,undefined,db,AI_NOW);await expect(approveAIProposal(p.id,db,AI_NOW+1000)).rejects.toThrow('changed');
  const refreshed=await refreshAIProposal(p.id,db,AI_NOW+2000);expect(refreshed.ids).toEqual(p.ids);await approveAIProposal(p.id,db,AI_NOW+3000);expect(await db.tasks.count()).toBe(2);
 });
 it('uses deterministic working-hour constraints and reports overflow',async()=>{
  const p=await proposal(answer(createAction({estimatedMinutes:1440})));expect(p.plans[0].overflow[0].remainingMinutes).toBe(990);
  expect(p.plans[0].blocks.every(b=>Date.parse(b.end)<=Date.parse(`${AI_DATE}T17:00:00Z`))).toBe(true);
 });
 it('resolves new task dependencies locally and rejects cycles, duplicate references and hidden task IDs',async()=>{
  const state=await snapshot(db),actions=answer(createAction({clientId:'a'}),createAction({clientId:'b',dependencyIds:['a']}));
  const p=prepareProposal(state,actions,AI_DATE,[],'user',AI_NOW);await db.aiProposals.put(p);await approveAIProposal(p.id,db,AI_NOW);const tasks=await db.tasks.toArray();expect(tasks.find(t=>t.id===p.ids[1][1])?.dependencyIds).toEqual([p.ids[0][1]]);
  expect(()=>prepareProposal(state,answer(createAction({clientId:'a',dependencyIds:['b']}),createAction({clientId:'b',dependencyIds:['a']})),AI_DATE,[],'user',AI_NOW)).toThrow('cycle');
  expect(()=>prepareProposal(state,answer(createAction(),createAction()),AI_DATE,[],'user',AI_NOW)).toThrow('unique');
  const hidden=await saveTask(input,undefined,db,AI_NOW);expect(()=>prepareProposal({...state,tasks:[hidden]},answer({type:'complete_task',taskId:hidden.id}),AI_DATE,[],'user',AI_NOW)).toThrow('outside');
 });
 it('completes focus accurately at approval and releases its unused future time',async()=>{
  const task=await saveTask(input,undefined,db,AI_NOW);await startFocus(task.id,db,AI_NOW);
  const p=await proposal(answer({type:'complete_task',taskId:task.id}));await approveAIProposal(p.id,db,AI_NOW+10_000);
  expect((await db.tasks.get(task.id))?.actualSeconds).toBe(10);expect((await db.tasks.get(task.id))?.status).toBe('completed');expect((await db.sessions.toArray())[0].endedAt).toBeTruthy();
 });
 it('extends actual elapsed work and postpones tasks without duplicating them',async()=>{
  const task=await saveTask(input,undefined,db,AI_NOW);await db.tasks.update(task.id,{actualSeconds:70*60});
  const p=await proposal(answer({type:'extend_task',taskId:task.id,minutes:45}));expect(p.changes[0].after.estimatedMinutes).toBe(115);await approveAIProposal(p.id,db,AI_NOW);
  const move=await proposal(answer({type:'defer_task',taskId:task.id,scheduledDate:'2026-11-13'}));await approveAIProposal(move.id,db,AI_NOW);expect(await db.tasks.count()).toBe(1);expect((await db.tasks.get(task.id))?.scheduledDate).toBe('2026-11-13');
 });
 it('rolls back every write if any part of approval fails',async()=>{
  const p=await proposal();const original=db.events.bulkPut.bind(db.events);vi.spyOn(db.events,'bulkPut').mockImplementationOnce((...args)=>{void args;throw new Error('Injected persistence failure');});
  await expect(approveAIProposal(p.id,db,AI_NOW)).rejects.toThrow('Injected');expect(await db.tasks.count()).toBe(0);expect(await db.blocks.count()).toBe(0);expect((await db.aiProposals.get(p.id))?.status).toBe('pending');void original;
 });
 it('rejects contradictory, empty and excessive updates without writes',async()=>{
  const task=await saveTask(input,undefined,db,AI_NOW),base=await snapshot(db);
  for(const patch of [blankPatch,{...blankPatch,deadline:`${AI_DATE}T12:00:00Z`,clearDeadline:true}])expect(()=>prepareProposal(base,answer({type:'update_task',taskId:task.id,patch}),AI_DATE,[task.id],'user',AI_NOW)).toThrow();
  expect(()=>prepareProposal(base,answer({type:'extend_task',taskId:task.id,minutes:480},{type:'extend_task',taskId:task.id,minutes:30}),AI_DATE,[task.id],'user',AI_NOW)).toThrow('conflicting');
  expect(await db.tasks.count()).toBe(1);expect((await getSettings(db)).timeZone).toBe('UTC');
 });
});
it('recalculates every date occupied by a multi-day proposed meeting',async()=>{
 const p=await proposal(answer({type:'create_meeting',title:'Workshop',startLocal:'2026-11-12T10:00:00',endLocal:'2026-11-14T11:00:00'}));
 expect(p.plans.map(plan=>plan.date)).toEqual(['2026-11-12','2026-11-13','2026-11-14']);expect(await db.events.count()).toBe(0);
});
