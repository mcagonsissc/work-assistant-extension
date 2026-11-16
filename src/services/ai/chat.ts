import { chatGPTStatus } from './chatgpt';
import { z } from 'zod';
import { db, type WorkdayDB } from '../../storage/db';
import { snapshot } from '../scheduling/service';
import { iso } from '../scheduling/time';
import { buildAIContext, providerMessages, type ContextOptions } from './context';
import { getProvider } from './registry';
import { getProviderSelection } from './config';
import { providerLabels, type ProviderId } from './provider';
import type { AIProvider } from './provider';
import { AIError, parseAssistantResponse, redactSecrets } from './schema';
import { prepareProposal } from './proposals';
import type { ChatMessage } from './types';
export function sortChat(messages:ChatMessage[]) {return [...messages].sort((a,b)=>(a.sequence??0)-(b.sequence??0)||a.createdAt.localeCompare(b.createdAt)||Number(a.role==='assistant')-Number(b.role==='assistant')||a.id.localeCompare(b.id));}
export function safeAIError(error:unknown) { return error instanceof AIError ? error.message : 'The AI request could not be completed. No task changes were applied. Retry or use the manual planner.'; }
export async function sendChat(options:ContextOptions & {text:string;retryId?:string;signal?:AbortSignal}, provider:AIProvider|undefined=undefined,database:WorkdayDB=db) {
  if ((await getProviderSelection(database)).providerId === 'chatgpt') {
    const saved = await database.aiConfig.get('chatgpt');
    const account = (await chatGPTStatus()).accounts.find(a => a.id === saved?.accountId);
    if (!account?.connected || !account.planEnabled) throw new AIError('auth', 'Reconnect your ChatGPT plan in Settings.');
  }
  const requestId=options.retryId ?? crypto.randomUUID(), attemptId=crypto.randomUUID();
  try {
    const loaded=await database.transaction('rw',database.tables,async()=>{
      const selection=await getProviderSelection(database);
      const config=await database.aiConfig.get(selection.providerId);
      const secrets=(await database.aiConfig.toArray()).map(c=>c.apiKey).filter(Boolean);
      if(!config || !(selection.providerId==='chatgpt' ? config.connected && config.accountId : config.apiKey)||!config.modelId||!config.consent)throw new AIError('configuration',`Configure your ${providerLabels[selection.providerId]} connection, model and data-sharing consent in Settings first.`);
      const text=redactSecrets(options.text.trim(),secrets);
      if(!z.string().min(1).max(6000).safeParse(text).success)throw new AIError('configuration','Enter a request between 1 and 6000 characters.');
      const old=await database.chatMessages.get(requestId);
      if(options.retryId && (!old || old.role!=='user' || old.status==='answered'))throw new AIError('stale','This request is already answered or no longer exists.');
      if(options.retryId && (await database.aiProposals.where('userMessageId').equals(requestId).count()))throw new AIError('stale','This request already has a proposal. Review it instead of retrying.');
      const base=await snapshot(database), history=sortChat(await database.chatMessages.toArray());
      if(old && ((old.providerId??'openrouter')!==selection.providerId || old.accountId!==config.accountId))throw new AIError('stale','Switch back to the original provider to retry this request.');
      const catalog=await database.modelCache.get(selection.providerId);
      const selected=catalog?.models.find(m=>m.id===config.modelId);
      await database.chatMessages.put({id:requestId,role:'user',text,createdAt:old?.createdAt ?? iso(Date.now()),status:'pending',attemptId,accountId:config.accountId,providerId:selection.providerId,sequence:old?.sequence??history.reduce((max,m)=>Math.max(max,m.sequence??0),0)+1});
      return {config,selection,secrets,base,history:history.filter(m=>m.id!==requestId&&(m.providerId??'openrouter')===selection.providerId && m.accountId===config.accountId),text,model:{id:config.modelId,structured:selected?.structured ?? false}};
    });
    const context=buildAIContext(loaded.base,options,Date.now());
    const messages=providerMessages(context,loaded.text,loaded.history,loaded.secrets);
    const result=await (provider??getProvider(loaded.selection.providerId)).complete({apiKey:loaded.config.apiKey,accountId:loaded.config.accountId,model:loaded.model,messages,signal:options.signal});
    const response=parseAssistantResponse(JSON.stringify(result.response),loaded.secrets),attempts=result.attempts;
    if(options.signal?.aborted)throw new AIError('cancelled','AI request cancelled. No task changes were applied.');
    // Provider adapters are replaceable; the approval boundary validates their output again.
    const proposal=response.actions.length ? prepareProposal(loaded.base,response,options.date,context.tasks.map(t=>t.id),requestId) : undefined;
    if(proposal){proposal.providerId=loaded.selection.providerId;proposal.accountId=loaded.config.accountId;}
    await database.transaction('rw',database.tables,async()=>{
      const config=await database.aiConfig.get(loaded.selection.providerId),message=await database.chatMessages.get(requestId);
      const selection=await getProviderSelection(database);
      if(!message || message.status!=='pending' || message.attemptId!==attemptId || options.signal?.aborted || JSON.stringify(config)!==JSON.stringify(loaded.config) || JSON.stringify(selection)!==JSON.stringify(loaded.selection))throw new AIError('cancelled','This request was cancelled because chat data or AI configuration changed.');
      if(JSON.stringify(await snapshot(database))!==JSON.stringify(loaded.base))throw new AIError('stale','Your workday changed while the model was responding. Retry with the latest context.');
      if(proposal)await database.aiProposals.add(proposal);
      const history=await database.chatMessages.toArray();
      const answer:ChatMessage={accountId:loaded.config.accountId,providerId:loaded.selection.providerId,sequence:history.reduce((max,m)=>Math.max(max,m.sequence??0),0)+1,id:crypto.randomUUID(),role:'assistant',text:redactSecrets(response.reply,loaded.secrets),createdAt:iso(Date.now()),status:'answered',inReplyTo:requestId,modelId:loaded.config.modelId,attempts,proposalId:proposal?.id};
      await database.chatMessages.add(answer);await database.chatMessages.update(requestId,{status:'answered',error:undefined});
    });
    return requestId;
  } catch(error) {
    const message=safeAIError(error);
    // A deleted chat/request is never recreated by a late network response.
    try{await database.transaction('rw',database.chatMessages,async()=>{const old=await database.chatMessages.get(requestId);if(old?.status==='pending' && old.attemptId===attemptId)await database.chatMessages.update(requestId,{status:error instanceof AIError&&error.code==='cancelled'?'cancelled':'error',error:message});});}catch{ /* Storage failure must not expose raw provider or credential data. */ }
    throw error instanceof AIError ? error : new AIError('storage',message);
  }
}
export async function clearChat(database=db,providerId?:ProviderId) {
  await database.transaction('rw',[database.chatMessages,database.aiProposals],async()=>{
    if(!providerId){await database.chatMessages.clear();await database.aiProposals.clear();return;}
    const messages=(await database.chatMessages.toArray()).filter(m=>(m.providerId??'openrouter')===providerId);
    const ids=new Set(messages.map(m=>m.id));
    await database.chatMessages.bulkDelete([...ids]);
    await database.aiProposals.bulkDelete((await database.aiProposals.toArray()).filter(p=>(p.providerId??'openrouter')===providerId||ids.has(p.userMessageId)).map(p=>p.id));
  });
}
