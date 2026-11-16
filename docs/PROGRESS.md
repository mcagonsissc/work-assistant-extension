# Progress

## Phase 1 — accepted by user

Implemented the MV3 native side panel, manual task CRUD with IndexedDB persistence, remembered tabs, dark/light themes, JSON export and confirmed deletion. The user loaded the extension in Edge and confirmed it works. Initial validation included a successful build/type-check, five storage tests and three browser workflows.

## Phase 2 — implemented and automated checks passed

Implemented:
- Persisted work hours, working days, IANA timezone, lunch, extra breaks, notification types, lead time, periodic check-ins and quiet periods.
- Manual meeting creation/editing/confirmed deletion, with timezone-aware datetime input and revised-plan previews.
- Pure deterministic scheduling: occupied-interval union, fixed-event overlap warnings, priority/deadline/dependency ordering, task splitting, overflow and exhausted-estimate reporting.
- Timezone/DST handling and overnight start-date workdays. Ambiguous/nonexistent manual local times are rejected explicitly.
- Chronological dated timeline, upcoming meeting, saved plan previews, approve/reject, 60-second expiry, stale-input rejection and stale-plan notices.
- Transactional estimate extension with the plan; completed history preserved; completed/deferred/moved tasks release unused future blocks. Adjacent overlapping plans retain their own records and reserve capacity.
- Dependency selection, deleted-prerequisite removal and transactional cycle rejection.
- Timestamp-based focus start/pause/resume/complete, one active session, actual time and elapsed/remaining display. Closing the sidebar/browser does not reset or pause a running timer.
- Offline periodic/task-end check-ins with Completed, Need more time (+30m), Pause and Skip for now.
- MV3 alarm reconstruction, one-minute maintenance, task/meeting/break/workday-end notifications, quiet/opt-out behavior, duplicate-attempt prevention and delivery error metadata. Notification defaults remain off.
- IndexedDB v1→v2 migration; extended versioned export; installation, use, architecture and test documentation. Packaged output rebuilt in `dist` as v0.2.0.

Validation on November 12, 2026:
- `npm run lint`: passes (TypeScript).
- `npm run build`: passes, including bundled worker, manifest, local assets and notification icon.
- `npm test`: **42 tests pass** across scheduling, focus, plan transactions, migration, task lifecycle and reminder logic.
- `npm run test:e2e`: **5 Chromium workflows pass**: task CRUD/reload; theme/navigation/export/clear; narrow layouts/themes; planning/splitting/overflow/chronological persisted timeline and focus recovery; offline progress check-ins and approval/rejection of additional time.
- `npm run test:extension`: **1 packaged-extension test passes**. Loads `dist` into Chromium, verifies worker permissions/alarms, reopens the panel with an active timer, clears/reconstructs reminder alarms, closes and restarts Chromium with the same profile, verifies session/alarm recovery, and pauses the timer.
- Updated planned-day screenshot reviewed. A saved timeline ordering issue found during visual review was fixed and now has a browser regression assertion.
- Latest dependency installation audit reported zero known vulnerabilities.

Remaining acceptance checks / limits:
- Reload the v0.2 extension in native Edge and confirm the newly added alarm/notification permissions. Existing data migration is automated-tested, but native Edge update behavior still needs a manual smoke check.
- Verify actual OS notification display in Edge. Headless Chromium tests verify alarm/lifecycle behavior; reminder unit tests verify delivery claims/preferences/failures. They do not prove a notification was visibly displayed by the operating system.
- No external credentials block Phase 2. Native Edge/OS verification is the remaining manual acceptance step.
- Browser/OS suspension may delay alarms; stale reminders expire. At-most-once delivery claims can lose a notification if the worker crashes between its claim and the OS call; panel check-ins remain available.
- Replanning after task changes is explicit. Manual meeting changes and extra-time actions automatically open a preview, but approval remains required. Task/break reminders from stale plans are suspended; meetings and configured workday-end reminders operate independently.
- Zod dependency comments produce harmless Rollup annotation warnings. Vite also reports a side-panel bundle size advisory (~667 kB before gzip); performance/code-splitting can be addressed during Phase 5.
- Export is implemented; import remains future work. At the end of Phase 2, AI and Outlook were not implemented; current AI progress is recorded below.

## Phase 3 — implemented; live authenticated model acceptance pending

