import * as chatgpt from '../src/services/ai/chatgpt';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { WorkdayDB, saveSettings, saveTask } from '../src/storage/db';
import { defaultSettings } from '../src/shared/settings';
import { getAIView, getPublicAIConfig, getProviderSelection, saveAIConfig, setActiveProvider, forgetAIKey, refreshModels } from '../src/services/ai/config';
import { sendChat, clearChat } from '../src/services/ai/chat';
import { exportWorkData } from '../src/storage/export';
import type { AIProvider, ProviderId } from '../src/services/ai/provider';
import { AI_DATE, AI_NOW, AI_KEY, answer, createAction, model } from './ai-fixtures';
const OPENAI_KEY='sk-proj-test-only-not-a-real-openai-key';
const GEMINI_KEY='AIza-test-only-not-a-real-google-api-key';
const keys={openrouter:AI_KEY,openai:OPENAI_KEY,gemini:GEMINI_KEY,claude:'sk-ant-test-only-not-a-real-claude-key'};
const options={text:'Plan my day.',date:AI_DATE,scope:'day' as const,includeDescriptions:false};
let db:WorkdayDB;
function mock(response=answer()):AIProvider {return {listModels:vi.fn(async()=>[model]),complete:vi.fn(async()=>({response,attempts:1}))};}
beforeEach(async()=>{db=new WorkdayDB(`provider-isolation-${crypto.randomUUID()}`);await saveSettings({...defaultSettings(),timeZone:'UTC'},db);vi.spyOn(Date,'now').mockReturnValue(AI_NOW);});
afterEach(async()=>{await db.delete();vi.restoreAllMocks();});
async function configure(id:Exclude<ProviderId,'chatgpt'>){await setActiveProvider(id,db);await saveAIConfig({key:keys[id],modelId:id==='gemini'?'models/gemini-test':`${id}-test`,consent:true},db);}
it('keeps independent keys, models and consent; forgetting one key preserves other providers',async()=>{
 for(const id of ['openrouter','openai','gemini'] as const)await configure(id);
 expect((await getProviderSelection(db)).providerId).toBe('gemini');expect((await getPublicAIConfig(db)).modelId).toBe('gemini-test');
 await forgetAIKey(db);expect((await getPublicAIConfig(db)).hasKey).toBe(false);expect((await getPublicAIConfig(db)).consent).toBe(false);
 await setActiveProvider('openai',db);expect((await getPublicAIConfig(db)).hasKey).toBe(true);expect((await db.aiConfig.get('openai'))?.apiKey).toBe(OPENAI_KEY);expect((await getAIView(db)).providerId).toBe('openai');
 await setActiveProvider('openrouter',db);expect((await db.aiConfig.get('openrouter'))?.apiKey).toBe(AI_KEY);expect(await db.aiConfig.count()).toBe(3);
});
it('discovers with unsaved credentials without persisting them or mixing model caches',async()=>{
 await setActiveProvider('openai',db);const p=mock();await refreshModels(p,db,undefined,{apiKey:OPENAI_KEY});expect(vi.mocked(p.listModels).mock.calls[0][1]).toBe(OPENAI_KEY);expect(await db.aiConfig.count()).toBe(0);expect(await db.modelCache.get('openai')).toBeDefined();
 await setActiveProvider('gemini',db);await expect(refreshModels(p,db)).rejects.toMatchObject({code:'configuration'});expect(vi.mocked(p.listModels)).toHaveBeenCalledTimes(1);
 await refreshModels(p,db,undefined,{apiKey:GEMINI_KEY});expect(await db.modelCache.count()).toBe(2);
});
it('sends only the active key and same-provider conversation; redacts every saved provider key',async()=>{
 for(const id of ['openrouter','openai','gemini'] as const)await configure(id);
 await setActiveProvider('openai',db);await sendChat({...options,text:'OPENAI PRIVATE CONVERSATION'},mock(),db);
 await setActiveProvider('gemini',db);const p=mock();await sendChat({...options,text:`Please redact ${OPENAI_KEY} ${GEMINI_KEY} ${AI_KEY}`},p,db);
 const request=vi.mocked(p.complete).mock.calls[0][0];expect(request.apiKey).toBe(GEMINI_KEY);expect(JSON.stringify(request.messages)).not.toContain('OPENAI PRIVATE CONVERSATION');for(const key of Object.values(keys))expect(JSON.stringify(request.messages)).not.toContain(key);
 expect((await db.chatMessages.toArray()).filter(m=>m.providerId==='gemini')).toHaveLength(2);
});
it('clearing one conversation preserves other provider history and approved work',async()=>{
 await configure('openai');await sendChat(options,mock(answer(createAction())),db);
 await configure('gemini');await sendChat(options,mock(),db);
 await clearChat(db,'gemini');expect(await db.chatMessages.count()).toBe(2);expect(await db.aiProposals.count()).toBe(1);expect((await db.chatMessages.toArray()).every(m=>m.providerId==='openai')).toBe(true);
});
it('rejects late responses after a provider switch, even if it switches back',async()=>{
 await configure('openai');const p=mock(answer(createAction()));vi.mocked(p.complete).mockImplementationOnce(async()=>{await setActiveProvider('gemini',db);await setActiveProvider('openai',db);return {response:answer(createAction()),attempts:1};});
 await expect(sendChat(options,p,db)).rejects.toMatchObject({code:'cancelled'});expect(await db.tasks.count()).toBe(0);expect(await db.aiProposals.count()).toBe(0);expect((await db.chatMessages.toArray())[0].status).toBe('cancelled');
});
it('will not retry another provider’s interrupted request with the current key',async()=>{
 await configure('openai');const p=mock();vi.mocked(p.complete).mockRejectedValueOnce(new Error('Interrupted'));await expect(sendChat(options,p,db)).rejects.toThrow();const user=(await db.chatMessages.toArray())[0];
 await configure('gemini');const next=mock();await expect(sendChat({...options,retryId:user.id},next,db)).rejects.toMatchObject({code:'stale'});expect(next.complete).not.toHaveBeenCalled();
});
it('exports exclude every provider key, preference, cache, conversation and proposal',async()=>{
 for(const id of ['openrouter','openai','gemini'] as const)await configure(id);
 await saveTask({title:OPENAI_KEY,description:GEMINI_KEY,status:'todo',priority:'high',estimatedMinutes:30},undefined,db);
 const exported=await exportWorkData(db);for(const key of Object.values(keys))expect(exported).not.toContain(key);const data=JSON.parse(exported);expect(data.version).toBe(4);for(const table of ['aiConfig','aiPreferences','modelCache','chatMessages','aiProposals'])expect(data[table]).toBeUndefined();
});
it('migrates a v3 OpenRouter installation without losing credentials, cache or conversation',async()=>{
 const name=`legacy-provider-${crypto.randomUUID()}`,legacy=new Dexie(name);legacy.version(3).stores({tasks:'id, status, scheduledDate, createdAt',blocks:'id, taskId, start, planDate',sessions:'id, taskId, startedAt',events:'id, externalId, start',settings:'id',plans:'date',reminders:'id, at, taskId, date',aiConfig:'id',modelCache:'id',chatMessages:'id, createdAt, inReplyTo',aiProposals:'id, status, userMessageId'});
 await legacy.table('aiConfig').put({id:'openrouter',apiKey:AI_KEY,modelId:model.id,consent:true});await legacy.table('modelCache').put({id:'openrouter',models:[model],fetchedAt:new Date(AI_NOW).toISOString()});await legacy.table('chatMessages').put({id:'user',role:'user',text:'Legacy chat',createdAt:new Date(AI_NOW).toISOString(),status:'answered'});legacy.close();
 const upgraded=new WorkdayDB(name);try{expect(await getPublicAIConfig(upgraded)).toEqual({hasKey:true,modelId:model.id,consent:true});expect((await upgraded.aiConfig.get('openrouter'))?.apiKey).toBe(AI_KEY);expect((await getProviderSelection(upgraded)).providerId).toBe('openrouter');expect(await upgraded.chatMessages.count()).toBe(1);expect(await upgraded.modelCache.count()).toBe(1);await setActiveProvider('gemini',upgraded);expect((await getPublicAIConfig(upgraded)).hasKey).toBe(false);expect(await upgraded.aiConfig.count()).toBe(1);}finally{await upgraded.delete();}
});
it('redacts keys echoed in catalog names and refuses credential-shaped model IDs',async()=>{
 await configure('openai');const p=mock();vi.mocked(p.listModels).mockResolvedValueOnce([{...model,id:'gpt-test',name:OPENAI_KEY}]);await refreshModels(p,db);expect(JSON.stringify(await db.modelCache.get('openai'))).not.toContain(OPENAI_KEY);
 vi.mocked(p.listModels).mockResolvedValueOnce([{...model,id:OPENAI_KEY}]);await expect(refreshModels(p,db)).rejects.toMatchObject({code:'invalid_response'});expect((await db.modelCache.get('openai'))?.models[0].id).toBe('gpt-test');
});

