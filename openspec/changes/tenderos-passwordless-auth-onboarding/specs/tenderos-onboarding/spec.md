# Tenderos Onboarding Specification

## Requirements

### Requirement: [ONB-R1]
Server fields MUST win cache conflicts. Cached-only fields MUST reappear as editable, synchronizable drafts but MUST NOT satisfy steps until persisted.

#### Scenario: [ONB-S1]
- GIVEN server data and cached draft
- WHEN onboarding restores
- THEN server conflicts MUST win and cached-only fields MUST remain editable and synchronizable

#### Scenario: [ONB-S21]
- GIVEN a restored cached-only field
- WHEN the user synchronizes it
- THEN its value MUST persist server-side without changing completion unless a required committed invariant becomes true

### Requirement: [ONB-R2]
State MUST be first unsatisfied: `profile_required` until nonblank `fullName` persists; `store_required` until a named store is associated; then `completed`. Draft/persisted `storeName` alone MUST NOT satisfy `store_required`. Routing MUST use the server-authoritative snapshot returned by `GET /auth/v2/me`.

#### Scenario: [ONB-S2]
- GIVEN `completed`
- WHEN routing resolves
- THEN Home MUST open

#### Scenario: [ONB-S3]
- GIVEN persisted required data
- WHEN routing resolves the snapshot returned by `GET /auth/v2/me`
- THEN the first unsatisfied state MUST open with saved data

#### Scenario: [ONB-S22]
- GIVEN the completion transaction has committed
- WHEN canonical onboarding state is applied
- THEN Home MUST open using the persisted completed outcome

### Requirement: [ONB-R3]
Routes/deep links MUST NOT let cache or history bypass server state or send completed users backward.

#### Scenario: [ONB-S4]
- GIVEN an incomplete user
- WHEN a protected deep link opens
- THEN the required state MUST replace that route

#### Scenario: [ONB-S5]
- GIVEN server completion and incomplete cache
- WHEN onboarding opens
- THEN Home MUST open

### Requirement: [ONB-R4]
Finalization MUST require persisted nonblank `fullName` and nonblank `storeName` input or named associated store. It MUST create or reuse/associate one store, persist that store as durable `onboardingStoreId`, then atomically mark `completed`. Every store creation/association while onboarding is incomplete MUST share per-user exclusion with finalization or be rejected.

#### Scenario: [ONB-S6]
- GIVEN persisted `fullName` and nonblank `storeName`
- WHEN finalization succeeds
- THEN one store MUST be created or reused/associated before `completed` commits and Home opens

#### Scenario: [ONB-S7]
- GIVEN missing required data
- WHEN finalization occurs
- THEN `validation` MUST identify fields without partial store/completion effects

#### Scenario: [ONB-S20]
- GIVEN incomplete onboarding
- WHEN store creation/association races with finalization
- THEN both operations MUST serialize by user or one MUST be rejected without duplicate stores

### Requirement: [ONB-R5]
Finalize MUST process transport/shape validation, authentication, completed precedence, then domain/idempotency. For incomplete onboarding, a syntactically valid UUID idempotency key and parseable JSON object MUST resolve to one stable `idempotencyKeySubjectId` and one canonical `requestHash` before domain validation. Idempotency identity MUST be uniquely scoped by `(userId, idempotencyKeySubjectId)`; `requestHash` MUST identify only the canonical payload and MUST NOT identify the idempotency key. The same raw UUID MUST resolve to the same `idempotencyKeySubjectId` across accepted auth-data-HMAC key rotation. Domain-invalid payloads MUST persist canonical `400 validation`; the same user/key subject/request hash MUST replay that 400, while the same user/key subject with a different request hash MUST return 409. Completed outcomes MUST use durable `onboardingStoreId`. Concurrency, response loss, or retries MUST NOT duplicate stores.

#### Scenario: [ONB-S8]
- GIVEN one user and one stable `idempotencyKeySubjectId`
- WHEN requests race
- THEN one outcome MUST commit and every successful response MUST return identical `onboardingStoreId` and completion data

#### Scenario: [ONB-S9]
- GIVEN a committed outcome with lost response and an accepted auth-data-HMAC key rotation
- WHEN the same user and raw UUID retry through the current or eligible previous key
- THEN both MUST resolve to the same `idempotencyKeySubjectId` and the canonical outcome MUST return without duplication

#### Scenario: [ONB-S14]
- GIVEN `completed` and a transport-valid authenticated finalize request
- WHEN any syntactically valid key/payload is submitted
- THEN the original outcome MUST return before domain/key lookup and without another store

#### Scenario: [ONB-S19]
- GIVEN completed onboarding and changed store ordering
- WHEN its canonical outcome is read or retried
- THEN persisted `onboardingStoreId` MUST identify the original onboarding store