Implemented:
- Isolated OpenRouter provider adapter; live model discovery with text/free/capability metadata, cached catalog, search and manual model ID fallback. No hardcoded/default model or automatic paid fallback.
- Separate local key/config storage, password-field clearing, key removal, explicit sharing consent and local-storage security disclosure. No content scripts or shared API secrets. Manifest v0.3 adds only OpenRouter host access and a connect-src allowlist.
- Persistent AI Chat, questions without actions, recent conversation context, selectable date/scope and optional description sharing. Meeting titles, webpages, raw focus history, keys and notification preferences are omitted.
- Strict bounded action schemas for task creation/categorization, field updates, completion, postponement/deferral, duration extension, manual meeting creation and local rescheduling. Client references resolve to app-generated IDs; unsupported actions, invalid fields/IDs, cycles/conflicts, invalid dates/durations and oversized batches are rejected.
- In-memory proposal diffs, deterministic schedule/overflow previews, approval/rejection/refresh, snapshot/expiry checks and atomic commitment of tasks, focus sessions, meetings, blocks and affected plans. Multi-day meetings recalculate each affected date. No task writes occur before approval. Duplicate approvals fail.
- Schema-guided text for models without advertised structured output; strict JSON Schema where advertised. At most two total attempts for malformed output/unsupported structured formatting; no automatic retry on rate limits or provider outages.
- 30-second per-attempt timeouts, cancellation, safe error messages, explicit retry, interruption recovery and late-response safeguards. Attempt identities prevent a late original response from overwriting its retry. Message sequence numbers preserve conversation order under equal timestamps.
- Credential redaction in requests/responses and an explicit versioned export allowlist excluding all AI tables/internal plan fingerprints. Clear chat leaves approved work intact; delete all data also deletes the saved key.
- Manual category editing and an Ask AI dashboard shortcut that fills a draft without sending automatically. README includes configuration, privacy, supported actions, failure behavior and a live smoke-test procedure.

Validation on November 12, 2026:
- TypeScript/build pass. `dist` rebuilt as **v0.3.0** with local bundled scripts and worker.
- **82 Vitest tests pass** across existing scheduling/focus/reminders and new AI/provider/context/config/migration/proposal/transaction/retry/security logic.
- **8 Chromium browser workflows pass**, including the original five workflows and AI discovery/configuration, rejection/approval/reload/export, existing-task extension/postponement, rate-limit retry and offline manual task creation.
- **2 packaged-extension tests pass**: worker/alarm/focus recovery through a full Chromium process restart, plus model discovery/schema-guided requests/approval under the built extension’s actual OpenRouter permission/CSP.
- The actual provider adapter was exercised against the public OpenRouter catalog without credentials; metadata normalization and free/structured capability filtering succeeded. No credential was supplied and no billable completion was requested.
- Completions in automated tests use explicitly mocked responses. These verify request construction, validation, local behavior and errors; they do not establish live output quality or account authorization.
- Browser testing caught and fixed a browser-only native fetch receiver issue that Node tests could not reveal. Browser model selection, conversation ordering and narrow proposal layout have regression coverage; the 320px proposal screenshot was reviewed.

Remaining checks / limits:
- Configure your own key/model/consent locally in the installed extension and follow README’s live-model smoke test. Real quota, billing/access policy, availability and model output quality remain unverified without that configuration. No credentials are required for automated tests or manual planning.
- Reload v0.3 in Edge and accept the new OpenRouter host permission if prompted. Native Edge/OS notification display from Phase 2 still needs a manual check; Chromium tests do not prove OS-visible delivery.
- Pending proposals expire after 60 seconds; refresh recalculates locally but never applies automatically. Times are rechecked at approval and can advance slightly from the preview. Batches are limited to 24 actions/seven dates.
- Context is intentionally bounded and may omit tasks outside its selected scope; the UI exposes scope/description controls. AI cannot change work settings, start timers, delete data or access/write Outlook.
- Build retains harmless Zod annotation warnings and a Vite side-panel size advisory (~716 kB before gzip). Performance/code splitting remains Phase 5 work. Import is not implemented.

Next recommended step: perform the live-key/Edge smoke checks, then Phase 4 read-only Outlook integration using an application registration and delegated PKCE authorization. Outlook is not implemented or simulated.


## Provider expansion — v0.4 implemented

OpenAI API and Gemini API are now supported alongside OpenRouter. Microsoft/Outlook integration has been deferred at the user's request; the current next milestone is daily-use stabilization.

