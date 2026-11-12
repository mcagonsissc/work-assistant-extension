# Architecture

A local-first Manifest V3 extension. Vite builds a React side panel and an extension service worker; no content script or backend is required. Dexie live queries render persisted state. Zustand stores only tab/theme preferences. UI uses Tailwind, Lucide and a shadcn-style Radix Button primitive.

## Data and storage

IndexedDB schema v4 preserves v1 task/block/session/event tables and adds workday settings, approved plans and reminder metadata (v2), plus separate AI config/model-cache/chat/proposal tables (v3), and active-provider preferences (v4). Tests cover upgrades from v1/v2/v3, retaining sessions, settings, OpenRouter credentials, catalog and conversation.

- Task: stable UUID, title/description, priority, status, estimatedMinutes, closed-session actualSeconds, deadline (UTC ISO), scheduledDate (workday-start date), timestamps, source, optional category and dependencyIds. Zod validates writes. Dependency cycles are rejected transactionally. A missing/deferred/circular prerequisite produces explicit scheduling overflow.
- ScheduledBlock: deterministic ID, taskId or calendarEventId, kind (task/meeting/break), UTC ISO start/end, fixed flag, optional title and planDate. Multiple blocks can reference one task.
- FocusSession: UUID, taskId, startedAt and optional endedAt. A closed session is credited exactly once to the task. Active elapsed time is computed from its start timestamp plus already credited task time.
- CalendarEvent: UUID, optional externalId, manual/outlook source, title, UTC ISO start/end, source timezone, busy flag and optional synchronization timestamp. Only manual events exist currently.
- WorkdaySettings: singleton containing IANA timezone, local clock hours, ISO weekday numbers, lunch/breaks and notification/check-in/quiet preferences.
- DayPlan: workday date, timezone, window, overflow, warnings, approval timestamp and a scheduling-input fingerprint.
- Reminder: stable event identity, due/expiry timestamps, kind and related records, delivered/handled markers and delivery error.

## Scheduling

`services/scheduling/engine.ts` is a pure deterministic function with an explicit clock. It reserves fixed commitments, unions their occupied intervals, orders ready tasks by priority/deadline/stable tie-breakers, and allocates remaining actual work into gaps. Dependencies can consume later gaps without wasting earlier gaps available to independent work. Deadlines cap allocation. Completed/deferred tasks are excluded; completed blocks end at their completion instant. Elapsed history remains even after settings move working hours. Adjacent plans reserve overlapping time without being copied into the current plan. An unfinished task whose estimate is exhausted is flagged for completion/extension.

Temporal's bundled polyfill resolves IANA zones and DST. Scheduling configuration uses compatible disambiguation (earlier repeated clock time, shift forward through a skipped clock time). Manual event/deadline input rejects ambiguous/nonexistent wall-clock times rather than guessing. Overnight shifts anchor to their start date; actual elapsed minutes across DST may differ from wall-clock duration. Browser/OS timezone data determines offsets.

`previewPlan` reads a consistent snapshot without writes. Approval compares that snapshot transactionally and rejects previews older than 60 seconds or whose inputs changed. Approval writes blocks, unscheduled-task dates, optional estimate extension and plan metadata atomically. Task/calendar/settings changes conservatively mark prior plans stale. Notification-only preference changes do not invalidate planning. Replanning remains an explicit user action except meeting edits/extensions automatically open a proposal.

## Focus and lifecycle

Starting focus atomically closes another active session, credits its elapsed time, then starts a new one. Pause/complete/defer and manual status changes close sessions in the same transaction as task changes. UI intervals refresh display only; no timer depends on interval counts. An open session continues across browser closure until explicitly paused. DB reconnection and a real Chromium process restart are tested.

## Notifications

The worker uses the alarms and notifications APIs in an extension-owned context. On each worker load, installation/startup and data-change message it reconciles persisted reminder metadata with current task/calendar state. A one-minute maintenance alarm rebuilds missing alarms and queues at most 400 future reminders, below Chrome's alarm limit. Alarms do not keep the worker continuously alive.

Approved, fresh plans drive task/break reminders. Manual meetings have independent reminders; workday-end reminders follow configured working days and hours even without a plan. Session timestamps drive periodic check-ins without AI; task blocks also generate end check-ins. The panel can derive check-ins when previewed outside the extension. A persisted delivery claim made before OS notification creation provides at-most-once attempts; a crash between claim and OS call can lose a notification. Delivery failures are recorded and shown, never endlessly retried. Quiet hours/opt-out suppress OS notifications but retain check-in controls. Expired reminders are dropped after sleep. Handled/delivered markers are retained for seven days to prevent repeats during replanning.

