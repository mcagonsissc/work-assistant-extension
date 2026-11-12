# AI Workday Assistant

A local-first Microsoft Edge side-panel extension. Manual tasks, scheduling, focus tracking and reminders work without AI or a backend. OpenRouter, OpenAI API and Gemini API propose validated task and schedule changes for your approval. Microsoft/Outlook integration is deferred at the user’s request.

## Development

Requires Node.js 22.12+ and npm (validated with Node.js 22).

```sh
npm install
npm run dev
npm run lint
npm test
npm run build
```

Open the Vite URL for a browser preview. Preview data is separate from the installed extension. Browser alarms and OS notifications require the installed extension; panel check-ins also work in preview. Production builds bundle all scripts locally.

## Install or update in Microsoft Edge

1. Run `npm run build`.
2. Visit `edge://extensions` and enable Developer mode.
3. **Load unpacked** and choose this project's `dist` folder, or **Reload** the existing installation after rebuilding.
4. Accept the `alarms`, `notifications` and provider host permissions if Edge prompts. Version 0.4 adds `https://api.openai.com/*` and `https://generativelanguage.googleapis.com/*` alongside OpenRouter for direct-provider requests. Re-enable the extension if needed.
5. Click its pinned toolbar icon to open the native side panel.

Keep the same unpacked directory when updating to retain existing data. IndexedDB v1/v2 work data migrates automatically to v4 without removing tasks, settings or sessions. Export a backup before updating. Uninstalling or clearing browser storage can remove data.

## Plan and execute a day

1. In **Settings**, save your timezone (e.g. `America/St_Johns`), work hours, working days, lunch and optional breaks. An end earlier than the start creates an overnight shift anchored to its starting date.
2. Add tasks in **Today**, with estimates, priorities, deadlines and optional dependencies. Today uses your configured timezone and active shift date. **All tasks** includes unscheduled, deferred and other-date tasks.
3. Add manual meetings, including their dates and times in the configured timezone. Meetings can overlap; the planner reports conflicts and reserves their combined occupied time.
4. Select a plan date, **Preview plan**, inspect the timeline and overflow, then **Approve plan** or **Reject plan**. Meeting changes automatically open a revised preview. Previews expire after 60 seconds and cannot apply if their input data changed.
5. Start focus from a task, then pause/resume or complete it. Only one timer runs at a time. Timestamps recover after the panel, worker or browser restarts. Closing the browser does not pause a running task; pause it before leaving if that time should not count.
6. Use **+30 min** or a progress check-in to propose additional time and a revised schedule. Approve to save the estimate and plan together; rejection leaves the estimate unchanged. If already overdue, the new estimate includes elapsed work plus 30 usable minutes.
7. After completion, deferral, priority/date changes or pausing, preview the remaining day again. Stale timelines are labeled and their task/break reminders are suspended until reapproved. Fixed meetings retain independent reminders.

Unscheduled tasks are eligible for a selected plan and assigned that date on approval. Tasks explicitly dated elsewhere stay there. The scheduler respects deadlines, splits work across gaps, preserves elapsed history and reports overflow rather than allocating new work outside hours. An exhausted estimate does not mean a task is completed: complete it or add time. Missing prerequisites remain blocked; remove a deleted prerequisite in the task editor if appropriate. Workday progress counts tasks only, never meetings or breaks.

## Reminders and check-ins

Browser notifications are **off by default**. Enable them in Settings, choose reminder types, lead time and quiet hours. Periodic check-in frequency 0 disables periodic prompts; scheduled task-end prompts remain available. Check-ins offer Completed, Need more time (+30m), Pause and Skip for now in the panel. Notification text directs you to these controls; click the Workday toolbar icon to open them.

Edge must be running and OS notifications must be allowed. Alarms can be delayed after sleep; expired reminders are dropped instead of replaying an old day's notifications. A persisted delivery claim prevents duplicate attempts after worker restarts. A crash between claiming a reminder and calling the OS can lose that one notification; the timeline and panel check-ins remain available. Workday-end reminders follow configured working days and hours even without an approved plan. Quiet hours suppress OS notifications, including workday-end reminders. Equal quiet-hour start/end means quiet all day.

