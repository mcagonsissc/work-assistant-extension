import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Send, Square, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { db } from '../../storage/db';
import { getAIView } from '../../services/ai/config';
import { providerLabels } from '../../services/ai/provider';
import { clearChat, safeAIError, sendChat, sortChat } from '../../services/ai/chat';
import { approveAIProposal, refreshAIProposal, rejectAIProposal } from '../../services/ai/proposals';
import { redactSecrets } from '../../services/ai/schema';
import type { AIProposal } from '../../services/ai/types';
import { formatTime } from '../../services/scheduling/time';
export function AIChat({date:today,seed,consumeSeed,openSettings,showToday}:{date:string;seed:string|null;consumeSeed:()=>void;openSettings:()=>void;showToday:()=>void}) {
  const config=useLiveQuery(()=>getAIView(),[]);
  const providerId=config?.providerId??'openrouter',providerLabel=providerLabels[providerId];
  const messages=useLiveQuery(async()=>sortChat((await db.chatMessages.toArray()).filter(m=>(m.providerId??'openrouter')===providerId)),[providerId])??[];
  const proposals=useLiveQuery(()=>db.aiProposals.toArray(),[])??[];
  const [draft,setDraft]=useState(''),[date,setDate]=useState(today),[scope,setScope]=useState<'day'|'all'>('day'),[includeDescriptions,setDescriptions]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[offline,setOffline]=useState(!navigator.onLine),[confirmClear,setConfirmClear]=useState(false);
  const controller=useRef<AbortController|null>(null);
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
    e?.preventDefault();if(busy)return;setError('');setBusy(true);const sentText=retry?.text??draft;
    const request=new AbortController();controller.current=request;
    try{await sendChat({text:sentText,date,scope,includeDescriptions,retryId:retry?.id,signal:request.signal});if(!retry)setDraft(current=>current===sentText?'':current);}
    catch(e){if(!request.signal.aborted)setError(safeAIError(e));}
    finally{if(controller.current===request)setBusy(false);}
  }
  return <section className="ai-chat" aria-label="AI Chat"><p className="eyebrow section-heading">YOUR PLANNING PARTNER</p><h1>A conversation, then a plan.</h1>
    {!configured&&<div className="info"><p>Connect your own {providerLabel} API key, choose a model and enable data sharing in Settings. Manual planning works without AI.</p><Button variant="outline" onClick={openSettings}>Configure AI</Button></div>}
    {offline&&<p role="status" className="info">You’re offline. Saved conversations and manual planning remain available; sending needs a connection.</p>}
    {config?.modelId&&<p className="small muted">{providerLabel} · Model: {config.modelId} · changes always require approval</p>}
    <details className="context-options"><summary>Context & privacy</summary><label className="plan-date">Planning date<input type="date" required value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><label>Task context<select value={scope} onChange={e=>setScope(e.target.value as 'day'|'all')}><option value="day">This day, next day & unscheduled</option><option value="all">All dates (up to 80 tasks + prerequisites)</option></select></label><label className="check-label"><input type="checkbox" checked={includeDescriptions} onChange={e=>setDescriptions(e.target.checked)}/> Include task descriptions (up to 500 characters each)</label><p className="small muted">Sends up to 80 tasks plus prerequisites, busy time windows, relevant scheduled blocks, work constraints and six recent conversation messages from this provider. Other providers’ conversations are kept separate. Meeting titles and webpage content are excluded. Requests can use one corrective retry. Chat stays local until you Send.</p></details>
    {messages.length===0&&<div className="chat-empty"><Sparkles size={22}/><p>Describe your work. I’ll propose task changes and let the local planner find time.</p><div className="row wrap">{['Plan my day.','What should I work on next?','What tasks have I not completed?'].map(text=><Button key={text} variant="outline" onClick={()=>setDraft(text)}>{text}</Button>)}</div></div>}
    <div className="messages" role="log" aria-label="Conversation">{messages.map(message=><article key={message.id} className={`chat-message ${message.role}`}><div className="row between"><strong>{message.role==='user'?'You':'Workday AI'}</strong><span className="small muted">{new Date(message.createdAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</span></div><p>{message.text}</p>{message.role==='user'&&message.status!=='answered'&&<div className="message-status"><p className="small muted">{message.status==='pending'?(busy?'Thinking…':'Interrupted or pending request. Retry with the latest context.'):(message.error??'Request cancelled.')}</p>{!busy&&<Button variant="outline" disabled={!configured||offline} onClick={()=>void send(undefined,{id:message.id,text:message.text})}>Retry request</Button>}</div>}{message.proposalId&&proposals.find(p=>p.id===message.proposalId)&&<ProposalCard proposal={proposals.find(p=>p.id===message.proposalId)!} showToday={showToday}/>} {message.role==='assistant'&&message.modelId&&<p className="small muted">{message.modelId}{message.attempts&&message.attempts>1?' · retried once':''}</p>}</article>)}</div>
    {error&&<p role="alert" className="error">{error}</p>}
    <form className="chat-composer" onSubmit={e=>void send(e)}><label htmlFor="ai-message">Message to AI</label><textarea id="ai-message" required maxLength={6000} rows={3} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Review two PRs, write documentation, and prepare tomorrow’s demo…"/><div className="row between"><span className="small muted">{draft.length}/6000</span>{busy?<Button type="button" variant="outline" onClick={()=>controller.current?.abort()}><Square size={12}/> Cancel request</Button>:<Button disabled={!configured||offline||!draft.trim()}><Send size={13}/> Send</Button>}</div></form>
    <div className="row between chat-footer"><Button variant="ghost" onClick={showToday}>Back to Today</Button><Button variant="ghost" disabled={busy||messages.length===0} onClick={()=>setConfirmClear(true)}><Trash2 size={13}/> Clear chat</Button></div>
    {confirmClear&&<div className="confirm"><p>Delete this provider’s local conversation and proposals? Other conversations, approved tasks and schedules will remain.</p><div className="row"><Button variant="destructive" onClick={async()=>{try{await clearChat(db,providerId);setConfirmClear(false);setError('');}catch{setError('Unable to clear chat.');}}}>Delete chat</Button><Button variant="outline" onClick={()=>setConfirmClear(false)}>Cancel</Button></div></div>}
  </section>;
}
function display(value:unknown) { if(value===null||value===undefined)return 'None';if(Array.isArray(value))return value.length?value.join(', '):'None';return redactSecrets(String(value)); }
function changeValue(key:string,value:unknown,proposal:AIProposal) {
  if(key==='dependencyIds'&&Array.isArray(value))return value.length?value.map(id=>proposal.taskTitles?.[id]??'Missing prerequisite').join(', '):'None';
  if(['deadline','start','end'].includes(key)&&typeof value==='string')return new Intl.DateTimeFormat(undefined,{timeZone:proposal.plans[0]?.timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  if(key==='status'&&typeof value==='string')return ({todo:'To do',in_progress:'In progress',paused:'Paused',completed:'Completed',deferred:'Deferred'} as Record<string,string>)[value]??value;
  return display(value);
}
const fieldLabels:Record<string,string>={title:'Title',description:'Description',category:'Category',priority:'Priority',status:'Status',estimatedMinutes:'Estimate (min)',scheduledDate:'Date',deadline:'Deadline',dependencyIds:'Prerequisites',start:'Starts',end:'Ends',timeZone:'Timezone'};
function ProposalCard({proposal,showToday}:{proposal:AIProposal;showToday:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function act(action:'approve'|'reject'|'refresh') {setBusy(true);setError('');try{if(action==='approve')await approveAIProposal(proposal.id);else if(action==='reject')await rejectAIProposal(proposal.id);else await refreshAIProposal(proposal.id);}catch(e){setError(safeAIError(e));}finally{setBusy(false);}}
  return <section className="ai-proposal" aria-label="AI change proposal"><h2>{proposal.status==='approved'?'Changes approved':proposal.status==='rejected'?'Proposal rejected':'Review proposed changes'}</h2>
    {proposal.status==='pending'?<><p className="small muted">Nothing has been applied. Preview expires after 60 seconds; refresh it if needed. The local scheduler rechecks times at approval.</p>{proposal.changes.map(change=><div className="change" key={`${change.kind}:${change.id}`}><h3>{change.before?'Update':'Create'} {change.kind}: {redactSecrets(change.title)}</h3><dl>{Object.entries(change.after).filter(([key,value])=>change.before?JSON.stringify(change.before[key])!==JSON.stringify(value):key!=='title'&&value!==null&&value!==''&&!(Array.isArray(value)&&value.length===0)).map(([key,value])=><div key={key}><dt>{fieldLabels[key]??key}</dt><dd>{change.before&&<><span className="old-value">{changeValue(key,change.before[key],proposal)}</span><span aria-hidden="true"> → </span></>}{changeValue(key,value,proposal)}</dd></div>)}</dl></div>)}
      {proposal.plans.map(plan=><div className="proposal-plan" key={plan.date}><h3>{plan.date} · {plan.timeZone}</h3>{plan.warnings.map(w=><p className="warning small" key={w}>{w}</p>)}<ol className="timeline" aria-label={`AI proposed schedule ${plan.date}`}>{plan.blocks.slice(0,200).map(block=><li className={`timeline-entry ${block.kind}`} key={block.id}><div className="timeline-time">{formatTime(block.start,plan.timeZone)}<span>{formatTime(block.end,plan.timeZone)}</span></div><div><strong>{redactSecrets(block.title??block.kind)}</strong><p>{Math.ceil((Date.parse(block.end)-Date.parse(block.start))/60000)} min · {block.kind}</p></div></li>)}</ol>{plan.blocks.length>200&&<p className="small muted">Showing 200 of {plan.blocks.length} blocks. Use Today after approval for the full timeline.</p>}{plan.overflow.length>0&&<div className="overflow"><h3>Overflow · {plan.overflow.length} task(s)</h3>{plan.overflow.map(item=><p key={item.taskId}>{redactSecrets(proposal.taskTitles?.[item.taskId]??proposal.changes.find(c=>c.id===item.taskId)?.title??plan.blocks.find(b=>b.taskId===item.taskId)?.title??`Task ${item.taskId.slice(0,8)}`)} · {Math.ceil(item.remainingMinutes)} min<br/><span className="small muted">{item.reason}</span></p>)}</div>}</div>)}
      {error&&<p role="alert" className="error">{error}</p>}<div className="row wrap"><Button disabled={busy} onClick={()=>void act('approve')}>Approve changes</Button><Button variant="outline" disabled={busy} onClick={()=>void act('reject')}>Reject changes</Button><Button variant="ghost" disabled={busy} onClick={()=>void act('refresh')}>Refresh preview</Button></div></>:<><p className="small muted">{proposal.status==='approved'?'Tasks and affected schedules were saved together.':'No task or schedule changes were applied.'}</p>{proposal.status==='approved'&&<Button variant="outline" onClick={showToday}>View Today</Button>}</>}
  </section>;
}
