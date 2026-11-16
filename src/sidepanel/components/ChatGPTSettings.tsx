import { t } from '../../i18n';
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CircleCheck, LogIn, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { db } from '../../storage/db';
import { forgetChatGPTAccount, refreshModels, saveAIConfig, selectChatGPTAccount } from '../../services/ai/config';
import { chatGPTStatus, chatGPTRequest, type ChatGPTStatus } from '../../services/ai/chatgpt';
import { safeAIError } from '../../services/ai/chat';
export function ChatGPTSettings({ report }: { report: (message: string) => void }) {
  const config = useLiveQuery(() => db.aiConfig.get('chatgpt'), []);
  const catalog = useLiveQuery(() => db.modelCache.get('chatgpt'), []);
  const [status, setStatus] = useState<ChatGPTStatus>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [model, setModel] = useState(''), [consent, setConsent] = useState(false);
  const mounted = useRef(true), checking = useRef(false);
  const account = status?.accounts.find(a => a.id === config?.accountId);
  const ready = !!account?.connected && account.planEnabled;
  useEffect(() => { setModel(config?.modelId || ''); setConsent(config?.consent || false); }, [config?.revision]);
  async function loadModels() {
    const models = await refreshModels(undefined, db, undefined, { providerId: 'chatgpt' });
    if (mounted.current) setModel(current => current || models[0]?.id || '');
  }
  async function check() {
    if (checking.current) return;
    checking.current = true;
    try {
      const next = await chatGPTStatus(); if (!mounted.current) return; setStatus(next);
      const saved = await db.aiConfig.get('chatgpt');
      if (saved?.pendingAuthId && next.result?.id === saved.pendingAuthId) {
        await db.aiConfig.update('chatgpt', { pendingAuthId: undefined });
        if (next.result.error) setError(next.result.error);
        else if (next.result.accountId) {
          await selectChatGPTAccount(next.result.accountId);
          // Save a step: fetch the model list straight away when the plan is usable.
          if (next.accounts.find(a => a.id === next.result?.accountId)?.planEnabled) await loadModels().catch(() => {});
          report(t('ChatGPT connected. Choose a model and allow sharing to finish.'));
        }
      }
      if (saved?.connected && !next.accounts.find(a => a.id === saved.accountId && a.connected && a.planEnabled)) await db.aiConfig.update('chatgpt', { connected: false, revision: crypto.randomUUID() });
    } catch (e) { if (mounted.current) setError(safeAIError(e)); }
    finally { checking.current = false; }
  }
  useEffect(() => { mounted.current = true; void check(); const timer = setInterval(() => void check(), 2000); return () => { mounted.current = false; clearInterval(timer); }; }, []);
  async function run(fn: () => Promise<void>) { setError(''); setBusy(true); try { await fn(); } catch (e) { if (mounted.current) setError(safeAIError(e)); } finally { if (mounted.current) { setBusy(false); void check(); } } }
  async function start(accountId?: string, enable = false) {
    const result = await chatGPTRequest({ op: 'start', ...(accountId ? { accountId } : {}), consent: enable });
    if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string') throw new Error();
    const old = await db.aiConfig.get('chatgpt');
    await db.aiConfig.put({ id: 'chatgpt', apiKey: '', modelId: '', consent: false, ...old, pendingAuthId: result.id });
  }
  async function signOut(accountId: string) {
    const result = await chatGPTRequest({ op: 'signOut', accountId }) as { revoked: boolean };
    await forgetChatGPTAccount(accountId);
    report(result.revoked ? 'Signed out of ChatGPT.' : 'Signed out here. ChatGPT could not confirm it: also disconnect this app in your ChatGPT settings.');
  }
  return <div aria-label={t('ChatGPT plan settings')}>
    <h3>{t('ChatGPT plan')}</h3>
    <p className="muted small">{t('Use your ChatGPT subscription instead of an API key. Availability depends on your plan, workspace and region.')}</p>

    {status?.pending
      ? <div className="callout" role="status"><p>{t('Finish signing in in the browser tab that opened, then come back here.')}</p><Button variant="outline" onClick={() => void run(async () => { await chatGPTRequest({ op: 'cancelAuth' }); await db.aiConfig.update('chatgpt', { pendingAuthId: undefined }); })}>{t('Cancel sign-in')}</Button></div>
      : !status?.accounts.some(a => a.connected) && <Button disabled={busy} onClick={() => void run(() => start())}><LogIn size={15}/>{' '}{t('Continue with ChatGPT')}</Button>}

    {status?.accounts.map(a => <div className="account" key={a.id}>
      <div className="account-main"><strong>{a.label}</strong><span className={`pill${a.connected && a.planEnabled ? ' ok' : ''}`}>{a.connected ? a.planEnabled ? t('Connected') : t('Plan access off') : t('Signed out')}{a.id === config?.accountId ? t(' · In use') : ''}</span></div>
      <div className="row wrap">
        {a.connected && a.id !== config?.accountId && <Button variant="outline" disabled={busy || !!status.pending} onClick={() => void run(async () => { await selectChatGPTAccount(a.id); setModel(''); })}>{t('Use account')}</Button>}
        {(!a.connected || !a.planEnabled) && <Button variant="outline" disabled={busy || !!status.pending} onClick={() => void run(() => start(a.id, a.connected && !a.planEnabled))}>{a.connected ? t('Enable plan access') : t('Sign in again')}</Button>}
        {a.connected && <Button variant="ghost" disabled={busy || !!status.pending} onClick={() => void run(() => signOut(a.id))}>{t('Sign out')}</Button>}
      </div>
    </div>)}

    {ready && !account.welcomeAcknowledged && <div className="callout"><p><CircleCheck size={15}/>{' '}{t('You’re using your ChatGPT plan')}</p><Button onClick={() => void run(async () => { await chatGPTRequest({ op: 'acknowledge', accountId: account.id }); })}>{t('Got it')}</Button></div>}

    {ready && <form className="settings-form" onSubmit={e => { e.preventDefault(); void run(async () => { await saveAIConfig({ modelId: model, consent }, db, 'chatgpt'); report(t('ChatGPT is ready. Open AI Chat to start.')); }); }}>
      <label htmlFor="chatgpt-model">{t('ChatGPT model')}</label>
      <div className="row"><select id="chatgpt-model" required value={model} onChange={e => setModel(e.target.value)}><option value="">{t('Choose a model…')}</option>{catalog?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <Button type="button" variant="outline" disabled={busy} aria-label={t('Refresh ChatGPT models')} title={t('Refresh ChatGPT models')} onClick={() => void run(loadModels)}><RefreshCw size={14}/></Button></div>
      <label className="check-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>{' '}{t('Allow sending my requests, selected workday context and this account’s recent chat to OpenAI using my ChatGPT plan.')}</label>
      <Button disabled={busy || !model}>{t('Save ChatGPT settings')}</Button>
      <p className="small muted">{t('Task changes always wait for your approval.')}{' '}<a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">{t('Manage usage')}</a></p>
    </form>}
    {error && <p role="alert" className="error">{t(error)}</p>}

    <p className="small muted">{t('Sign-in runs inside the extension; there is nothing else to install. Your ChatGPT session is saved in this extension’s private storage in this browser profile until you sign out. Signing out removes the account, its saved details and its conversation from this extension.')}</p>
  </div>;
}