it('keeps ChatGPT history scoped to the selected account and forwards no API key',async()=>{
 const accountA=crypto.randomUUID(),accountB=crypto.randomUUID();
 vi.spyOn(chatgpt,'chatGPTStatus').mockResolvedValue({accounts:[accountA,accountB].map(id=>({id,label:id,connected:true,planEnabled:true,welcomeAcknowledged:true})),pending:null,result:null});
 await setActiveProvider('chatgpt',db);
 const configureAccount=async(accountId:string)=>db.aiConfig.put({id:'chatgpt',apiKey:'',accountId,connected:true,modelId:'chatgpt-test',consent:true,revision:crypto.randomUUID()});
 await configureAccount(accountA);await sendChat({...options,text:'ACCOUNT A PRIVATE CHAT'},mock(),db);
 await configureAccount(accountB);const p=mock();await sendChat({...options,text:'ACCOUNT B REQUEST'},p,db);
 const request=vi.mocked(p.complete).mock.calls[0][0];expect(request.accountId).toBe(accountB);expect(request.apiKey).toBe('');expect(JSON.stringify(request.messages)).not.toContain('ACCOUNT A PRIVATE CHAT');
 expect((await db.chatMessages.toArray()).filter(m=>m.accountId===accountA)).toHaveLength(2);
 const pending=mock(answer(createAction()));vi.mocked(pending.complete).mockImplementationOnce(async()=>{await configureAccount(accountA);return {response:answer(createAction()),attempts:1};});
 await expect(sendChat(options,pending,db)).rejects.toMatchObject({code:'cancelled'});expect(await db.aiProposals.count()).toBe(0);expect(await db.tasks.count()).toBe(0);
});