References: [Chrome alarms lifecycle and persistence](https://developer.chrome.com/docs/extensions/reference/api/alarms), [notification API](https://developer.chrome.com/docs/extensions/reference/api/notifications), [Temporal timezone and disambiguation](https://tc39.es/proposal-temporal/docs/zoneddatetime.html).

## AI provider and approval boundary

`services/ai/provider.ts` defines a small adapter interface. `openrouter.ts` implements public model discovery and chat completions. `openai.ts` implements authenticated discovery and Responses API requests; `gemini.ts` implements paginated authenticated discovery and generateContent. A registry resolves only the selected provider; no automatic cross-provider fallback exists. Each adapter uses a fixed HTTPS base URL, and common HTTP safeguards live in `http.ts`. Catalog prices/modalities/capabilities are normalized; no model ID is baked in. Browser fetch is explicitly bound to its global receiver. Requests omit credentials/cookies, refuse redirects, bound body sizes, use cancellation/timeouts and map HTTP/embedded provider errors to safe messages. Supported models receive JSON Schema; others receive the same schema as instructions. Two total attempts are allowed only for invalid output or a rejected structured format. There is no paid-model fallback or automatic rate-limit retry.

The response schema is strict and bounded to 24 allowlisted actions. Nullable patch fields stay required for compatibility with strict providers; null means unchanged. App code resolves new-task client references to generated UUIDs, rejects hidden/missing task IDs, conflicts, cyclic prerequisites, invalid durations/times and proposals affecting more than seven workdays. AI cannot mutate settings, start timers, delete records or call arbitrary tools. Manual meetings from AI remain local events.

`context.ts` selects bounded workday summaries and reports omissions. Task descriptions require an explicit option. Meeting titles, notification settings, webpage content, API keys and raw sessions are absent. Recent history includes completed conversation text only. Task data is marked untrusted in the system prompt; application validation and human approval remain the actual boundary against prompt injection.

`proposals.ts` projects changes into an in-memory snapshot and invokes the existing pure scheduler for affected dates. No task/event/session/block writes occur during generation, preview or rejection. Pending proposals persist local diffs, task labels, calculated previews, generated ID mappings and a workday signature. Approval re-reads the proposal in a transaction, checks pending state/60-second expiry/snapshot equality, reruns the projection at approval time, then atomically writes tasks/sessions/events/blocks/plans and resolves the proposal. Completion credits focus at actual approval time. Repeated approvals fail, and a failed write rolls back everything. Refresh is local and requires another explicit approval.

`chat.ts` persists user/assistant messages and proposal status, not raw provider responses or errors. A monotonic message sequence prevents equal-timestamp ordering errors. Per-attempt identities prevent an old interrupted request from overriding its retry. Configuration/snapshot checks prevent late results from reviving cleared data or acting after state changes. Known key patterns and the saved key are redacted before context transmission or response persistence. React renders plain text, without injecting model HTML.

Credentials are stored in a dedicated AI-config table keyed by provider ID, exposed to UI only through a public `hasKey/modelId/consent` projection. Catalogs and sharing consent are independent; a separate active selection revision invalidates late requests, including switching away and back. Chat messages/proposals retain provider identity; legacy untagged rows belong to OpenRouter. Only same-provider conversation history is sent, and all saved provider keys are redacted from context/exports. Chat-only deletion is provider-scoped. Saving the key is local and explicitly disclosed as weaker than a server vault. An explicit export allowlist excludes credentials, model cache, chat/proposals and internal fingerprints; string values are additionally redacted. Data deletion clears all tables, while chat-only deletion leaves approved work intact. The extension grants only OpenRouter, api.openai.com and generativelanguage.googleapis.com host access with the same `connect-src` allowlist; there are no content scripts or shared secrets. A future managed-billing release should use a backend proxy.

API references: [OpenRouter model discovery](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [chat completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request).

## Deferred calendar boundary

Microsoft/Outlook integration is deferred at the user’s request. Manual meetings remain functional; no Graph authentication or event synchronization is implemented. Provider details and API references are in PROVIDERS.md. Live authenticated provider output quality and Edge/OS notification display require user-configured smoke tests; mocked completions do not establish live provider availability.
