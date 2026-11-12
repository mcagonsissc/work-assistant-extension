import { AIError } from './schema';

export function providerHTTPError(label: string, status: number, retryAfter?: string | null) {
  const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Math.min(3600, Number(retryAfter)) : undefined;
  if (status === 401 || status === 403) return new AIError('auth', `${label} rejected this key or access policy. Check the key and account permissions in Settings.`);
  if (status === 402) return new AIError('credits', `${label} reports insufficient credits. Review your provider account or select another available model.`);
  if (status === 429) return new AIError('rate_limit', `${label} is rate limiting requests or reports exhausted quota.${seconds ? ` Retry after about ${seconds} seconds.` : ' Review your quota and wait before retrying.'}`, seconds);
  if (status === 408 || status === 504) return new AIError('timeout', 'The AI request timed out. Your manual planner is still available.');
  return new AIError('unavailable', `${label} could not serve the selected model or rejected the request. Refresh models, choose another model, or retry later.`);
}

/** Fixed provider base URLs only; no user-controlled endpoint or redirects. */
export class ProviderHTTP {
  constructor(private baseURL: string, private label: string, private fetcher: typeof fetch = globalThis.fetch.bind(globalThis), private timeoutMs = 30_000) {}

  async request(path: string, init: RequestInit, limit: number, signal?: AbortSignal): Promise<{ body: unknown; status: number; retryAfter: string | null }> {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (signal?.aborted) throw new AIError('cancelled', 'AI request cancelled. No task changes were applied.');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseURL}${path}`, { ...init, signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
      if (Number(response.headers.get('content-length')) > limit) throw new AIError('invalid_response', 'The provider response was too large. Try a smaller request or another model.');
      let text = '';
      if (response.body) {
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let bytes = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > limit) {
              await reader.cancel();
              throw new AIError('invalid_response', 'The provider response was too large. Try a smaller request or another model.');
            }
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
        } finally { reader.releaseLock(); }
      }
      let body: unknown;
      try { body = JSON.parse(text); } catch { body = null; }
      return { body, status: response.status, retryAfter: response.headers.get('retry-after') };
    } catch (error) {
      if (error instanceof AIError) throw error;
      if (signal?.aborted) throw new AIError('cancelled', 'AI request cancelled. No task changes were applied.');
      if (timedOut) throw new AIError('timeout', 'The AI request timed out. Retry or choose a faster model.');
      throw new AIError('network', `${this.label} could not be reached. Check your connection; manual tasks and scheduling still work offline.`);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}

export function throwEmbeddedProviderError(body: unknown, label: string, retryAfter?: string | null) {
  if (!body || typeof body !== 'object' || !('error' in body) || body.error == null) return;
  const error = body.error;
  const code = typeof error === 'object' && 'code' in error ? error.code : undefined;
  const statuses: Record<string, number> = { invalid_api_key: 401, authentication_error: 401, permission_denied: 403, rate_limit_exceeded: 429, insufficient_quota: 429, credit_balance_exhausted: 429, model_not_found: 404 };
  throw providerHTTPError(label, typeof code === 'number' ? code : typeof code === 'string' ? statuses[code] ?? 503 : 503, retryAfter);
}