#### Scenario: [ONB-S29]
- GIVEN incomplete onboarding, valid UUID key, and parseable domain-invalid payload
- WHEN finalize runs
- THEN `400 validation` MUST be persisted canonically for that user, `idempotencyKeySubjectId`, and `requestHash`

#### Scenario: [ONB-S30]
- GIVEN incomplete onboarding with a persisted domain-invalid 400
- WHEN the same user, `idempotencyKeySubjectId`, and `requestHash` replay
- THEN the identical canonical 400 MUST return without reprocessing

#### Scenario: [ONB-S31]
- GIVEN incomplete onboarding with a claimed `(userId, idempotencyKeySubjectId)`
- WHEN that same identity arrives with a different `requestHash`
- THEN 409 MUST return without replacing the canonical outcome

### Requirement: [ONB-R6]
Location, photos, payment, and permissions MUST NOT gate or revoke completion/Home. They MAY follow Home.

#### Scenario: [ONB-S10]
- GIVEN minimum data only
- WHEN finalization succeeds
- THEN completion and Home MUST succeed

#### Scenario: [ONB-S11]
- GIVEN a completed user
- WHEN enrichment fails or is denied
- THEN completion and Home MUST remain unchanged

### Requirement: [ONB-R7]
Fields/status MUST expose roles/labels; errors MUST define focus/live-region targets; submission MUST expose disabled/loading state. Keyboard operation MUST work; failed saves MUST preserve drafts.

#### Scenario: [ONB-S12]
- GIVEN invalid data
- WHEN submission occurs
- THEN focus MUST enter its labeled live-region validation error

#### Scenario: [ONB-S18]
- GIVEN valid editable draft
- WHEN saving fails
- THEN failure MUST be live-announced and draft MUST remain keyboard-resubmittable

#### Scenario: [ONB-S23]
- GIVEN submission in progress
- WHEN controls are inspected or activated again
- THEN loading MUST be announced and submission controls MUST remain disabled

#### Scenario: [ONB-S24]
- GIVEN keyboard-only operation
- WHEN onboarding is completed or retried
- THEN every field, error target, and submission control MUST be reachable and operable

### Requirement: [ONB-R8]
Each test MUST carry one scenario ID in title/metadata. CI MUST require every normative ID separately; duplicates MAY pass, zero MUST fail.

#### Scenario: [ONB-S13]
- GIVEN normative ONB IDs
- WHEN CI discovers test metadata
- THEN every ID MUST occur at least once

### Requirement: [ONB-R9]
Backfill MUST preserve identity and map `fullName` plus named owned store to `completed`, only `fullName` to `store_required`, and absent `fullName` to `profile_required`. Stores MUST NOT be recreated.

#### Scenario: [ONB-S15]
- GIVEN `fullName` and named owned store
- WHEN backfill runs
- THEN identity/store MUST persist and state MUST become `completed`

#### Scenario: [ONB-S16]
- GIVEN `fullName` without owned store
- WHEN backfill runs
- THEN state MUST become `store_required`

#### Scenario: [ONB-S17]
- GIVEN no `fullName`
- WHEN backfill runs
- THEN state MUST become `profile_required` regardless of store data

### Requirement: [ONB-R10]
Every body-bearing onboarding profile, draft, or finalize request MUST require `Content-Type: application/json`, a parseable JSON object, and its endpoint-minimum transport shape before authentication. Finalize MUST additionally require a syntactically valid UUID idempotency key at that transport/shape stage. Validation precedence MUST be `transport/shape → authentication → domain/idempotency`; completed precedence MAY occur after authentication and before finalize domain/idempotency processing. Transport-invalid requests MUST return `400 validation` without authentication, draft merge, key claim, or onboarding mutation. Authentication MUST succeed before profile domain validation, draft merge/version semantics, completed precedence, or finalize idempotency.

#### Scenario: [ONB-S25]
- GIVEN unsupported `Content-Type` on a profile, draft, or finalize request
- WHEN onboarding transport validation runs
- THEN `400 validation` MUST return before authentication without draft merge, key claim, or onboarding mutation

#### Scenario: [ONB-S26]
- GIVEN malformed or non-object JSON on a profile, draft, or finalize request
- WHEN onboarding transport validation runs
- THEN `400 validation` MUST return before authentication without draft merge, key claim, or onboarding mutation

#### Scenario: [ONB-S27]
- GIVEN a malformed UUID idempotency key
- WHEN finalize transport validation runs
- THEN `400 validation` MUST return non-idempotently without key claim or mutation

#### Scenario: [ONB-S28]
- GIVEN a transport/shape-valid profile, draft, or finalize request without valid authentication
- WHEN authentication runs
- THEN `401 invalid_session` MUST return before profile domain validation, draft merge/version semantics, completed precedence, key claim, or domain/idempotency processing
