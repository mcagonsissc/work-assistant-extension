import { ChatGPTSettings } from './ChatGPTSettings';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw, KeyRound, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { db } from '../../storage/db';
import { forgetAIKey, getProviderSelection, getPublicAIConfig, refreshModels, saveAIConfig, setActiveProvider } from '../../services/ai/config';
import { providerIds, providerLabels, type ProviderId } from '../../services/ai/provider';
import { safeAIError } from '../../services/ai/chat';
import { usePreferences } from '../store';

export function AISettings({ report }: { report: (message: string) => void }) {
  const selection = useLiveQuery(() => getProviderSelection(), []);
  const [error, setError] = useState('');
  const { assistantName, setAssistantName } = usePreferences();
  const id = selection?.providerId ?? 'openrouter';
  return <section className="settings-section ai-settings" aria-label="AI provider settings">
    <h2 className="row"><KeyRound size={15}/> AI assistant</h2>
    <label className="provider-picker" htmlFor="assistant-name">Assistant name</label>
    <input id="assistant-name" maxLength={40} value={assistantName} onChange={e => setAssistantName(e.target.value)} placeholder="Workday AI" autoComplete="off"/>
    <p className="muted small">Shown in chat, and the assistant answers to it. Saved as you type.</p>
    <label className="provider-picker" htmlFor="ai-provider">AI provider</label>
    <select id="ai-provider" value={id} disabled={!selection} onChange={async e => {
      const next = e.target.value as ProviderId;
      try { await setActiveProvider(next); setError(''); report(`${providerLabels[next]} selected. Each provider keeps its own settings and conversation.`); }
      catch { setError('Unable to switch AI provider. Please retry.'); }
    }}>{providerIds.map(provider => <option key={provider} value={provider}>{providerLabels[provider]}</option>)}</select>
    {error && <p role="alert" className="error">{error}</p>}
    {selection && (id === 'chatgpt' ? <ChatGPTSettings report={report}/> : <ProviderSettings key={id} id={id} report={report}/>)}
  </section>;
}
function ProviderSettings({ id, report }: { id: ProviderId; report: (message: string) => void }) {
  const label = providerLabels[id];
  const config = useLiveQuery(() => getPublicAIConfig(db, id), [id]);
  const cache = useLiveQuery(() => db.modelCache.get(id), [id]);
  const [key, setKey] = useState(''), [model, setModel] = useState(''), [consent, setConsent] = useState(false);
  const [freeOnly, setFreeOnly] = useState(true), [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { if (config) { setModel(config.modelId); setConsent(config.consent); } }, [config?.modelId, config?.consent]);
  useEffect(() => () => controller.current?.abort(), []);
  async function discover() {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError('');
    try {
      const models = await refreshModels(undefined, db, request.signal, { providerId: id, apiKey: key || undefined });
      report(`Retrieved ${models.length} models from ${label}. Select a model and save.`);
    } catch (e) { if (!request.signal.aborted) setError(safeAIError(e)); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try { await saveAIConfig({ key: key || undefined, modelId: model, consent }, db, id); setKey(''); report(`${label} settings saved. Send a request in AI Chat to test the selected model.`); }
    catch { setError('Unable to save AI settings. Check the model ID and key (16–512 characters, no spaces).'); }
    finally { setBusy(false); }
  }
  const models = (cache?.models ?? []).filter(m => (id !== 'openrouter' || !freeOnly || m.free) && `${m.id} ${m.name}`.toLowerCase().includes(search.toLowerCase()));
  const selected = cache?.models.find(m => m.id === model);
  const consentLabel = id === 'openrouter'
    ? 'Allow sending my chat requests and selected workday context to OpenRouter and the selected model provider.'
    : `Allow sending my chat requests and selected workday context to ${label}.`;
  return <div aria-label={`${label} settings`}>
    <h3>{label}</h3>
    <p className="muted small">Uses your own API key, saved only in this extension on this device.{id === 'openai' ? ' To sign in with a ChatGPT subscription instead, choose ChatGPT plan above.' : id === 'claude' ? ' Get a key from the Anthropic Console. A Claude subscription cannot be used here.' : ''}</p>
    <form className="settings-form" onSubmit={save}>
      <label>{label} API key<input type="password" autoComplete="off" spellCheck={false} value={key} placeholder={config?.hasKey ? 'Saved key · enter a replacement' : `Enter your own ${label} key`} onChange={e => setKey(e.target.value)}/></label>
      <p className="small muted">{config?.hasKey ? 'A key is saved on this device.' : 'No API key saved.'}</p>
      <div className="row wrap"><Button type="button" variant="outline" disabled={busy} onClick={() => void discover()}><RefreshCw size={13}/>{busy ? 'Working…' : 'Refresh models'}</Button>
        {config?.hasKey && <Button type="button" variant="destructive" onClick={async () => {
          controller.current?.abort(); setKey('');
          try { await forgetAIKey(db, id); setBusy(false); report(`${label} key removed and sharing disabled. Other providers are unchanged.`); }
          catch { setError('Unable to remove the saved key. Please retry.'); }
        }}><Trash2 size={13}/> Forget key</Button>}
      </div>
      {id === 'openrouter' && <label className="check-label"><input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)}/> Show free models only</label>}
      <label>Find a model<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or ID"/></label>
      <label htmlFor="ai-model-catalog">Discovered model</label><select id="ai-model-catalog" value={models.some(m => m.id === model) ? model : ''} onChange={e => setModel(e.target.value)}><option value="">Choose a model…</option>{models.map(m => <option key={m.id} value={m.id}>{m.name}{id === 'openrouter' ? m.free ? ' · Free' : ' · Paid' : ''}</option>)}</select>
      <label>Model ID<input required maxLength={200} value={model} onChange={e => setModel(e.target.value)} placeholder="Select above or enter a model ID" spellCheck={false}/></label>
      {id === 'openrouter' ? selected && <p className="small muted">{selected.free ? 'Free model; account limits still apply.' : `Paid model · prompt ${selected.promptPrice} / completion ${selected.completionPrice} USD per token.`}</p>
        : <p className="small muted">Requests may be billed by {label}. Check pricing in your provider account.</p>}
      <label className="check-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>{consentLabel}</label>
      {error && <p role="alert" className="error">{error}</p>}<Button disabled={busy || !config}>Save AI settings</Button>
      <details className="more"><summary>What gets shared?</summary><p className="small muted">Each request sends task summaries, work hours, busy time windows and your recent conversation with this provider. Task descriptions are sent only if you turn that on in Chat. Webpages, meeting titles and saved keys are never sent. An invalid answer may trigger one automatic retry, which can cost extra. There is no automatic switch to another provider or a paid model.</p></details>
    </form>
  </div>;
}
