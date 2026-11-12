import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkdayDB, saveTask } from '../src/storage/db';
import { pauseFocus, startFocus } from '../src/services/focus/service';
import { spentSeconds } from '../src/services/scheduling/engine';
let db: WorkdayDB;
const base = Date.parse('2026-11-12T09:00:00Z');
const input = {title:'Build', description:'',priority:'medium' as const,status:'todo' as const,estimatedMinutes:60};
beforeEach(() => {db=new WorkdayDB(`focus-${crypto.randomUUID()}`);});
afterEach(async () => {await db.delete();});
describe('timestamp-based focus sessions', () => {
  it('recovers an open timer after reconnection and credits actual time once', async () => {
    const task=await saveTask(input,undefined,db,base); await startFocus(task.id,db,base);
    const name=db.name; db.close(); db=new WorkdayDB(name);
    const sessions=await db.sessions.toArray();
    expect(spentSeconds(task,sessions,base+90_000)).toBe(90);
    await pauseFocus(task.id,db,base+90_000); await pauseFocus(task.id,db,base+100_000);
    expect((await db.tasks.get(task.id))?.actualSeconds).toBe(90);
    await startFocus(task.id,db,base+120_000); await saveTask({...input,status:'completed'},task.id,db,base+180_000);
    expect((await db.tasks.get(task.id))?.actualSeconds).toBe(150);
    expect((await db.sessions.toArray()).every(s=>s.endedAt)).toBe(true);
  });
  it('switches tasks atomically and concurrent starts leave only one running session', async () => {
    const a=await saveTask(input,undefined,db,base), b=await saveTask(input,undefined,db,base);
    await startFocus(a.id,db,base); await startFocus(a.id,db,base+5000);
    expect(await db.sessions.count()).toBe(1);
    await startFocus(b.id,db,base+10_000);
    expect((await db.tasks.get(a.id))?.actualSeconds).toBe(10);
    expect((await db.tasks.get(a.id))?.status).toBe('paused');
    await Promise.all([startFocus(a.id,db,base+20_000),startFocus(b.id,db,base+20_000)]);
    expect((await db.sessions.toArray()).filter(s=>!s.endedAt)).toHaveLength(1);
  });
  it('closing a task releases its future blocks and cannot restart a completed task', async () => {
    const task=await saveTask(input,undefined,db,base);await startFocus(task.id,db,base);
    await db.blocks.bulkAdd([{id:'active',taskId:task.id,kind:'task',start:new Date(base).toISOString(),end:new Date(base+3600_000).toISOString(),fixed:false},{id:'later',taskId:task.id,kind:'task',start:new Date(base+7200_000).toISOString(),end:new Date(base+10800_000).toISOString(),fixed:false}]);
    await saveTask({...input,status:'completed'},task.id,db,base+10_000);
    expect(await db.blocks.count()).toBe(1);expect((await db.blocks.get('active'))?.end).toBe(new Date(base+10_000).toISOString());
    await expect(startFocus(task.id,db,base+20_000)).rejects.toThrow('Reopen');
  });
});
