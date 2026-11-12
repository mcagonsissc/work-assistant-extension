import { db, closeSessions, notifyBackground, type WorkdayDB } from '../../storage/db';
export async function startFocus(taskId: string, database: WorkdayDB = db, now = Date.now()) {
  await database.transaction('rw', [database.tasks, database.sessions], async () => {
    const task = await database.tasks.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'deferred') throw new Error('Reopen this task before starting focus.');
    const sessions = await database.sessions.toArray();
    if (sessions.some(s => s.taskId === taskId && !s.endedAt)) return;
    await closeSessions(database, now);
    await database.sessions.add({ id: crypto.randomUUID(), taskId, startedAt: new Date(now).toISOString() });
    await database.tasks.update(taskId, { status: 'in_progress', updatedAt: new Date(now).toISOString() });
  }); notifyBackground();
}
export async function pauseFocus(taskId: string, database: WorkdayDB = db, now = Date.now()) {
  await database.transaction('rw', [database.tasks, database.sessions], async () => { await closeSessions(database, now, taskId); });
  notifyBackground();
}
