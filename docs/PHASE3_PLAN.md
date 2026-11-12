# Phase 3 implementation plan

Status: implemented. See PROGRESS.md for automated validation and remaining live-model/Edge acceptance checks. The original design follows.

OpenRouter will be an isolated provider adapter: model discovery plus non-streaming chat completions with timeout/cancellation, typed sanitized errors, strict schema validation, and at most one corrective retry for malformed model output. Structured-output support is discovered from model metadata; other models receive schema-guided text instructions. No fixed model ID or automatic paid-model fallback.

A separate local credential/config table will hold the user-supplied key and selected model; it is excluded from all exports and chat context. Settings disclose that local storage is not a secret vault and that task context is sent to OpenRouter/the selected provider. No content scripts or shared API key are introduced.

The assistant will return a bounded allowlist of task/meeting/reschedule actions. Application code resolves references, validates constraints, simulates changes in memory, and calls the existing deterministic scheduler to build a reviewable diff and timeline. Approval compares the original data snapshot in an IndexedDB transaction, rejects expired/stale proposals, recalculates against approval time, and commits task/session/event/block/plan changes together. Invalid/unknown actions never write data. Duplicate approval is rejected. Chat messages and proposal status persist locally; interrupted requests can be retried, while unapproved changes remain unapplied.

Validation will cover model discovery/free filtering, strict and non-strict models, malformed/truncated/refused output, HTTP errors, timeout/offline/cancel states, secret redaction/export exclusion, preview/reject/approval, stale data, atomic rollback, duplicate approval, natural-language scheduling action fixtures and packaged-extension connectivity configuration. Real model output quality and user-key authorization require a live user-configured smoke test; deterministic tests use explicitly mocked provider responses.
