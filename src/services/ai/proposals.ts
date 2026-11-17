import { taskInput, type Task } from '../../shared/models';
import { db, notifyBackground, type WorkdayDB } from '../../storage/db';
import { snapshot, planFingerprint } from '../scheduling/service';
import { scheduleDay, spentSeconds, type ScheduleResult } from '../scheduling/engine';
import { addDays, iso, parseLocalInput, workDate, workWindow } from '../scheduling/time';
import { assistantResponseSchema, AIError, redactSecrets, type AssistantResponse } from './schema';
import type { AIProposal, Change } from './types';
import type { WorkdaySnapshot } from './context';
function invalid(message: string): never { throw new AIError('invalid_action', `${message} No task changes were applied.`); }
function taskSummary(task: Task): Record<string,unknown> { return { title:task.title, description:task.description, category:task.category ?? 'other', priority:task.priority, status:task.status, estimatedMinutes:task.estimatedMinutes, scheduledDate:task.scheduledDate ?? null, deadline:task.deadline ?? null, dependencyIds:task.dependencyIds, notes:task.notes ?? '' }; }
export function projectActions(base: WorkdaySnapshot, response: AssistantResponse, date: string, allowedTaskIds: string[], ids: [string,string][], now: number) {
  const state = structuredClone(base), createdIds = new Map(ids), allowed = new Set(allowedTaskIds);
  const dates = new Set<string>(), changes: Change[] = [];
  const before = new Map(base.tasks.map(t=>[t.id,t])); const mutated = new Set<string>(), touchedMeetings = new Set<string>(), pinned = new Set<string>(); const pinChanges: Change[] = [];
  const resolve = (reference:string) => { const id=createdIds.get(reference) ?? reference; if (!allowed.has(id) && !ids.some(([client,value])=>!client.startsWith('meeting:') && value===id)) invalid('The model referenced a task outside the shared context.'); return id; };
  function closeTask(task:Task) {
    for (const session of state.sessions.filter(s=>s.taskId===task.id && !s.endedAt)) { const end=Math.max(now,Date.parse(session.startedAt)); session.endedAt=iso(end); task.actualSeconds+=(end-Date.parse(session.startedAt))/1000; }
    if (task.status==='in_progress') task.status='paused';
  }
  // Gives a task a fixed time on the plan (or clears it). The scheduler keeps fixed task
  // blocks where they are and plans every other task around them.
  function setTaskTime(task:Task,startLocal:string|null,endLocal:string|null) {
    if (pinned.has(task.id)) invalid('The model proposed conflicting times for the same task.'); pinned.add(task.id);
    if (['completed','deferred'].includes(task.status)) invalid('Reopen the task before giving it a time.');
    const previous=state.existing.filter(b=>b.taskId===task.id && Date.parse(b.end)>now).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))[0];
    const oldDate=task.scheduledDate ?? date;
    if (startLocal===null) {
      if (!previous?.fixed) invalid('This task does not have a set time.');
      releaseFuture(task.id); dates.add(oldDate);
      pinChanges.push({kind:'task',id:`${task.id}:time`,title:task.title,action:'unschedule',before:{start:previous.start,end:previous.end},after:{}});
      return;
    }
    let start=0,end:number|undefined;
    try { start=Date.parse(parseLocalInput(startLocal,state.settings.timeZone)); if (endLocal!==null) end=Date.parse(parseLocalInput(endLocal,state.settings.timeZone)); }
    catch { invalid('That time is invalid or ambiguous in your workday timezone.'); }
    if (start<now) invalid('That time has already passed.');
    const spentMinutes=Math.ceil(spentSeconds(task,state.sessions,now)/60);
    if (end===undefined) {
      const remaining=Math.max(0,task.estimatedMinutes-spentMinutes);
      if (!remaining) invalid('This task has no time left in its estimate. Add time to it first.');
      end=start+remaining*60_000;
    } else {
      if (end<=start) invalid('The end time must be after the start time.');
      // A stated end time sets how long the task takes from here.
      task.estimatedMinutes=Math.min(1440,spentMinutes+Math.ceil((end-start)/60_000));
    }
    const day=workDate(start,state.settings), window=workWindow(day,state.settings);
    if (!window.working || start<window.start || end>window.end) invalid('That time is outside your working hours.');
    if (state.events.some(e=>e.busy && Date.parse(e.start)<end! && Date.parse(e.end)>start)) invalid('That time overlaps a meeting.');
    if (task.status==='in_progress' && start>now) closeTask(task);
    releaseFuture(task.id);
    task.scheduledDate=day; task.updatedAt=iso(now); dates.add(oldDate); dates.add(day);
    state.existing.push({id:`task:${task.id}:set:${start}`,taskId:task.id,kind:'task',start:iso(start),end:iso(end),fixed:true,title:task.title,planDate:day});
    pinChanges.push({kind:'task',id:`${task.id}:time`,title:task.title,action:'schedule',before:previous?{start:previous.start,end:previous.end}:null,after:{start:iso(start),end:iso(end)}});
  }
  function releaseFuture(taskId:string) { state.existing=state.existing.filter(b=>b.taskId!==taskId || Date.parse(b.start)<now).map(b=>b.taskId===taskId && Date.parse(b.end)>now ? {...b,end:iso(now)} : b); }
  // Create records first so dependency references can point to other newly proposed tasks.
  for (const action of response.actions) if (action.type==='create_task') {
    const id=createdIds.get(action.clientId); if (!id || state.tasks.some(t=>t.id===id)) invalid('A proposed task ID conflicts with existing data.');
    const task:Task={id,title:action.title,description:action.description,priority:action.priority,category:action.category,status:'todo',estimatedMinutes:action.estimatedMinutes,actualSeconds:0,scheduledDate:action.scheduledDate ?? date,deadline:action.deadline ?? undefined,dependencyIds:action.dependencyIds.map(resolve),source:'ai',createdAt:iso(now),updatedAt:iso(now)};
    state.tasks.push(task); dates.add(task.scheduledDate!); mutated.add(id);
  }
  for (let index=0; index<response.actions.length; index++) {
    const action=response.actions[index];
    if (action.type==='create_task') continue;
    if (action.type==='reschedule') { dates.add(action.date); continue; }
    if (action.type==='create_meeting') {
      let start:string,end:string;try{start=parseLocalInput(action.startLocal,state.settings.timeZone);end=parseLocalInput(action.endLocal,state.settings.timeZone);}catch{invalid('Meeting times are invalid or ambiguous in your workday timezone.');}
      if (Date.parse(end)<=Date.parse(start) || Date.parse(end)-Date.parse(start)>7*86400_000) invalid('Meeting end must be after its start and within seven days.');
      const id=createdIds.get(`meeting:${index}`); if (!id) invalid('The proposed meeting has no valid identity.');
      state.events.push({id,title:action.title,start,end,timeZone:state.settings.timeZone,busy:true,source:'manual'});
      changes.push({kind:'meeting',id,title:action.title,before:null,after:{title:action.title,start,end,timeZone:state.settings.timeZone}});
      let day=workDate(Date.parse(start),state.settings);const last=workDate(Date.parse(end)-1,state.settings);
      for(let i=0;day<=last&&i<8;i++,day=addDays(day,1))dates.add(day);
      dates.add(date);continue;
    }
    if (action.type==='update_meeting' || action.type==='delete_meeting') {
      const event=state.events.find(e=>e.id===action.meetingId); if (!event) invalid('The model referenced a meeting that does not exist.');
      if (touchedMeetings.has(event.id)) invalid('The model proposed conflicting actions for the same meeting.'); touchedMeetings.add(event.id);
      const old={title:event.title,start:event.start,end:event.end,timeZone:event.timeZone};
      const affect=(from:string,to:string)=>{let day=workDate(Date.parse(from),state.settings);const last=workDate(Date.parse(to)-1,state.settings);for(let i=0;day<=last&&i<8;i++,day=addDays(day,1))dates.add(day);};
      affect(event.start,event.end); dates.add(date);
      // Free the time this meeting held; affected days are rescheduled below.
      state.existing=state.existing.filter(b=>b.calendarEventId!==event.id);
      if (action.type==='delete_meeting') { state.events=state.events.filter(e=>e.id!==event.id); changes.push({kind:'meeting',id:event.id,title:event.title,before:old,after:{},removed:true}); continue; }
      if (action.title===null && action.startLocal===null && action.endLocal===null) invalid('The model proposed an empty meeting update.');
      let start=event.start,end=event.end;
      try {
        if (action.startLocal!==null) start=parseLocalInput(action.startLocal,state.settings.timeZone);
        // Moving only the start keeps the meeting's length.
        end=action.endLocal!==null ? parseLocalInput(action.endLocal,state.settings.timeZone) : action.startLocal!==null ? iso(Date.parse(start)+Date.parse(event.end)-Date.parse(event.start)) : event.end;
      } catch { invalid('Meeting times are invalid or ambiguous in your workday timezone.'); }
      if (Date.parse(end)<=Date.parse(start) || Date.parse(end)-Date.parse(start)>7*86400_000) invalid('Meeting end must be after its start and within seven days.');
      Object.assign(event,{title:action.title ?? event.title,start,end});
      changes.push({kind:'meeting',id:event.id,title:event.title,before:old,after:{title:event.title,start,end,timeZone:event.timeZone}});
      affect(start,end); continue;
    }
    const id=resolve(action.taskId), task=state.tasks.find(t=>t.id===id); if (!task) invalid('The referenced task no longer exists.');
    // A note never conflicts with other changes to the same task and never moves the schedule.
    if (action.type==='add_note') { task.notes=[task.notes,action.note].filter(Boolean).join('\n'); task.updatedAt=iso(now); mutated.add(id); continue; }
    if (action.type==='schedule_task') { setTaskTime(task,action.startLocal,action.endLocal); continue; }
    if (mutated.has(id)) invalid('The model proposed conflicting actions for the same task.'); mutated.add(id);
    dates.add(task.scheduledDate ?? date);
    if (action.type==='update_task') {
      const p=action.patch;
      if ((p.clearDeadline && p.deadline) || (p.clearScheduledDate && p.scheduledDate)) invalid('The model proposed contradictory date changes.');
      if (!Object.values(p).some(v=>v!==null && v!==false)) invalid('The model proposed an empty task update.');
      for (const key of ['title','description','estimatedMinutes','priority','category'] as const) if (p[key]!==null) Object.assign(task,{[key]:p[key]});
      if (p.scheduledDate!==null || p.clearScheduledDate) { closeTask(task); task.scheduledDate=p.clearScheduledDate ? undefined : p.scheduledDate!; if(p.clearScheduledDate)task.status='deferred'; releaseFuture(task.id); }
      if (p.deadline!==null || p.clearDeadline) task.deadline=p.clearDeadline ? undefined : p.deadline!;
    } else if (action.type==='complete_task') {
      if (task.status==='completed') invalid('This task is already completed.'); closeTask(task); task.status='completed'; task.completedAt=iso(now); releaseFuture(id);
    } else if (action.type==='defer_task') {
      closeTask(task); task.status=action.scheduledDate ? 'todo':'deferred'; task.scheduledDate=action.scheduledDate ?? task.scheduledDate; task.completedAt=undefined; releaseFuture(id);
    } else if (action.type==='extend_task') {
      if (['completed','deferred'].includes(task.status)) invalid('Reopen the task before adding focus time.');
      task.estimatedMinutes=Math.max(task.estimatedMinutes,Math.ceil(spentSeconds(task,state.sessions,now)/60))+action.minutes;
    }
    task.updatedAt=iso(now); dates.add(task.scheduledDate ?? date);
  }
  // Checked after every action so a swap (A to B's time, B to A's) is not rejected midway.
  for (const id of pinned) {
    const task=state.tasks.find(t=>t.id===id)!;
    if (['completed','deferred'].includes(task.status)) invalid('The model proposed conflicting actions for the same task.');
    const block=state.existing.find(b=>b.taskId===id && b.fixed && b.id.includes(':set:'));
    if (block && state.existing.some(b=>b!==block && b.kind==='task' && b.fixed && b.taskId!==id && Date.parse(b.end)>now && Date.parse(b.start)<Date.parse(block.end) && Date.parse(b.end)>Date.parse(block.start))) invalid('Two tasks were given overlapping times.');
  }
  for (const task of state.tasks) {
    if (!mutated.has(task.id) && !pinned.has(task.id)) continue;
    if (!taskInput.safeParse(task).success) invalid('A task action violates the allowed task fields or duration limits.');
    for (const dependency of task.dependencyIds) if (!state.tasks.some(t=>t.id===dependency)) invalid('A proposed prerequisite does not exist.');
    changes.push({kind:'task',id:task.id,title:task.title,before:before.has(task.id) ? taskSummary(before.get(task.id)!) : null,after:taskSummary(task)});
  }
  const visiting=new Set<string>(),visited=new Set<string>();
  function visit(id:string) { if (visiting.has(id)) invalid('The proposal creates a task dependency cycle.'); if (visited.has(id)) return; visiting.add(id); for (const dep of state.tasks.find(t=>t.id===id)?.dependencyIds ?? []) visit(dep); visiting.delete(id);visited.add(id); }
  for (const id of mutated) visit(id);
  if (dates.size>7) invalid('Limit one proposal to seven affected workdays.');
  const plans:ScheduleResult[]=[];
  for (const planDate of [...dates].sort()) {
    const result=scheduleDay({...state,date:planDate,now}); plans.push(result);
    state.existing=state.existing.filter(b=>b.planDate!==planDate && !(!b.planDate && b.end>result.start && b.start<result.end)); state.existing.push(...result.blocks);
    const scheduled=new Set(result.blocks.filter(b=>b.kind==='task').map(b=>b.taskId));
    for (const task of state.tasks) if (!task.scheduledDate && scheduled.has(task.id)) task.scheduledDate=planDate;
  }
  const taskChanges=state.tasks.filter(t=>!before.has(t.id)||JSON.stringify(taskSummary(before.get(t.id)!))!==JSON.stringify(taskSummary(t))).map(t=>({kind:'task' as const,id:t.id,title:t.title,before:before.has(t.id)?taskSummary(before.get(t.id)!):null,after:taskSummary(t)}));
  return {state,changes:[...changes.filter(c=>c.kind==='meeting'),...pinChanges,...taskChanges],plans};
}
export function prepareProposal(base:WorkdaySnapshot,response:AssistantResponse,date:string,allowedTaskIds:string[],userMessageId:string,now=Date.now()):AIProposal {
  const parsed=assistantResponseSchema.safeParse(response); if (!parsed.success) invalid('The model returned an unsupported action.');
  const names=new Set<string>(),ids:[string,string][]=[];
  for (let index=0; index<response.actions.length; index++) { const a=response.actions[index]; if (a.type==='create_task') { if (names.has(a.clientId) || base.tasks.some(t=>t.id===a.clientId)) invalid('New task references must be unique.');names.add(a.clientId);ids.push([a.clientId,crypto.randomUUID()]); } else if(a.type==='create_meeting')ids.push([`meeting:${index}`,crypto.randomUUID()]); }
  const projected=projectActions(base,parsed.data,date,allowedTaskIds,ids,now);
  return {id:crypto.randomUUID(),userMessageId,response:parsed.data,signature:JSON.stringify(base),createdAt:now,status:'pending',date,allowedTaskIds,ids,changes:projected.changes,taskTitles:Object.fromEntries(projected.state.tasks.map(t=>[t.id,redactSecrets(t.title)])),plans:projected.plans};
}
export async function approveAIProposal(id:string,database:WorkdayDB=db,now=Date.now()) {
  await database.transaction('rw',database.tables,async()=>{
    const proposal=await database.aiProposals.get(id);
    if (!proposal || proposal.status!=='pending') throw new AIError('stale','This proposal has already been resolved or removed.');
    if (now-proposal.createdAt>60_000 || now<proposal.createdAt) throw new AIError('stale','This proposal expired. Refresh its preview before approval.');
    const base=await snapshot(database); if(JSON.stringify(base)!==proposal.signature)throw new AIError('stale','Your tasks, meetings, focus or work settings changed. Refresh the preview before approval.');
    const {state,plans}=projectActions(base,assistantResponseSchema.parse(proposal.response),proposal.date,proposal.allowedTaskIds,proposal.ids,now);
    await database.tasks.bulkPut(state.tasks);await database.sessions.bulkPut(state.sessions);await database.events.bulkPut(state.events);
    // Meetings removed by the proposal. The snapshot check above guarantees nothing else changed.
    const kept=new Set(state.events.map(e=>e.id));await database.events.bulkDelete((await database.events.toArray()).filter(e=>!kept.has(e.id)).map(e=>e.id));
    await database.blocks.clear();await database.blocks.bulkPut(state.existing);
    const signature=planFingerprint(state);
    for(const plan of plans)await database.plans.put({date:plan.date,timeZone:plan.timeZone,start:plan.start,end:plan.end,overflow:plan.overflow,warnings:plan.warnings,approvedAt:iso(now),signature});
    for(const reminder of await database.reminders.toArray())if(!reminder.deliveredAt&&!reminder.handledAt)await database.reminders.delete(reminder.id);
    await database.aiProposals.update(id,{status:'approved',resolvedAt:iso(now)});
  });notifyBackground();
}
export async function rejectAIProposal(id:string,database=db) { await database.transaction('rw',database.aiProposals,async()=>{const p=await database.aiProposals.get(id);if(p?.status==='pending')await database.aiProposals.update(id,{status:'rejected',resolvedAt:iso(Date.now())});}); }
export async function refreshAIProposal(id:string,database=db,now=Date.now()) {
  return database.transaction('rw',database.tables,async()=>{const old=await database.aiProposals.get(id);if(!old||old.status!=='pending')throw new AIError('stale','This proposal is no longer pending.');const base=await snapshot(database);const projected=projectActions(base,assistantResponseSchema.parse(old.response),old.date,old.allowedTaskIds,old.ids,now);const next={...old,createdAt:now,signature:JSON.stringify(base),changes:projected.changes,taskTitles:Object.fromEntries(projected.state.tasks.map(t=>[t.id,redactSecrets(t.title)])),plans:projected.plans};await database.aiProposals.put(next);return next;});
}
