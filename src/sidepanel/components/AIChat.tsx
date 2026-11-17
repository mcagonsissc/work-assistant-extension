import { getLanguage, languages, t } from '../../i18n';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Send, Square, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { db } from '../../storage/db';
import { getAIView } from '../../services/ai/config';
import { providerLabels } from '../../services/ai/provider';
import { clearChat, safeAIError, sendChat, sortChat } from '../../services/ai/chat';
import { approveAIProposal, refreshAIProposal, rejectAIProposal } from '../../services/ai/proposals';
import { redactSecrets } from '../../services/ai/schema';
import type { AIProposal } from '../../services/ai/types';
import { formatTime } from '../../services/scheduling/time';
import { usePreferences } from '../store';
export function AIChat({date:today,seed,consumeSeed,openSettings,showToday}:{date:string;seed:string|null;consumeSeed:()=>void;openSettings:()=>void;showToday:()=>void}) {
  const config=useLiveQuery(()=>getAIView(),[]);
  const assistantName=usePreferences(s=>s.assistantName).trim()||'Workday AI';
  const providerId=config?.providerId??'openrouter',providerLabel=providerLabels[providerId];
  const messages=useLiveQuery(async()=>sortChat((await db.chatMessages.toArray()).filter(m=>(m.providerId??'openrouter')===providerId && (providerId!=='chatgpt' || m.accountId===config?.accountId))),[providerId,config?.accountId])??[];
  const proposals=useLiveQuery(()=>db.aiProposals.toArray(),[])??[];
  const [draft,setDraft]=useState(''),[date,setDate]=useState(today),[scope,setScope]=useState<'day'|'all'>('day'),[includeDescriptions,setDescriptions]=useState(false),[includeMeetingTitles,setMeetingTitles]=useState(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[offline,setOffline]=useState(!navigator.onLine),[confirmClear,setConfirmClear]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const conversation=useRef<HTMLDivElement|null>(null), followLatest=useRef(true);
  useLayoutEffect(()=>{if(followLatest.current&&conversation.current)conversation.current.scrollTop=conversation.current.scrollHeight;},[messages.length,messages.at(-1)?.id,messages.at(-1)?.status,proposals,busy]);
  useEffect(()=>{followLatest.current=true;},[providerId,config?.accountId]);
  const previousConfig=useRef<string|null>(null);
  useEffect(()=>{if(seed){setDraft(seed);consumeSeed();}},[seed]);
  useEffect(()=>{const update=()=>setOffline(!navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{controller.current?.abort();window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  useEffect(()=>{
    if(!config)return;
    const identity=`${config.revision}:${config.configRevision}`;
    if(previousConfig.current!==null&&previousConfig.current!==identity){controller.current?.abort();controller.current=null;setBusy(false);setError('');setDraft('');setConfirmClear(false);}
    previousConfig.current=identity;
  },[config?.revision,config?.configRevision]);
  const configured=!!(config?.hasKey&&config.modelId&&config.consent);
  async function send(e?:FormEvent,retry?:{id:string;text:string}) {
    e?.preventDefault();if(busy||!configured||offline||!(retry?.text??draft).trim())return;followLatest.current=true;setError('');setBusy(true);const sentText=retry?.text??draft;
    const request=new AbortController();controller.current=request;
    if(!retry)setDraft(''); // Clear straight away; the message shows in the conversation while the AI answers.
    try{await sendChat({text:sentText,date,scope,includeDescriptions,includeMeetingTitles,assistantName:usePreferences.getState().assistantName,replyLanguage:getLanguage()==='en'?undefined:languages[getLanguage()],retryId:retry?.id,signal:request.signal});}
    catch(e){
      if(!request.signal.aborted)setError(safeAIError(e));
      // If the request failed before it was saved to the conversation, give the text back.
      if(!retry&&!(await db.chatMessages.toArray().catch(()=>[])).some(m=>m.role==='user'&&m.text===sentText.trim()))setDraft(current=>current||sentText);
    }
    finally{if(controller.current===request)setBusy(false);}
  }
  return <section className="ai-chat" aria-label={t('AI Chat')}><div className="chat-heading"><div className="row between"><h1>{t('AI Chat')}</h1><div className="row"><Button variant="ghost" onClick={showToday}><ArrowLeft size={13}/>{' '}{t('Back to Today')}</Button><Button variant="ghost" aria-label={t('Clear chat')} title={t('Clear chat')} disabled={busy||messages.length===0} onClick={()=>setConfirmClear(true)}><Trash2 size={13}/></Button></div></div>
    </div>
    {!configured&&<div className="info"><p>{providerId==='chatgpt'?t('Connect your ChatGPT account, choose a model and enable data sharing in Settings. Manual planning works without AI.'):t('Connect your own {provider} API key, choose a model and enable data sharing in Settings. Manual planning works without AI.',{provider:providerLabel})}</p><Button variant="outline" onClick={openSettings}>{t('Configure AI')}</Button></div>}
    {providerId==='chatgpt'&&config?.hasKey&&<p className="small muted">{t('Using ChatGPT plan ·')}{' '}<a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">{t('Manage usage')}</a></p>}
    {offline&&<p role="status" className="info">{t('You’re offline. Saved conversations and manual planning remain available; sending needs a connection.')}</p>}
    {config?.modelId&&<p className="small muted">{t('{provider} · Model: {model}',{provider:providerLabel,model:config.modelId})}</p>}
    <details className="context-options"><summary>{t('Chat options')}</summary><div className="chat-options-content">{config?.accountLabel&&<p>{config.accountLabel}</p>}<p className="small muted">{t('Task changes require your approval.')}</p><label className="plan-date">{t('Planning date')}<input type="date" required value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><label>{t('Task context')}<select value={scope} onChange={e=>setScope(e.target.value as 'day'|'all')}><option value="day">{t('This day, next day & unscheduled')}</option><option value="all">{t('All dates (up to 80 tasks + prerequisites)')}</option></select></label><label className="check-label"><input type="checkbox" checked={includeDescriptions} onChange={e=>setDescriptions(e.target.checked)}/>{' '}{t('Include task descriptions and notes (up to 500 characters each)')}</label><label className="check-label"><input type="checkbox" checked={includeMeetingTitles} onChange={e=>setMeetingTitles(e.target.checked)}/>{' '}{t('Include meeting titles, so the assistant can find a meeting by name')}</label><p className="small muted">{t('Each request sends up to 80 tasks, your meeting times, work hours and your six most recent messages with this provider. Webpages are never sent.')}</p></div></details>
    <div className="messages" role="log" aria-label={t('Conversation')} ref={conversation} onScroll={()=>{const node=conversation.current;if(node)followLatest.current=node.scrollHeight-node.scrollTop-node.clientHeight<60;}}>
    {messages.length===0&&<div className="chat-empty"><Sparkles size={22}/><p>{t('Tell me what’s on your plate. I’ll suggest task changes for you to approve.')}</p><div className="row wrap">{[t('Plan my day.'),t('What should I work on next?'),t('What tasks have I not completed?')].map(text=><Button key={text} variant="outline" onClick={()=>setDraft(text)}>{text}</Button>)}</div></div>}
    {messages.map(message=><article key={message.id} className={`chat-message ${message.role}`}><div className="row between"><strong>{message.role==='user'?t('You'):assistantName}</strong><span className="small muted">{new Date(message.createdAt).toLocaleTimeString(getLanguage(),{hour:'2-digit',minute:'2-digit'})}</span></div><p>{message.text}</p>{message.role==='user'&&message.status!=='answered'&&<div className="message-status"><p className="small muted">{message.status==='pending'?(busy?t('Thinking…'):t('Interrupted or pending request. Retry with the latest context.')):(message.error?t(message.error):t('Request cancelled.'))}</p>{!busy&&<Button variant="outline" disabled={!configured||offline} onClick={()=>void send(undefined,{id:message.id,text:message.text})}>{t('Retry request')}</Button>}</div>}{message.proposalId&&proposals.find(p=>p.id===message.proposalId)&&<ProposalCard proposal={proposals.find(p=>p.id===message.proposalId)!} showToday={showToday}/>} {message.role==='assistant'&&message.modelId&&<p className="small muted">{message.modelId}{message.attempts&&message.attempts>1?t(' · retried once'):''}</p>}</article>)}
    </div>
    {error&&<p role="alert" className="error">{t(error)}</p>}
    <form className="chat-composer" onSubmit={e=>void send(e)}><label htmlFor="ai-message" className="sr-only">{t('Message to AI')}</label><textarea id="ai-message" required maxLength={6000} rows={2} value={draft} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();if(!busy&&configured&&!offline&&draft.trim())e.currentTarget.form?.requestSubmit();}}} onChange={e=>setDraft(e.target.value)} placeholder={t('What would you like to plan?')}/><div className="row between"><span className="small muted">{t('Shift+Enter for a new line')}</span>{busy?<Button type="button" variant="outline" onClick={()=>controller.current?.abort()}><Square size={12}/>{' '}{t('Cancel request')}</Button>:<Button disabled={!configured||offline||!draft.trim()}><Send size={13}/>{' '}{t('Send')}</Button>}</div></form>
    {confirmClear&&<div className="confirm chat-clear-confirm" role="alertdialog" aria-label={t('Clear conversation')}><p>{t('Delete this provider’s local conversation and proposals? Other conversations, approved tasks and schedules will remain.')}</p><div className="row"><Button variant="destructive" onClick={async()=>{try{await clearChat(db,providerId);setConfirmClear(false);setError('');}catch{setError(t('Unable to clear chat.'));}}}>{t('Delete chat')}</Button><Button variant="outline" onClick={()=>setConfirmClear(false)}>{t('Cancel')}</Button></div></div>}
  </section>;
}
function display(value:unknown) { if(value===null||value===undefined)return t('None');if(Array.isArray(value))return value.length?value.join(', '):t('None');return redactSecrets(String(value)); }
function changeValue(key:string,value:unknown,proposal:AIProposal) {
  if(key==='dependencyIds'&&Array.isArray(value))return value.length?value.map(id=>proposal.taskTitles?.[id]??t('Missing prerequisite')).join(', '):t('None');
  if(['deadline','start','end'].includes(key)&&typeof value==='string')return new Intl.DateTimeFormat(getLanguage(),{timeZone:proposal.plans[0]?.timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  if(key==='status'&&typeof value==='string')return t(({todo:'To do',in_progress:'In progress',paused:'Paused',completed:'Completed',deferred:'Deferred'} as Record<string,string>)[value]??value);
  if((key==='priority'||key==='category')&&typeof value==='string')return t(value);
  return display(value);
}
const fieldLabels:Record<string,string>={title:'Title',description:'Description',category:'Category',priority:'Priority',status:'Status',estimatedMinutes:'Estimate (min)',scheduledDate:'Date',deadline:'Deadline',dependencyIds:'Prerequisites',notes:'Notes',start:'Starts',end:'Ends',timeZone:'Timezone'};
function ProposalCard({proposal,showToday}:{proposal:AIProposal;showToday:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function act(action:'approve'|'reject'|'refresh') {setBusy(true);setError('');try{if(action==='approve')await approveAIProposal(proposal.id);else if(action==='reject')await rejectAIProposal(proposal.id);else await refreshAIProposal(proposal.id);}catch(e){setError(safeAIError(e));}finally{setBusy(false);}}
  return <section className="ai-proposal" aria-label={t('AI change proposal')}><h2>{proposal.status==='approved'?t('Changes approved'):proposal.status==='rejected'?t('Proposal rejected'):t('Review proposed changes')}</h2>
    {proposal.status==='pending'?<><p className="small muted">{t('Nothing has been applied. Preview expires after 60 seconds; refresh it if needed. The local scheduler rechecks times at approval.')}</p>{proposal.changes.map(change=><div className="change" key={`${change.kind}:${change.id}`}><h3>{change.action==='schedule'?t('Schedule task'):change.action==='unschedule'?t('Clear set time'):t(`${change.removed?'Delete':change.before?'Update':'Create'} ${change.kind}`)}: {redactSecrets(change.title)}</h3>{(change.removed||change.action==='unschedule')&&<p className="small muted">{changeValue('start',change.before?.start,proposal)} – {changeValue('end',change.before?.end,proposal)}</p>}<dl>{Object.entries(change.after).filter(([key,value])=>change.before?JSON.stringify(change.before[key])!==JSON.stringify(value):key!=='title'&&value!==null&&value!==''&&!(Array.isArray(value)&&value.length===0)).map(([key,value])=><div key={key}><dt>{t(fieldLabels[key]??key)}</dt><dd>{change.before&&<><span className="old-value">{changeValue(key,change.before[key],proposal)}</span><span aria-hidden="true"> → </span></>}{changeValue(key,value,proposal)}</dd></div>)}</dl></div>)}
      {proposal.plans.map(plan=><div className="proposal-plan" key={plan.date}><h3>{plan.date} · {plan.timeZone}</h3>{plan.warnings.map(w=><p className="warning small" key={w}>{t(w)}</p>)}<ol className="timeline" aria-label={`${t('AI proposed schedule')} ${plan.date}`}>{plan.blocks.slice(0,200).map(block=><li className={`timeline-entry ${block.kind}`} key={block.id}><div className="timeline-time">{formatTime(block.start,plan.timeZone)}<span>{formatTime(block.end,plan.timeZone)}</span></div><div><strong>{redactSecrets(block.title?t(block.title):t(block.kind))}</strong><p>{Math.ceil((Date.parse(block.end)-Date.parse(block.start))/60000)}{' '}{t('min')} · {t(block.kind)}</p></div></li>)}</ol>{plan.blocks.length>200&&<p className="small muted">{t('Showing 200 of {count} blocks. Use Today after approval for the full timeline.',{count:plan.blocks.length})}</p>}{plan.overflow.length>0&&<div className="overflow"><h3>{t('Overflow · {count} task(s)',{count:plan.overflow.length})}</h3>{plan.overflow.map(item=><p key={item.taskId}>{redactSecrets(proposal.taskTitles?.[item.taskId]??proposal.changes.find(c=>c.id===item.taskId)?.title??plan.blocks.find(b=>b.taskId===item.taskId)?.title??`${t('Task')} ${item.taskId.slice(0,8)}`)} · {Math.ceil(item.remainingMinutes)}{' '}{t('min')}<br/><span className="small muted">{t(item.reason)}</span></p>)}</div>}</div>)}
      {error&&<p role="alert" className="error">{t(error)}</p>}<div className="row wrap"><Button disabled={busy} onClick={()=>void act('approve')}>{t('Approve changes')}</Button><Button variant="outline" disabled={busy} onClick={()=>void act('reject')}>{t('Reject changes')}</Button><Button variant="ghost" disabled={busy} onClick={()=>void act('refresh')}>{t('Refresh preview')}</Button></div></>:<><p className="small muted">{proposal.status==='approved'?t('Tasks and affected schedules were saved together.'):t('No task or schedule changes were applied.')}</p>{proposal.status==='approved'&&<Button variant="outline" onClick={showToday}>{t('View Today')}</Button>}</>}
  </section>;
}
