import 'fake-indexeddb/auto';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import Dexie from 'dexie';
import { WorkdayDB,saveSettings,saveTask } from '../src/storage/db';
import { defaultSettings } from '../src/shared/settings';
import { getPublicAIConfig,saveAIConfig,forgetAIKey,refreshModels } from '../src/services/ai/config';
import { clearChat,sendChat } from '../src/services/ai/chat';
import { buildAIContext,providerMessages } from '../src/services/ai/context';
import { snapshot } from '../src/services/scheduling/service';
import { exportWorkData } from '../src/storage/export';
import { AIError } from '../src/services/ai/schema';
import type { AIProvider } from '../src/services/ai/provider';
import { AI_DATE,AI_KEY,AI_NOW,answer,createAction,model } from './ai-fixtures';
let db:WorkdayDB;
const options={text:'Plan my day.',date:AI_DATE,scope:'day' as const,includeDescriptions:false};
function provider(response=answer(createAction())):AIProvider{return {listModels:vi.fn(async()=>[model]),complete:vi.fn(async()=>({response,attempts:1}))};}
beforeEach(async()=>{db=new WorkdayDB(`ai-chat-${crypto.randomUUID()}`);await saveSettings({...defaultSettings(),timeZone:'UTC'},db);await saveAIConfig({key:AI_KEY,modelId:model.id,consent:true},db);vi.spyOn(Date,'now').mockReturnValue(AI_NOW);});
afterEach(async()=>{await db.delete();vi.restoreAllMocks();});
it('stores settings separately, masks saved credentials and excludes AI data from exports',async()=>{
 expect(await getPublicAIConfig(db)).toEqual({hasKey:true,modelId:model.id,consent:true});
 await saveTask({title:`Never export ${AI_KEY}`,description:'',status:'todo',priority:'medium',estimatedMinutes:30},undefined,db);
 await sendChat(options,provider(),db);
 const exported=await exportWorkData(db),data=JSON.parse(exported);expect(exported).not.toContain(AI_KEY);expect(exported).not.toContain('apiKey');expect(data.aiConfig).toBeUndefined();expect(data.chatMessages).toBeUndefined();expect(data.aiProposals).toBeUndefined();
 await forgetAIKey(db);expect((await getPublicAIConfig(db)).hasKey).toBe(false);await expect(sendChat(options,provider(),db)).rejects.toMatchObject({code:'configuration'});
});
it('creates a persisted conversation/proposal without mutating tasks and allows cached model discovery',async()=>{
 const p=provider();await refreshModels(p,db);await sendChat(options,p,db);
 expect(await db.modelCache.count()).toBe(1);expect(await db.chatMessages.count()).toBe(2);expect(await db.aiProposals.count()).toBe(1);expect(await db.tasks.count()).toBe(0);expect(await db.blocks.count()).toBe(0);
 const messages=await db.chatMessages.toArray();expect(JSON.stringify(messages)).not.toContain(AI_KEY);expect(messages.every(m=>m.status==='answered')).toBe(true);
});
it('returns answers without creating empty proposals',async()=>{
 await sendChat(options,provider(answer()),db);expect(await db.aiProposals.count()).toBe(0);expect(await db.chatMessages.count()).toBe(2);
});
it('shares bounded relevant context while omitting credentials, descriptions, meeting titles and reminder settings',async()=>{
 await saveTask({title:'Review API',description:`PRIVATE DESCRIPTION ${AI_KEY}`,status:'todo',priority:'high',estimatedMinutes:30,scheduledDate:AI_DATE},undefined,db);
 await db.events.add({id:'meeting',title:'PRIVATE MEETING',source:'manual',start:`${AI_DATE}T10:00:00Z`,end:`${AI_DATE}T11:00:00Z`,timeZone:'UTC',busy:true});
 const p=provider(answer());await sendChat(options,p,db);const request=JSON.stringify(vi.mocked(p.complete).mock.calls[0][0].messages);
 expect(request).not.toContain(AI_KEY);expect(request).not.toContain('PRIVATE DESCRIPTION');expect(request).not.toContain('PRIVATE MEETING');expect(request).not.toContain('notificationsEnabled');expect(request).toContain('Review API');expect(request).toContain('\\"meetings\\":[{');
 const context=buildAIContext(await snapshot(db),{...options,includeDescriptions:true},AI_NOW);expect(context.tasks[0].description).toContain('PRIVATE DESCRIPTION');expect(JSON.stringify(providerMessages(context,options.text,[],AI_KEY))).not.toContain(AI_KEY);
});
it('redacts credentials echoed by even a replacement provider adapter',async()=>{
 await sendChat({...options,text:`Do not show ${AI_KEY}`},provider({reply:`Key ${AI_KEY}`,actions:[createAction({title:`Task ${AI_KEY}`})]}),db);
 expect(JSON.stringify(await db.chatMessages.toArray())).not.toContain(AI_KEY);expect(JSON.stringify((await db.aiProposals.toArray())[0].response)).not.toContain(AI_KEY);
});
it('requires consent and handles invalid responses without creating task/proposal data',async()=>{
 await saveAIConfig({modelId:model.id,consent:false},db);await expect(sendChat(options,provider(),db)).rejects.toMatchObject({code:'configuration'});expect(await db.chatMessages.count()).toBe(0);
 await saveAIConfig({modelId:model.id,consent:true},db);const p=provider();vi.mocked(p.complete).mockResolvedValueOnce({response:{reply:'ok',actions:[{type:'delete_database'}]} as never,attempts:1});await expect(sendChat(options,p,db)).rejects.toMatchObject({code:'invalid_response'});expect(await db.tasks.count()).toBe(0);expect(await db.aiProposals.count()).toBe(0);expect((await db.chatMessages.toArray())[0].status).toBe('error');
});
it('does not resurrect cleared chat or forget-key state when a late response arrives',async()=>{
 for(const action of ['chat','key']){
  if(action==='key')await saveAIConfig({key:AI_KEY,modelId:model.id,consent:true},db);
  const p=provider();vi.mocked(p.complete).mockImplementationOnce(async()=>{if(action==='chat')await clearChat(db);else await forgetAIKey(db);return {response:answer(createAction()),attempts:1};});
  await expect(sendChat(options,p,db)).rejects.toMatchObject({code:'cancelled'});expect(await db.aiProposals.count()).toBe(0);expect(await db.tasks.count()).toBe(0);if(action==='chat')expect(await db.chatMessages.count()).toBe(0);
 }
});
it('detects workday changes during provider latency instead of acting on stale context',async()=>{
 const p=provider();vi.mocked(p.complete).mockImplementationOnce(async()=>{await saveTask({title:'Changed during request',description:'',status:'todo',priority:'high',estimatedMinutes:30},undefined,db);return {response:answer(createAction()),attempts:1};});
 await expect(sendChat(options,p,db)).rejects.toMatchObject({code:'stale'});expect(await db.aiProposals.count()).toBe(0);expect(await db.tasks.count()).toBe(1);
});
it('supports explicit cancellation and retry using fresh context without duplicate answers',async()=>{
 const controller=new AbortController(),p=provider();vi.mocked(p.complete).mockImplementationOnce(async()=>{controller.abort();return {response:answer(),attempts:1};});
 await expect(sendChat({...options,signal:controller.signal},p,db)).rejects.toMatchObject({code:'cancelled'});const old=(await db.chatMessages.toArray())[0];expect(old.status).toBe('cancelled');
 await sendChat({...options,retryId:old.id},provider(answer()),db);expect(await db.chatMessages.count()).toBe(2);await expect(sendChat({...options,retryId:old.id},provider(),db)).rejects.toMatchObject({code:'stale'});
});
it('sanitizes unexpected errors before storing or rethrowing them',async()=>{
 const p=provider();vi.mocked(p.complete).mockRejectedValueOnce(new Error(AI_KEY));let error:unknown;
 try{await sendChat(options,p,db);}catch(e){error=e;}
 expect(error).toBeInstanceOf(AIError);expect(String(error)).not.toContain(AI_KEY);expect(JSON.stringify(await db.chatMessages.toArray())).not.toContain(AI_KEY);
});
it('upgrades a v2 database while retaining active sessions and work settings',async()=>{
 const name=`legacy-ai-${crypto.randomUUID()}`,old=new Dexie(name);old.version(2).stores({tasks:'id, status, scheduledDate, createdAt',blocks:'id, taskId, start, planDate',sessions:'id, taskId, startedAt',events:'id, externalId, start',settings:'id',plans:'date',reminders:'id, at, taskId, date'});
 await old.table('sessions').put({id:'session',taskId:'task',startedAt:new Date(AI_NOW).toISOString()});await old.table('settings').put({...defaultSettings(),timeZone:'UTC'});old.close();
 const upgraded=new WorkdayDB(name);try{expect(await upgraded.sessions.count()).toBe(1);expect(await upgraded.aiConfig.count()).toBe(0);expect((await upgraded.settings.get('workday'))?.timeZone).toBe('UTC');}finally{await upgraded.delete();}
});
it('preserves conversation order when multiple messages share the same timestamp',async()=>{
 await sendChat(options,provider(answer()),db);await sendChat({...options,text:'What next?'},provider(answer()),db);
 const messages=(await db.chatMessages.toArray()).sort((a,b)=>(a.sequence??0)-(b.sequence??0));expect(messages.map(m=>m.role)).toEqual(['user','assistant','user','assistant']);
});
it('a retried interrupted request supersedes its late original response',async()=>{
 let finish!: (result:Awaited<ReturnType<AIProvider['complete']>>)=>void;const slow=provider();vi.mocked(slow.complete).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const first=sendChat(options,slow,db);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 const user=(await db.chatMessages.toArray())[0];await sendChat({...options,retryId:user.id},provider(answer()),db);
 finish({response:answer(createAction()),attempts:1});await expect(first).rejects.toMatchObject({code:'cancelled'});
 expect(await db.chatMessages.count()).toBe(2);expect(await db.aiProposals.count()).toBe(0);expect((await db.chatMessages.get(user.id))?.status).toBe('answered');
});
