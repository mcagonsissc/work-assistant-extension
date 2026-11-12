import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw, KeyRound, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { db } from '../../storage/db';
import { forgetAIKey, getProviderSelection, getPublicAIConfig, refreshModels, saveAIConfig, setActiveProvider } from '../../services/ai/config';
import { providerIds, providerLabels, type ProviderId } from '../../services/ai/provider';
import { safeAIError } from '../../services/ai/chat';

export function AISettings({ report }: { report: (message: string) => void }) {
  const selection = useLiveQuery(() => getProviderSelection(), []);
  const [error, setError] = useState('');
  const id = selection?.providerId ?? 'openrouter';
  return <section className="settings-section ai-settings" aria-label="AI provider settings">
    <h2 className="row"><KeyRound size={15}/> AI provider</h2>
    <label className="provider-picker" htmlFor="ai-provider">AI provider</label>
    <select id="ai-provider" value={id} disabled={!selection} onChange={async e => {
      const next = e.target.value as ProviderId;
      try { await setActiveProvider(next); setError(''); report(`${providerLabels[next]} selected. Keys, models, sharing consent and conversations are kept separately for each provider.`); }
      catch { setError('Unable to switch AI provider. Please retry.'); }
    }}>{providerIds.map(provider => <option key={provider} value={provider}>{providerLabels[provider]}</option>)}</select>
    <p className="muted small">Switching providers clears unsaved fields and cancels in-flight requests. Existing OpenRouter settings and approved tasks are preserved.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {selection && <ProviderSettings key={id} id={id} report={report}/>}
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
    <p className="muted small">Use your own API key. It is stored locally in this extension, which is not a secure server-side secret vault. Saved keys are never shown, exported, logged or sent as chat context.</p>
    {id === 'openai' && <p className="small muted">This uses an OpenAI API key. ChatGPT account sign-in is not implemented.</p>}
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
      {id !== 'openrouter' && <p className="small muted">Refresh models uses the key entered above, or the saved {label} key. It sends no task data and does not save an unsaved key.</p>}
      {cache && <p className="small muted">Catalog fetched {new Date(cache.fetchedAt).toLocaleString()}. Availability can change.</p>}
      {id === 'openrouter' && <label className="check-label"><input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)}/> Show free models only</label>}
      <label>Find a model<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or ID"/></label>
      <label htmlFor="ai-model-catalog">Discovered model</label><select id="ai-model-catalog" value={models.some(m => m.id === model) ? model : ''} onChange={e => setModel(e.target.value)}><option value="">Choose a model…</option>{models.map(m => <option key={m.id} value={m.id}>{m.name}{id === 'openrouter' ? m.free ? ' · Free' : ' · Paid' : ''}</option>)}</select>
      <label>Model ID<input required maxLength={200} value={model} onChange={e => setModel(e.target.value)} placeholder="Select above or enter a model ID" spellCheck={false}/></label>
      {id === 'openrouter' ? selected ? <p className="small muted">{selected.free ? 'Listed as free; account limits and availability still apply.' : `Paid model · prompt ${selected.promptPrice} / completion ${selected.completionPrice} USD per token in cached catalog.`} {selected.structured ? 'Structured output advertised.' : 'Uses schema-guided text with validation.'}</p> : model && <p className="small muted">Model not in the cached catalog. Manual IDs use schema-guided text; availability is checked on Send.</p>
        : <p className="small muted">The catalog does not report pricing or free-tier eligibility. Check your provider account; requests may be billed. Model compatibility is checked on Send. JSON output is requested first, with one text fallback if the provider rejects that format.</p>}
      <label className="check-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>{consentLabel}</label>
      <p className="small muted">Send shares task summaries, work constraints, busy time windows and recent conversation from this provider only. Descriptions are optional in Chat. Webpages, meeting titles, saved keys and notification preferences are excluded. Invalid output may trigger one corrective request, which can incur charges. No automatic provider or paid-model fallback.</p>
      {error && <p role="alert" className="error">{error}</p>}<Button disabled={busy || !config}>Save AI settings</Button>
    </form>
  </div>;
}