Implemented:
- Persisted provider selector, separate per-provider key/model/consent/catalog, and independent chat histories. Existing OpenRouter v3 credentials, catalog, conversations and pending proposals remain intact through IndexedDB v4 migration.
- OpenAI authenticated model discovery and native Responses API adapter (`input`, `text.format`, `store:false`, nested assistant output parsing). Conservative text-family catalog filtering, no default model, and manual model IDs remain available.
- Gemini authenticated paginated discovery and native generateContent adapter, model-resource normalization, system/history role mapping, bounded pagination, JSON Schema requests and non-thought text parsing. Keys are sent in headers rather than URL queries.
- Shared HTTP safeguards for all providers: fixed hosts, refused redirects, cookie/referrer omission, bounded response sizes, cancellation/timeouts, sanitized auth/quota/provider errors and bounded same-model corrective/text-format retry. No automatic provider or paid-model fallback.
- OpenAI/Gemini discovery can use an unsaved key entered in Settings; it sends no task context and does not persist that draft key. The direct catalogs do not establish pricing/free-tier eligibility, so the OpenRouter-only free filter is not shown for them.
- All saved keys are redacted from context, structured responses and exports. Catalog names are sanitized and credential-shaped model IDs rejected. Forget key/clear chat affect only the selected provider; deleting all data still clears every provider.
- Provider/configuration revisions invalidate late responses, including switching away and back. Same-provider conversation filtering prevents automatically forwarding another provider's messages. Pending network requests cancel when leaving/switching; the Today draft shortcut remains a draft rather than auto-sending.
- Shared strict schema, local deterministic scheduler, proposal projection, expiration/staleness checks, reject/refresh and atomic approval reused for every provider. AI still cannot directly mutate work data.
- Manifest/CSP permits exactly OpenRouter, api.openai.com and generativelanguage.googleapis.com, with no content scripts or configurable arbitrary endpoints. Built release is v0.4.0. Settings now describes manual meetings instead of promising future Microsoft integration.
- Updated README, architecture, requirements, milestones and dedicated PROVIDERS.md setup/protocol/privacy guide.

Validation on November 12, 2026:
- TypeScript/lint and production build pass; current `dist` is v0.4.0.
- **118 Vitest tests pass** across existing workflows plus direct-provider request/response shapes, header authentication, discovery/pagination/filtering, retry/error/cancellation, migration, key/history isolation, cross-provider late responses and export/catalog redaction.
- **10 Chromium browser workflows pass**, covering legacy manual/OpenRouter functionality plus independent OpenAI/Gemini setup, task previews/approval, reload/history persistence, provider switching, export/forget-key isolation, 320px layout, pending-request cancellation and the dashboard draft shortcut.
- **4 packaged-extension tests pass**: worker/alarms/focus restart recovery, OpenRouter approval, and native OpenAI/Gemini discovery/approval/reload using the built extension's actual host permissions/CSP.
- Gemini settings screenshot reviewed at 320px. Password fields are empty after save and no known test credentials appear in exported data or chat context.

Limits / remaining acceptance:
- Authenticated catalogs/completions in tests are explicitly mocked. No real OpenAI/Gemini keys were supplied, no billable completion was requested, and live account authorization/quota/model compatibility/output quality remain unverified. Configure keys only locally in the installed extension and follow PROVIDERS.md's smoke checks.
- Reload v0.4 in Edge and accept added OpenAI/Gemini host access if prompted. Native Edge/OS-visible notification delivery remains a manual check from Phase 2.
- ChatGPT account sign-in is not implemented; this change uses API keys. Corporate/project key restrictions can still prevent direct model access, surfaced as safe errors.
- OpenAI's catalog lacks explicit modality/Responses/schema metadata, so likely text model families are filtered conservatively and compatibility is checked on Send. Gemini generation support does not guarantee account-specific access or pricing. Manual model entry remains available.
- Existing harmless Zod annotation warnings and Vite's side-panel size advisory (~728 kB before gzip) remain; code splitting/performance review belongs to stabilization. No new dependency or backend was added.

Next: live local-key checks for both providers and Edge daily-use verification, then accessibility, performance and release packaging. Microsoft integration remains deferred.

## v0.5 — ChatGPT plan sign-in