Alarm metadata is stored in IndexedDB, rebuilt on worker startup and checked by a one-minute maintenance alarm. At most 400 upcoming reminder alarms are installed at once; maintenance advances the queue. Notifications are not a guarantee of OS delivery. Settings, tasks, calendar events and focus sessions remain local and work offline. AI requests share only the selected context when you Send.

## Tests

```sh
npx playwright install chromium
npm test
npm run test:e2e
npm run build
npm run test:extension
```

Vitest covers scheduling, deadlines/dependencies, timezone/DST/overnight work, persistence/migration, focus recovery, transactional approvals, reminder deduplication, AI schemas/provider errors, timeout/cancellation, credential redaction/export exclusion, request retry races and proposal rollback. Browser E2E tests cover task CRUD, settings, export/deletion, responsive layout, planning/overflow, timer reload recovery offline check-ins, model configuration, AI review/rejection/approval, natural-language update fixtures, rate-limit retry and offline manual use. AI responses in these tests are explicitly mocked. The extension tests load `dist` into Chromium, verify worker/alarms, reopen the panel, clear/reconstruct alarms, and restart Chromium with the same profile to verify recovery. Additional tests exercise mocked AI requests for all three providers under the packaged extension’s real host permission/CSP and applies a validated proposal. On Linux, Playwright may also require OS browser dependencies.

Native Edge sidebar rendering and actual OS notification display still require a manual smoke test. Suggested check: enable notifications, set a one-minute check-in, start a task, close the panel, wait for the prompt, reopen and pause, then restart Edge and confirm the paused timer and approved schedule remain intact. Restore your preferred check-in interval afterward.

## Export and deletion

Settings exports versioned JSON containing tasks, blocks, sessions, events, workday settings and approved plans. Preferences, credentials, model cache, chat, AI proposals and internal plan fingerprints are excluded. Known key patterns and the saved key are redacted even if they occur in task text. Confirmed deletion clears all IndexedDB work data/settings, saved AI credentials and conversation and cancels related reminders; the selected theme/tab remains a separate UI preference. There is no import feature yet.

## Configure AI providers

