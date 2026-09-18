# Design: Tenderos Passwordless Authentication and Onboarding

**Outcome:** PostgreSQL owns v2 OTP/sessions/limits/onboarding; `/auth/v2/me` renders mobile. Remove passwords.

## Decisions and flow

| Choice (alternative) | Rationale |
|---|---|
| DB snapshot (cache), cohorted real/decoy release (immediate dispatch), ledger+advisory lock (client retry) | Eliminates restart/race, eligibility/latency leakage, and response-loss duplicates. |

```
request/resend → transport → normalized email+IP atomic limits → real|decoy ticket
 → provider accepted ? activate/replacement : cleanup → cohort release → challengeId/cooldown
verify → target FOR UPDATE → consume/provision/verified/session COMMIT → /auth/v2/me
```

Request/resend: JSON CT→object/minimum `{email}`/`{email,challengeId}`→normalize→email/IP atomic limits→inactive/unknown decoy→dispatch→release. A fixed batch window runs real send and equal decoy delay; release at batch close+padding, timeout is `provider_unavailable`, hiding eligibility/provider latency. Request creates only with no active target; resend locks supplied target, preserves it on failure, otherwise atomically replaces it. Verify: `{email,challengeId,code}`→normalize/limits→target lock→expired `expired_otp`, consumed/locked/mismatch `invalid_otp`; attempts affect target only. Failure activates none. Fresh DB time after padding computes `cooldown=max(0,ceil((cooldown_until-db_now_fresh)/1s))`, `Retry-After=max(0,ceil((reset-db_now_fresh)/1s))`. Unknown valid verification provisions active/verified/`profile_required`; inactive gets no mutation/session. Consume/provision/session are one transaction. Success is `200 {challengeId,cooldownSeconds}` or verify session/snapshot; errors JSON `{kind}`: validation 400, throttle 429, provider 503, OTP 400.

```
valid object+UUID → auth → completed replay → RFC8785 canonicalize/hash → ledger claim
 → advisory lock → profile/store/outcome/state COMMIT → persisted response
```

RFC8785-canonicalize every transport-valid finalize object before domain validation. `keySubject=HMAC(UUID)` resolves current/eligible-previous aliases; `requestHash=SHA-256(canonical payload)`. Ledger `(user,keySubject)` has `claimed|terminal`, hash, lease, fence, status/body/headers/store outcome. `INSERT ... ON CONFLICT` claims; terminal same hash replays bytes, different hash 409; bounded matching-claim wait returns canonical timeout; DB-clock expired lease takeover checks fence. Profile/draft/finalize share `pg_advisory_xact_lock(user)`; association/creation, durable store ID, outcome and `completed` commit atomically. Server wins cache; cached-only draft syncs but cannot satisfy `profile_required`→`store_required`→`completed`; enrichment is post-Home.

## Persistence, contracts, and precedence

| Tables/columns, constraints, transaction |
|---|
| `users(email_normalized NOT NULL UNIQUE,email_verified_at,full_name NULL,onboarding_state CHECK(profile_required|store_required|completed),onboarding_store_id NULL FK stores RESTRICT)` plus `UNIQUE(onboarding_store_id) WHERE onboarding_store_id IS NOT NULL`; `stores(owner_user_id FK CASCADE,name CHECK(trim(name)<>''))`; `otp_challenges(id,email_normalized,pepper_key_id,digest NOT NULL,status CHECK(active|invalid),attempts,locked_at,expires_at,consumed_at,cooldown_until)` indexed active email; limits `(kind,digest,action,reset_at,count)` unique; aliases `(kind,key_id NOT NULL,digest NOT NULL)` unique, stable subject lookup; ledger unique `(user,keySubject)`. Preflight ABORTS (no repair) on blank email/store, duplicate email, ambiguous owned named store, conflicting link, missing alias/key. `auth_sessions.jwt_key_id`: nullable expand→compatibility-ID backfill→no-null/known-key validate→NOT NULL contract. |

| Endpoint | Precedence and result; forbidden side effect |
|---|---|
| OTP request/resend/verify | CT→JSON object/minimum→limits/target as above; malformed/non-object/shape `400 validation`; no challenge/limit mutation before shape. |
| profile/draft | CT→object/minimum→auth→domain/merge; invalid transport `400`, no auth, merge, mutation. |
| finalize | CT→object+UUID→auth→completed replay→canonicalize→domain/ledger; transport `400`, unauthenticated `401 invalid_session`, neither claims nor mutates. |
| logout | empty is valid; otherwise CT→object→auth attempt→204 signed-out; malformed `400`; local clear always, reachable revoke only. |

`/auth/v2/me` and refresh classify absent/invalid/expired/revoked/inactive as `invalid_session`; network/5xx as `transient_session`. Bootstrap/deep link share one refresh and one retried `me`; only refresh-401 clears SecureStore, all other failures close protected navigation. Offline logout clears locally; reachable logout also revokes.