- Added a separate ChatGPT plan provider, Continue with ChatGPT, saved account selection, explicit plan consent, account-scoped history, dynamic model discovery, first-use notice and Manage usage. API-key providers remain independent.
- Added an on-demand native messaging helper using official dynamic client registration, stable host identity, loopback PKCE/state/nonce and JOSE identity verification. OAuth credentials remain in protected atomic local files, with serialized refresh rotation and sign-out/revocation; issued client mappings survive sign-out.
- Public streaming Responses requests use store:false, stream:true and completed-only output. Interrupted/failed streams and invalid task actions cannot produce proposals. Existing transactional task approval remains required. No private ChatGPT endpoints, imported Codex credentials or billing fallback.
- Prepared one-time Edge/Chrome/Chromium installer and target-OS setup/uninstall guidance in CHATGPT_SIGNIN.md. Linux installer preview generated in /tmp; no host installed into the user's actual browser profile.
- Production build and TypeScript pass. 131 unit/integration tests, 11 browser workflows and 4 packaged-extension checks pass; ChatGPT browser OAuth/inference is mocked. Real native framing and loopback callback checks run as subprocess/network integration tests. Existing Zod comment and bundle-size build advisories remain.
- Real ChatGPT sign-in/plan eligibility and target Edge native registration require the user's local smoke test. Windows/macOS installation paths are implemented but not run on those operating systems here.

## WSL ChatGPT companion transport

- Added a loopback HTTP companion and explicit Native helper / WSL companion selector with saved pairing. No Windows Node.js or native-host registration required for this mode. No managed policy settings were changed.
- Shared strict protocol dispatcher; pairing/host/origin/extension checks; bounded requests, response sizes and timeouts; cancellation propagates on client disconnect. OAuth tokens remain in protected WSL files. Windows browser launch uses encoded PowerShell arguments through WSL interoperability.
- Browser pairing credential is excluded from exports and redacted from context. Deleting browser data clears pairing while leaving companion OAuth sign-out explicit.
- Verified real Windows-to-WSL localhost reachability (HTTP 200), 136 unit/integration tests, 11 browser workflows and 5 packaged-extension checks. The new packaged check uses the real HTTP companion with mocked ChatGPT identity/inference and exercises incorrect pairing plus successful task approval. Live OAuth eligibility remains unverified.

## Compact chat layout and keyboard sending

- AI Chat uses a viewport-height flex layout with an independently scrolling conversation and an always-visible bottom composer. Branding/header are compact, provider/account details are reduced, and context controls live in a closed-by-default Chat options popup. Global settings notices are cleared when navigating to Chat.
- Enter submits a valid message; Shift+Enter inserts a newline. IME composition, empty messages, busy requests, missing configuration and offline mode cannot trigger keyboard sends. Conversation follows new messages when near the bottom without jumping away from older messages being read.
- Production build and TypeScript pass. Twelve browser workflows pass, including a new multi-message test at 360×600 and 320×420 that checks composer visibility, no page overflow, multiline input and IME handling.

## Version 0.6: built-in ChatGPT sign-in, simpler interface

- ChatGPT plan sign-in now runs entirely inside the extension. The native messaging helper, WSL companion, installer script and pairing code were removed, along with the `nativeMessaging` permission. New permissions: `storage`, `https://auth.openai.com/*`, `http://127.0.0.1/*`.
- Tokens are stored in `chrome.storage.local`. This departs from OpenAI's guidance to keep tokens out of browser storage; see CHATGPT_SIGNIN.md.
- Models load automatically after sign-in. Failed ChatGPT streams now show OpenAI's own error code and message.
- Interface restyled: larger type, card-based settings, shorter copy, simpler header, sharing details moved behind "What gets shared?".
- The assistant's instructions now require it to ask for missing details (meeting times, which task, target date) before proposing changes, and to say plainly that it cannot delete tasks or edit existing meetings.
- 125 unit tests, 12 browser workflows and 5 packaged-extension checks pass. OpenAI is mocked in all of them.
- Added Claude as an API-key provider (`src/services/ai/claude.ts`, official Anthropic SDK, structured outputs with a text fallback, no automatic retries or model fallback). New host permission: `https://api.anthropic.com/*`.
- ChatGPT: one account at a time. Signing out removes the account, its saved details and its conversation from the extension. Saved API keys for other providers are kept; only the selected provider is used.
- Tasks have a Notes field (task form and task list). The assistant can append notes with a new `add_note` action, shown for approval like any other change. Notes are sent to the AI only when "Include task descriptions and notes" is on.
- Assistant instructions: it now holds a productivity-focused conversation and proposes changes only when explicitly asked; remarks and small talk never create tasks.
- System notifications are on by default for new installs, check-ins stay on screen until dismissed, and Settings has a "Send a test notification" button.
- AI Chat is the first tab and opens by default; the message box clears as soon as you send. Settings has an Assistant name field, shown in chat and passed to the model.
