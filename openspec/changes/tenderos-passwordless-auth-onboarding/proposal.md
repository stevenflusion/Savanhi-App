# Proposal: Tenderos Passwordless Authentication and Onboarding

## Intent

Make email OTP Tenderos' only public authentication path and let server-owned onboarding state drive resumable navigation without deleting users.

## Scope

### In Scope
- Remove password authentication only from Tenderos public API and mobile surfaces; preserve identities for OTP access.
- Persist verified-email and onboarding progress. Route completed users Home; resume others at their first required step, using the server-authoritative `GET /auth/v2/me` snapshot over cached drafts.
- Completion requires persisted `fullName` and an associated store with a non-empty name; finalization remains idempotent and all other data optional after Home.
- After provider-accepted dispatch, activate OTP challenges; atomically verify/issue sessions; reject inactive users; persist IP/email limits, cooldowns, and `Retry-After`.
- Harden bootstrap (`/auth/v2/me`), refresh/logout, guards/deep links, resend/errors, autofill/accessibility, and CI tests.

### Out of Scope
- Unrelated payment, media, location, notification, permission, or catalog behavior.
- Account deletion and non-Tenderos auth redesign.

## Capabilities

### New Capabilities
- `tenderos-passwordless-auth`: OTP-only auth, verified identity, abuse controls, atomic sessions, inactive-user policy, and accessible UX.
- `tenderos-onboarding`: Server-authoritative progress, deterministic routing/resume, minimum data, idempotent finalization, and optional enrichment.

### Modified Capabilities
None; `openspec/specs/` has no capability specifications.

## Approach

Add auth/onboarding persistence and API contracts. Let backend state route users; deterministically classify/reuse existing identities/stores; finalize profile/store idempotently; remove password authentication from public Tenderos surfaces. Legacy OTP and v2 passwordless auth paths may coexist temporarily, only during controlled migration and rollback.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/backend-core/src/{auth,database,middleware}` | Modified | State, transactions, completion, throttling |
| `packages/api-contracts/src/auth.ts` | Modified | Password removal; state/retry contracts |
| `apps/Tenderos/mobile/{app,src/features/auth}` | Modified/Removed | Guards, resume UX, password surface removal |
| `apps/Tenderos/backend`, tests, CI | Modified/New | Wiring and verification |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Existing users are misclassified or locked out | Medium | Deterministic user/store backfill; state-matrix tests |
| Dispatch or concurrent retries corrupt auth state | Medium | Provider-accepted dispatch, transactions, idempotency, persistent limits |
| Deep links bypass onboarding | Medium | Central server-state guard on startup and protected routes |

## Rollback Plan

Roll back mobile and backend together to the last dual-compatible backend artifact produced after expand; never to a binary predating expand. Retain additive columns and identities, stop new writes, and reconcile sessions from audit records.

## Dependencies

- PostgreSQL, Resend, and store ownership.

## Success Criteria

- [ ] No public Tenderos password path remains; existing identities/stores are deterministically reused without duplication, and active users authenticate by OTP.
- [ ] Automated tests cover OTP, limits, inactive users, refresh/logout, retries, and failures.
- [ ] Server state routes fresh, partial, completed, and deep-linked sessions correctly.
- [ ] Persisted `fullName` plus an associated named store unlocks Home exactly once; enrichment never blocks it.
- [ ] Mobile and backend auth/onboarding suites run in CI.