## Files, tests, accessibility

| Action | Exact paths |
|---|---|
| Modify | `packages/backend-core/src/{database/schema.ts,auth/{router.ts,service.ts,schemas.ts},types/env.ts,env.ts,context/backend-context.ts}`, `packages/api-contracts/src/auth.ts`, `apps/Tenderos/backend/src/{app.ts,config/env.ts}`, `apps/Tenderos/mobile/src/features/auth/{infrastructure/{auth-fetch-repository.ts,session-storage.ts},application/{auth.use-case.types.ts,ports/auth-remote-repository.ts,use-cases/create-auth-use-cases.ts},presentation/AuthProvider.tsx}`, `apps/Tenderos/mobile/app/{_layout.tsx,index.tsx,auth/{_layout.tsx,enter-email.tsx,enter-otp.tsx,person-name.tsx,store-name.tsx}}`. |
| Create | `packages/backend-core/drizzle/0002_tenderos_auth_v2.sql`, `packages/backend-core/src/{auth/auth-v2.test.ts,onboarding/onboarding.test.ts,scripts/{backfill-tenderos-onboarding.ts,audit-normative-scenarios.ts}}`, `apps/Tenderos/mobile/src/features/auth/__tests__/passwordless-onboarding.test.tsx`, `.github/workflows/tenderos-auth-onboarding.yml`. |

Mobile factory/repository/provider removes password calls, persists snapshot/drafts, guards routes, labels/roles, email autofill, OTP numeric autofill/paste, focused live errors, keyboard operation, disabled/loading announcements, resend countdown. CI audit requires one title/metadata occurrence per ID. Commands: `pnpm --filter @repo/backend-core test`; `pnpm --filter tenderos-mobile test`; `pnpm check-types`.

## Rollout, threats, traceability

Expand→compatible backend→mobile→contracts. Startup rejects missing current or partial/duplicate prior pair; new artifacts use current. Prior JWT lasts access lifetime, OTP lifetime+retention, HMAC longest limit/ledger window plus verified-current-alias/no-live-subject evidence. Legacy uses isolated `AUTH_LEGACY_OTP_SECRET`, never v2/JWT, until active legacy count is zero. Record immutable migration digest; retire after windows and `COUNT(*)=0` for active legacy challenges, previous-only aliases, live ledger/limit subjects. Rollback stops v2 writes, deploys recorded post-expand digest, reconciles audits, resumes only at those three zero queries.

| Threat boundary | Applicability; safe/failure; RED |
|---|---|
| Documentation-like paths | N/A: no documentation is classified/executed; reject such input by absence of executor. |
| Git repository selection | N/A: no git selector; no repository command runs. |
| Commit state | N/A: no commit command; no index/worktree mutation. |
| Push state | N/A: no push command; no destination/ref resolution. |
| PR commands | N/A: no PR command; no composed shell arguments. |

**Mappings** (section → exact planned test): OTP/session → `packages/backend-core/src/auth/auth-v2.test.ts`: AUTH-S1, AUTH-S3, AUTH-S4, AUTH-S5, AUTH-S6, AUTH-S7, AUTH-S13, AUTH-S14, AUTH-S15, AUTH-S16, AUTH-S17, AUTH-S18, AUTH-S19, AUTH-S21, AUTH-S22, AUTH-S23, AUTH-S24, AUTH-S25, AUTH-S27, AUTH-S28, AUTH-S29, AUTH-S30, AUTH-S31, AUTH-S32, AUTH-S37, AUTH-S39, AUTH-S40, AUTH-S41, AUTH-S42. Mobile/accessibility → `apps/Tenderos/mobile/src/features/auth/__tests__/passwordless-onboarding.test.tsx`: AUTH-S2, AUTH-S8, AUTH-S9, AUTH-S10, AUTH-S11, AUTH-S20, AUTH-S26, AUTH-S33, AUTH-S34, AUTH-S35, AUTH-S36, AUTH-S38. Audit → `packages/backend-core/src/scripts/audit-normative-scenarios.ts`: AUTH-S12. Finalize/onboarding → `packages/backend-core/src/onboarding/onboarding.test.ts`: ONB-S6, ONB-S7, ONB-S8, ONB-S9, ONB-S14, ONB-S15, ONB-S16, ONB-S17, ONB-S19, ONB-S20, ONB-S25, ONB-S26, ONB-S27, ONB-S28, ONB-S29, ONB-S30, ONB-S31. Mobile onboarding → `apps/Tenderos/mobile/src/features/auth/__tests__/passwordless-onboarding.test.tsx`: ONB-S1, ONB-S2, ONB-S3, ONB-S4, ONB-S5, ONB-S10, ONB-S11, ONB-S12, ONB-S18, ONB-S21, ONB-S22, ONB-S23, ONB-S24. Audit → `packages/backend-core/src/scripts/audit-normative-scenarios.ts`: ONB-S13.
