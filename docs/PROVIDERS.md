# AI providers

Version 0.6 supports OpenRouter, OpenAI API, Gemini API, Claude API (Anthropic API key, through the official `@anthropic-ai/sdk`) and ChatGPT plan sign-in built into the extension. Claude subscriptions cannot be used: Anthropic's terms do not allow subscription sign-in in third-party apps. See [ChatGPT setup](CHATGPT_SIGNIN.md). Microsoft integration remains deferred at the user's request.

## Configuration and migration

Settings has a persisted **AI provider** selector. Each provider has its own key, model ID, sharing consent and model catalog. Switching clears unsaved fields and cancels in-flight requests; it does not delete keys, conversations or approved work. Forget key affects only that provider. Save AI settings clears the password field and never reveals the saved key.

OpenRouter discovery is public. OpenAI/Gemini discovery uses the key entered in the form, or the provider's saved key. An unsaved key can discover models without first choosing a model or being persisted. Discovery sends no task context. Model catalogs are separate and cached only after successful validation. Echoed key text is redacted, and credential-shaped IDs are rejected.

IndexedDB v4 adds an active-provider preference. Existing v3 OpenRouter configuration, catalog, chat and pending proposals remain intact and default to OpenRouter. Older messages/proposals without provider metadata are treated as OpenRouter. No existing credentials are copied to another provider.

Pricing metadata exists in the OpenRouter catalog. Its free filter remains available only there. The direct catalogs do not establish model pricing or account-specific free-tier eligibility; no direct model is labeled free or automatically selected. Manual model ID entry remains available. No provider/model fallback is automatic.

## Protocols

| Provider | Discovery | Generation | Authentication |
|---|---|---|---|
| OpenRouter | `GET https://openrouter.ai/api/v1/models` | `/api/v1/chat/completions` | Bearer key for generation; public discovery |
| OpenAI | `GET https://api.openai.com/v1/models` | `/v1/responses` | Bearer key for discovery/generation |
| Gemini | `GET https://generativelanguage.googleapis.com/v1beta/models` | `/v1beta/models/{id}:generateContent` | `x-goog-api-key` header; never a query-string key |

OpenAI sends `input`, requests JSON Schema through `text.format`, disables response storage with `store:false`, and extracts assistant `output_text` parts from the response's `output` array. This storage flag is not a claim about all provider retention policies. The models catalog lacks compatibility metadata: likely text model families are filtered conservatively, while Responses/schema access is validated when used. No fixed model version is embedded.

Gemini discovery follows bounded pagination, uses `supportedGenerationMethods` to select generation candidates, and filters clearly non-text model families. Resource names `models/{id}` normalize to simple IDs. Request URLs validate/encode model IDs; pagination tokens are encoded and never interpreted as URLs. System instructions and user/model turns map to Gemini content parts, merging adjacent turns of the same role. `generationConfig` requests `responseMimeType: application/json` plus `responseJsonSchema`. Only stopped candidates' non-thought text is parsed. Blocked, truncated, malformed and thought-only outputs cannot become proposals.

The three API-key adapters use a shared HTTP transport with fixed base URLs, no cookies/referrer, refused redirects, size limits, a 30-second per-request timeout, cancellation and sanitized errors. Auth/quota/network/HTTP/embedded provider errors never echo response bodies or headers. Invalid output gets at most one corrective attempt; a 400/422 rejection of structured formatting can consume that retry in text mode with the same provider/model. Rate limits and outages do not trigger automatic paid-model/provider fallback.

## Shared approval and privacy boundary

The same strict action schema, in-memory projection, deterministic scheduler, expiration/snapshot checks and atomic approval apply to every provider. No model can directly mutate work data. Local approval/refresh/rejection remains available without a network request. New tasks retain AI source metadata.

Only the active provider's key is used for its HTTP requests. All saved provider keys are redacted from outbound context, stored response text and exports. Current-provider history only is forwarded; another provider's conversation is not sent automatically. The Chat view shows the selected provider's history. Clear chat clears only that provider's messages/proposals, retaining other histories and all approved tasks/plans. Delete all local data clears every provider's data and returns selection to the OpenRouter default.

Selection/configuration revisions invalidate late responses, including switching away and back while a request is pending. Attempt identities continue to prevent a late original response overwriting its retry. Retrying a foreign provider's interrupted request requires switching back to that provider.

The manifest grants only the three exact provider hosts and enforces the same `connect-src` allowlist. No content scripts, arbitrary endpoint settings, shared API key or backend are introduced. Keys remain user-supplied, extension-local secrets with the existing explicit disclosure; a managed public product should use server-side credential handling.

## Validation and live checks

Automated tests explicitly mock authenticated catalog/completion responses. They cover protocol shapes, auth headers, parsing, bounded retries, failures, pagination, cross-provider isolation, export redaction, legacy migration, browser switching/cancellation and built-extension host/CSP behavior. They cannot establish your account's live access, billing/quota or model compatibility.

For each provider, enter a real key only in the installed extension, refresh models or enter a compatible ID, enable that provider's sharing consent and save. Ask for one 30-minute task, reject the first proposal, then repeat and approve. Verify Today only changes after approval. Switch to another provider and confirm its settings/history start independently; switch back and confirm the first provider's settings/history remain. Try an invalid key and confirm a safe error without losing manual planning.

Official references: [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Gemini model discovery](https://aistudio.google.com/api-reference/models/list-models), [Gemini generateContent](https://aistudio.google.com/api-reference/generate-content/generate-content).

ChatGPT plan uses OAuth instead of an API key: official dynamic registration, a loopback redirect captured by the extension, tokens in extension-private storage and streaming-only public Responses. It does not use the API-key model envelope. It makes one attempt per Send; unsupported/invalid output requires explicit retry. See CHATGPT_SIGNIN.md.
