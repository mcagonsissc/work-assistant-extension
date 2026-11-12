import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkdayDB, saveTask, deleteTask } from '../src/storage/db';
import type { TaskInput } from '../src/shared/models';
let db: WorkdayDB;
const input: TaskInput = { title: 'Review API', description: '', priority: 'high', status: 'todo', estimatedMinutes: 45, scheduledDate: '2026-11-12' };
beforeEach(() => { db = new WorkdayDB(`test-${crypto.randomUUID()}`); });
afterEach(async () => { await db.delete(); });
describe('persisted task lifecycle', () => {
  it('creates tasks and recovers them from a fresh database connection', async () => {
    const task = await saveTask(input, undefined, db);
    const name = db.name; db.close(); db = new WorkdayDB(name);
    expect(await db.tasks.get(task.id)).toMatchObject({ ...input, id: task.id, actualSeconds: 0, source: 'manual' });
  });
  it('updates, completes, preserves completion time and reopens a task', async () => {
    const task = await saveTask(input, undefined, db);
    const complete = await saveTask({ ...input, title: 'Updated', status: 'completed' }, task.id, db);
    expect(complete.completedAt).toBeTruthy();
    const edited = await saveTask({ ...complete, description: 'Done' }, task.id, db);
    expect(edited.completedAt).toBe(complete.completedAt);
    expect((await saveTask({ ...edited, status: 'todo' }, task.id, db)).completedAt).toBeUndefined();
    expect(await db.tasks.count()).toBe(1);
  });
  it('supports deferral and refuses to resurrect a deleted task', async () => {
    const task = await saveTask(input, undefined, db);
    expect((await saveTask({ ...input, status: 'deferred' }, task.id, db)).status).toBe('deferred');
    await deleteTask(task.id, db);
    await expect(saveTask(input, task.id, db)).rejects.toThrow('no longer exists');
  });
  it('rejects invalid data without persisting it', async () => {
    for (const patch of [{ title: ' ' }, { estimatedMinutes: 0 }, { estimatedMinutes: NaN }, { estimatedMinutes: 1441 }, { deadline: 'invalid' }, { scheduledDate: '2026-02-30' }, { status: 'invalid' }]) {
      await expect(saveTask({ ...input, ...patch } as TaskInput, undefined, db)).rejects.toThrow();
    }
    expect(await db.tasks.count()).toBe(0);
  });
  it('deletes dependent records atomically without removing other tasks', async () => {
    const a = await saveTask(input, undefined, db); const b = await saveTask(input, undefined, db);
    await db.blocks.add({ id: 'block', taskId: a.id, kind: 'task', start: '2026-11-12T09:00:00Z', end: '2026-11-12T10:00:00Z', fixed: false });
    await db.sessions.add({ id: 'session', taskId: a.id, startedAt: '2026-11-12T09:00:00Z' });
    await deleteTask(a.id, db);
    expect(await db.blocks.count()).toBe(0); expect(await db.sessions.count()).toBe(0);
    expect(await db.tasks.get(b.id)).toBeDefined();
  });
});
it('rejects dependency cycles transactionally', async () => {
 const a=await saveTask(input,undefined,db), b=await saveTask(input,undefined,db);
 await saveTask({...input,dependencyIds:[a.id]},b.id,db);
 await expect(saveTask({...input,dependencyIds:[b.id]},a.id,db)).rejects.toThrow('cycle');
 expect((await db.tasks.get(a.id))?.dependencyIds).toEqual([]);
});
