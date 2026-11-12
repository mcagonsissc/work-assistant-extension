# Milestones

1. **Foundation — accepted by user.** Native MV3 side panel, task CRUD, IndexedDB persistence, tabs/themes and installation documentation. User confirmed the loaded extension works.
2. **Scheduling and focus — implemented, automated validation complete; Edge/OS smoke test pending.**
   - Persist work hours/days/timezone, lunch/breaks and reminder preferences.
   - Pure scheduler: fixed commitments, priority/deadline/dependency ordering, splits, overflow, remaining-work recalculation and completed history.
   - Manual meeting CRUD, dated timeline, plan previews with transactional approval and stale-input rejection.
   - Timestamp-based focus sessions, pause/resume/complete/extension and offline check-ins.
   - Persisted alarm reconstruction, notification preferences/quiet periods, deduplication and failure states.
   - Vitest logic/storage tests, browser workflows and a packaged-extension Chromium restart test.
3. **AI — implemented, automated validation complete; live-key smoke test pending.** Provider interface; public OpenRouter model discovery/free filtering; separate credential/model storage and consent; schema-guided/strict output with bounded retry; persistent context-aware chat; minimized context; transactional task/meeting/schedule proposals with approval/rejection/refresh; malformed-response/outage/cancellation/staleness/export-security tests. Public discovery was verified live; authenticated completions are mocked in tests. The deterministic scheduler remains the authority for available time.
4. **Outlook — deferred by user.** Microsoft authentication and calendar sync are out of the current implementation scope. Manual meetings remain available.
5. **Stabilization — next.** Additional Edge E2E/accessibility/performance checks, production packaging, full daily-use testing, import/recovery considerations and final documentation.

Next manual check: reload v0.4 in Edge, confirm existing tasks survive migration, plan a day, start/pause a focus session, and verify browser/OS notifications with a one-minute check-in. Native Edge notification display cannot be established by headless Chromium tests.

For AI acceptance, follow README’s live OpenRouter smoke test using a key entered only in the installed extension. No key is needed for automated tests. See PHASE3_PLAN.md for the original design.

## Provider expansion — v0.4 implemented

OpenAI API and Gemini API now sit alongside OpenRouter. Each has independent keys, consent, models/cache and conversation, with native request/response adapters and the same local approval/scheduling logic. Existing OpenRouter v3 data migrates automatically. Authenticated tests use mocks; live user-key checks remain manual. See PROVIDERS.md and PROGRESS.md.
