# Requirements and status

The product is an Edge native side-panel assistant for planning and executing a workday. Today is the primary dashboard; AI Chat and Settings are separate remembered tabs. Manual local workflows must work offline without AI or Outlook.

## Implemented foundation

Responsive 320–450px layout; dark default/light theme; task CRUD with stable IDs and validated fields; IndexedDB persistence; task completion/defer controls; JSON export and confirmed deletion. Meetings and breaks never count as completed tasks. The user confirmed the native Phase 1 extension works.

## Implemented scheduling/focus

Working hours/days/timezone, configurable lunch/breaks, manual meeting CRUD, deterministic priority/deadline/dependency scheduling, split blocks, fixed/history preservation, overflow, current/future dated timeline, stale-plan indication and preview approval. Local meeting/deadline inputs explicitly reject ambiguous/nonexistent DST times. Overnight work uses a start-date anchor.

Focus sessions independently track elapsed timestamps with one active session; pause/resume/complete and extra-time proposals work without AI. Periodic/task-end check-ins offer completion, extension, pause and deferral. Alarm metadata survives worker/browser restarts; notifications honor preferences and quiet hours and avoid duplicate delivery attempts. Expired notifications are not replayed indefinitely. Real OS delivery remains subject to browser/OS permissions and availability.

## Implemented AI; live-model acceptance pending

OpenRouter provider interface, live public catalog discovery, free/text model filtering, local key/model/consent settings, persistent chat with bounded context, optional task-description sharing, strict Zod schemas, structured-output capability detection, one corrective retry and sanitized failures. No hardcoded model or paid-model fallback. Keys/config/chat/proposals are excluded from exports and context.

Task extraction/categorization/duration estimates, updates, completion, extension, deferral/postponement, manual meeting creation and rescheduling are structured proposals. Local simulation displays field changes, deterministic timelines, warnings and overflow. Approval is transactional, expires after 60 seconds, rejects changed snapshots and cannot be applied twice. Local refresh requires renewed review. The LLM never writes tasks or overrides scheduling constraints. Questions return an answer without empty proposals. Cancellation/interrupted retry, offline use and late-response safeguards are tested. A user-configured live OpenRouter completion remains a manual acceptance check.

## Provider expansion — implemented

OpenAI API and Gemini API are selectable alongside OpenRouter. Keys, model catalogs, consent and chat histories are independent. Native Responses/generateContent adapters share bounded transport, schema validation and the existing transactional approval/scheduling boundary. All provider keys are excluded/redacted in exports and context. Switching cancels in-flight requests and invalidates late responses; v3 OpenRouter data migrates without credential loss. Live account access and model output quality require local-key smoke tests. ChatGPT account sign-in is not part of this implementation.

## Deferred Outlook

Microsoft/Outlook integration is deferred at the user’s request. Manual meetings remain available. No Microsoft connection is implemented or simulated.

The full specification is the user's AI Workday Assistant master instructions. Implementation order and validation limits are tracked in IMPLEMENTATION_PLAN.md and PROGRESS.md. No external credentials are needed for the implemented manual workflows.
