import { t } from '../../i18n';
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
  return <section className="settings-section ai-settings" aria-label={t('AI provider settings')}>
    <h2 className="row"><KeyRound size={15}/>{' '}{t('AI assistant')}</h2>
    <label className="provider-picker" htmlFor="assistant-name">{t('Assistant name')}</label>
    <input id="assistant-name" maxLength={40} value={assistantName} onChange={e => setAssistantName(e.target.value)} placeholder={t('Workday AI')} autoComplete="off"/>
    <p className="muted small">{t('Shown in chat, and the assistant answers to it. Saved as you type.')}</p>
    <label className="provider-picker" htmlFor="ai-provider">{t('AI provider')}</label>
    <select id="ai-provider" value={id} disabled={!selection} onChange={async e => {
      const next = e.target.value as ProviderId;
      try { await setActiveProvider(next); setError(''); report(t('{provider} selected. Each provider keeps its own settings and conversation.', { provider: providerLabels[next] })); }
      catch { setError(t('Unable to switch AI provider. Please retry.')); }
    }}>{providerIds.map(provider => <option key={provider} value={provider}>{providerLabels[provider]}</option>)}</select>
    {error && <p role="alert" className="error">{t(error)}</p>}
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
      report(t('Retrieved {count} models from {provider}. Select a model and save.', { count: models.length, provider: label }));
    } catch (e) { if (!request.signal.aborted) setError(safeAIError(e)); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try { await saveAIConfig({ key: key || undefined, modelId: model, consent }, db, id); setKey(''); report(t('{provider} settings saved. Send a request in AI Chat to test the selected model.', { provider: label })); }
    catch { setError(t('Unable to save AI settings. Check the model ID and key (16–512 characters, no spaces).')); }
    finally { setBusy(false); }
  }
  const models = (cache?.models ?? []).filter(m => (id !== 'openrouter' || !freeOnly || m.free) && `${m.id} ${m.name}`.toLowerCase().includes(search.toLowerCase()));
  const selected = cache?.models.find(m => m.id === model);
  const consentLabel = id === 'openrouter'
    ? t('Allow sending my chat requests and selected workday context to OpenRouter and the selected model provider.')
    : t('Allow sending my chat requests and selected workday context to {provider}.', { provider: label });
  return <div aria-label={t('{provider} settings', { provider: label })}>
    <h3>{label}</h3>
    <p className="muted small">{t('Uses your own API key, saved only in this extension on this device.')}{id === 'openai' ? t(' To sign in with a ChatGPT subscription instead, choose ChatGPT plan above.') : id === 'claude' ? t(' Get a key from the Anthropic Console. A Claude subscription cannot be used here.') : ''}</p>
    <form className="settings-form" onSubmit={save}>
      <label>{t('{provider} API key', { provider: label })}<input type="password" autoComplete="off" spellCheck={false} value={key} placeholder={config?.hasKey ? t('Saved key · enter a replacement') : t('Enter your own {provider} key', { provider: label })} onChange={e => setKey(e.target.value)}/></label>
      <p className="small muted">{config?.hasKey ? t('A key is saved on this device.') : t('No API key saved.')}</p>
      <div className="row wrap"><Button type="button" variant="outline" disabled={busy} onClick={() => void discover()}><RefreshCw size={13}/>{busy ? t('Working…') : t('Refresh models')}</Button>
        {config?.hasKey && <Button type="button" variant="destructive" onClick={async () => {
          controller.current?.abort(); setKey('');
          try { await forgetAIKey(db, id); setBusy(false); report(t('{provider} key removed and sharing disabled. Other providers are unchanged.', { provider: label })); }
          catch { setError(t('Unable to remove the saved key. Please retry.')); }
        }}><Trash2 size={13}/>{' '}{t('Forget key')}</Button>}
      </div>
      {id === 'openrouter' && <label className="check-label"><input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)}/>{' '}{t('Show free models only')}</label>}
      <label>{t('Find a model')}<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Search name or ID')}/></label>
      <label htmlFor="ai-model-catalog">{t('Discovered model')}</label><select id="ai-model-catalog" value={models.some(m => m.id === model) ? model : ''} onChange={e => setModel(e.target.value)}><option value="">{t('Choose a model…')}</option>{models.map(m => <option key={m.id} value={m.id}>{m.name}{id === 'openrouter' ? m.free ? t(' · Free') : t(' · Paid') : ''}</option>)}</select>
      <label>{t('Model ID')}<input required maxLength={200} value={model} onChange={e => setModel(e.target.value)} placeholder={t('Select above or enter a model ID')} spellCheck={false}/></label>
      {id === 'openrouter' ? selected && <p className="small muted">{selected.free ? t('Free model; account limits still apply.') : t('Paid model · prompt {prompt} / completion {completion} USD per token.', { prompt: selected.promptPrice ?? '', completion: selected.completionPrice ?? '' })}</p>
        : <p className="small muted">{t('Requests may be billed by {provider}. Check pricing in your provider account.', { provider: label })}</p>}
      <label className="check-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>{consentLabel}</label>
      {error && <p role="alert" className="error">{t(error)}</p>}<Button disabled={busy || !config}>{t('Save AI settings')}</Button>
      <details className="more"><summary>{t('What gets shared?')}</summary><p className="small muted">{t('Each request sends task summaries, work hours, meeting times and your recent conversation with this provider. Meeting titles are sent unless you turn that off in Chat options; task descriptions and notes are sent only if you turn that on. Webpages and saved keys are never sent. An invalid answer may trigger one automatic retry, which can cost extra. There is no automatic switch to another provider or a paid model.')}</p></details>
    </form>
  </div>;
}