1. Open **Settings → AI provider** and select **OpenRouter**, **OpenAI** or **Gemini**.
2. Enter that provider’s key locally. OpenAI keys come from the [OpenAI API platform](https://platform.openai.com/api-keys); Gemini keys come from [Google AI Studio](https://aistudio.google.com/apikey). Do not paste keys into this development conversation.
3. Click **Refresh models**. OpenAI/Gemini discovery uses the entered key without saving it first; OpenRouter discovery is public. Select a model or enter a model ID manually.
4. Enable that provider’s data-sharing consent, then **Save AI settings**. Open **AI Chat** to test it.

Keys, models, consent, cached catalogs and conversations are separate per provider. Switching clears unsaved fields/cancels in-flight requests but preserves saved settings and work. The chat only displays/forwards the selected provider’s conversation. **Forget key** and **Clear chat** affect only the selected provider. OpenRouter has the catalog-based free filter; the direct catalogs do not establish pricing or free-tier eligibility. No provider is selected as a fallback automatically.

OpenAI uses an API key and the Responses API. ChatGPT account sign-in is not implemented. Gemini uses the native generateContent API with its key in a header, never a URL. Both use the existing deterministic scheduling/approval boundary. See [provider architecture and live checks](docs/PROVIDERS.md).

### OpenRouter setup details

1. Obtain your own API key from [OpenRouter](https://openrouter.ai/settings/keys). Enter it **locally in Settings → AI provider → OpenRouter**, not in this development conversation.
2. Click **Refresh models**, leave **Show free models only** enabled if desired, and select a discovered model. You may also enter a model ID manually if discovery is unavailable. No default model is hardcoded and there is no automatic paid-model fallback.
3. Read and enable the data-sharing checkbox, then **Save AI settings**. The password field clears after saving; it never reveals the stored key. **Forget key** removes it and disables AI data sharing while keeping tasks/chat.
4. Open **AI Chat**, optionally choose the planning date/task scope under **Context & privacy**, and send a request. The Today shortcut fills a draft; it never sends automatically.
5. Review proposed task changes, meetings, local schedule, warnings and overflow. **Approve changes** commits the changes and affected plans together; **Reject changes** leaves work data unchanged. Only chat/proposal records are stored before approval.
6. Proposals expire after 60 seconds and are rejected if tasks, focus or work constraints changed. **Refresh preview** recalculates locally without another AI call; review the new result before approving. Actual times are rechecked at approval, using the deterministic scheduler.

Try “Plan my day”, “Add a task to review API documentation”, “I need another 45 minutes for development”, “Move documentation to tomorrow”, “I finished the task early”, “Rearrange my afternoon” or questions about remaining tasks. Be specific when multiple tasks have similar names. The assistant asks for clarification via an answer without actions. Task categories are editable manually too.

The action allowlist supports creation, selected field updates, completion, deferral/postponement, duration extension, manual meeting creation and rescheduling (at most 24 actions/seven affected days per proposal). It cannot change work settings, start a timer, delete records, touch arbitrary database fields, access webpages or write Outlook events. Those controls stay manual. Clearing a scheduled date defers the task so the planner does not immediately schedule it again. Busy meetings may overlap; the local engine reports the conflict and reserves their combined occupied time.

### AI privacy, storage and failures

Each user-supplied key is stored in its own provider-specific extension-local IndexedDB record. **Local extension storage is not a secure server-side secret vault.** There is no shared provider key, content script or backend. In production, requests run in the extension side panel and can connect only to the three configured provider hosts (plus the extension itself). A future public product with managed billing should use a backend proxy. Development preview has a separate localhost origin and separate data; configure real keys only in a development environment you trust.

Each Send shares your request, current time/timezone, relevant work constraints, up to 80 task summaries plus prerequisites (120 total), up to 80 busy time windows/160 relevant blocks, and six recent completed conversation messages from the selected provider only. Day scope includes the selected day, next calendar day, unscheduled tasks and active focus tasks; All dates broadens the task selection. Descriptions are excluded unless explicitly enabled (500 characters each). Meeting titles, webpages, notification settings, credentials and raw focus history are excluded. Context reports omissions; select a broader scope or identify tasks clearly if needed.

OpenRouter model metadata controls strict structured output; direct providers attempt their native JSON Schema format first. Other models use schema-guided JSON text, and every response is validated locally. Invalid output gets at most one corrective request; rejected structured formatting can use that one retry in text mode with the same model. **Retries may incur model charges.** Rate limits, authorization/credits failures and outages do not trigger automatic model fallback. HTTP/provider errors are converted to safe messages; raw upstream bodies/headers are never shown or logged. Requests have a 30-second timeout per attempt, cancellation and explicit retry controls. Manual tasks/scheduling remain usable offline.

Chat and proposal status persist locally. Closing/leaving AI Chat cancels the in-panel request where possible; interrupted requests can be retried with fresh context. A late response cannot recreate cleared chat or overwrite a newer retry. Typing “yes” does not bypass the approval controls. **Clear chat** deletes the selected provider’s conversation/proposals but keeps already approved tasks/plans. Delete all local data also removes the key. Chat and keys are never part of task exports.

### Live acceptance check

Public catalog discovery has been verified against OpenRouter without a key. Authenticated OpenAI/Gemini catalogs and all completions use explicitly mocked responses in tests; no real account access is claimed. To check a live model: reload the extension, save your key/model/consent, ask “Add a 30-minute task to review documentation”, reject the first proposal and confirm Today is unchanged, then repeat and approve. Confirm one task and a conflict-free schedule appear in Today. Try a question, a duration extension and a move to tomorrow. Availability, quota, structured-output quality and account authorization depend on your selected provider/model; malformed results are rejected rather than applied.

## Outlook

Microsoft/Outlook integration is deferred at the user’s request. Manual meetings remain available. The next development milestone is daily-use stabilization, accessibility and performance work. No Outlook connection is simulated.

See [architecture](docs/ARCHITECTURE.md), [requirements](docs/REQUIREMENTS.md), [implementation plan](docs/IMPLEMENTATION_PLAN.md) and [progress](docs/PROGRESS.md).
