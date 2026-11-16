# ChatGPT plan sign-in

From version 0.6 the extension signs in to ChatGPT by itself. There is no native helper, WSL companion, Node.js process or pairing code. Those were removed.

## Using it

1. Run `npm run build` and reload the `dist` extension at `edge://extensions`. Accept the new permissions if Edge asks (`storage`, `https://auth.openai.com/*` and `http://127.0.0.1/*`).
2. Open Settings, choose **ChatGPT plan** as the AI provider and select **Continue with ChatGPT**.
3. Sign in on the tab that opens. The tab then shows "Back to Workday Assistant" and can be closed.
4. Back in the side panel the model list loads automatically. Pick a model, tick the sharing consent and select **Save ChatGPT settings**.

Plan access depends on your ChatGPT plan, workspace and region, and on OpenAI's preview availability.

## How it works

The flow follows OpenAI's Sign in with ChatGPT documentation: dynamic client registration (`client_id=dynamic_agent_client` on first use, the issued client ID afterwards), PKCE, `state`, `nonce`, a loopback redirect, ID-token validation, rotating refresh tokens, and streaming `/v1/responses` requests with `store: false`.

- `src/services/ai/chatgpt-direct.ts` holds the whole flow. The side panel starts sign-in and makes model and chat requests.
- OpenAI requires the redirect to be `http://127.0.0.1:<port>/auth/callback`. Nothing listens on that port. `src/background.ts` watches for the sign-in tab arriving at that address (this is what the `http://127.0.0.1/*` host permission is for), replaces it with `signed-in.html`, and exchanges the code for tokens. A random port is chosen per attempt, the redirect is accepted once, and only when `state` matches.
- The ID token's signature, issuer, audience, expiry, nonce and (on re-sign-in) subject are checked before an account is saved.
- Tokens are refreshed shortly before expiry under a lock shared by the side panel and the background worker, so a rotating refresh token is never used twice. If OpenAI reports the session ended, the tokens are removed and the account shows as signed out.
- Only a response that ends with `response.completed` is used. Its text has credentials redacted and is validated against the task-action schema before a proposal is shown.

## Where the session is stored

Tokens are kept in `chrome.storage.local`, which is private to this extension in this browser profile and is not readable by web pages. In-progress sign-in state is kept in `chrome.storage.session` (memory only). Tokens are never written to IndexedDB, exports, chat context or logs.

This differs from OpenAI's guidance, which says to keep tokens out of browser storage and in protected local files. That guidance is what the removed helper implemented. Extension storage is not encrypted on disk, so anyone with access to your browser profile folder could read the session. Sign out when you stop using the extension on a shared machine.

Only one ChatGPT account can be signed in at a time. **Sign out** revokes the refresh token with OpenAI and removes the account entirely: tokens, email, client registration, saved model choice and that account's conversation. If revocation cannot be confirmed, also disconnect the app in your ChatGPT settings. **Delete all local data** signs out every account and removes saved sign-in data. Uninstalling the extension removes its storage but does not revoke the session with OpenAI, so sign out first.

## Tests

- `tests/chatgpt-direct.test.ts`: sign-in, forged and replayed redirects, timeout, identity checks, refresh rotation, ended sessions, streaming and redaction, sign-out.
- `tests/extension/chatgpt-signin.spec.ts`: the built extension in Chromium completes sign-in through a real tab redirect to an unused loopback port, exchanges the code in the service worker, loads models and approves a proposal. OpenAI's servers are replaced by test responses.
- `tests/e2e/chatgpt.spec.ts`: settings and chat with a signed-in session and mocked OpenAI responses.

No automated test talks to OpenAI. Real sign-in and plan eligibility can only be confirmed in your own browser.

Official references:
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
