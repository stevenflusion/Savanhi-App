# Authentication
## Requirements

### Requirement: [AUTH-R1]
Tenderos public auth MUST be OTP/session-only; password APIs/contracts/use cases MUST NOT exist; identities MUST persist.

#### Scenario: [AUTH-S1]
GIVEN active identity; WHEN valid OTP verifies; THEN same identity MUST receive session.

#### Scenario: [AUTH-S2]
GIVEN Tenderos public client; WHEN password auth is attempted; THEN it MUST be unsupported.

### Requirement: [AUTH-R2]
Successful request/resend MUST return an opaque `challengeId`. Challenges MUST expire, be single-use, and activate only after accepted dispatch. Failure MUST activate none. Public envelopes, shapes, and timing MUST NOT enumerate accounts. Inactive dispatch SHOULD stop when indistinguishable. A successful response MUST be held through its defensive-padding interval and MUST then expose `cooldownSeconds` computed at response release from fresh PostgreSQL time as `max(0, ceil((cooldownUntil - dbNowFresh) / 1 second))`; it MUST NOT reuse a pre-padding timestamp or a configured duration.

#### Scenario: [AUTH-S3]
GIVEN permitted request; WHEN dispatch is accepted and defensive padding completes; THEN one challenge MUST activate, its opaque `challengeId` MUST be returned, and `cooldownSeconds` MUST equal `max(0, ceil((cooldownUntil - dbNowFresh) / 1 second))` using fresh PostgreSQL time obtained after padding immediately before response release.

#### Scenario: [AUTH-S22]
GIVEN permitted request; WHEN dispatch fails; THEN none MUST activate and `provider_unavailable` MUST result.

#### Scenario: [AUTH-S13]
GIVEN known inactive email; WHEN requesting OTP; THEN no real challenge/session MUST result, dispatch SHOULD stop, and the public envelope/shape/timing MUST match an eligible request.

#### Scenario: [AUTH-S27]
GIVEN prior challenge; WHEN resend fails; THEN prior challenge MUST remain verifiable.

#### Scenario: [AUTH-S28]
GIVEN prior challenge; WHEN resend is accepted; THEN replacement MUST activate, return its opaque `challengeId`, and invalidate the prior challenge atomically; only replacement MUST verify.

### Requirement: [AUTH-R3]
Verify MUST require normalized email, opaque `challengeId`, and code. Updates MUST target that challenge only. OTP consumption, verification, provisioning, and session issuance MUST commit atomically; inactive users MUST receive none.

#### Scenario: [AUTH-S4]
GIVEN active identity/valid challenge; WHEN OTP verifies; THEN consumption/verification/session MUST commit atomically.

#### Scenario: [AUTH-S5]
GIVEN unused challenge; WHEN verifications race; THEN only one MUST issue credentials.

#### Scenario: [AUTH-S6]
GIVEN invalid OTP for a target challenge; WHEN submitted; THEN `invalid_otp` MUST result, that challenge's attempts/lock MAY advance, and identity/emailVerified/onboarding/session MUST remain unchanged.

#### Scenario: [AUTH-S23]
GIVEN expired challenge; WHEN submitted; THEN `expired_otp` MUST result without state/session change.

#### Scenario: [AUTH-S24]
GIVEN consumed challenge; WHEN submitted; THEN `invalid_otp` MUST result without state/session change.

#### Scenario: [AUTH-S25]
GIVEN inactive identity challenge; WHEN submitted; THEN no state/session change MUST occur.

#### Scenario: [AUTH-S14]
GIVEN valid unknown-email challenge; WHEN OTP verifies; THEN active identity/verified email/session/`profile_required` onboarding MUST commit atomically.

#### Scenario: [AUTH-S30]
GIVEN a valid challenge; WHEN verify omits or mismatches email, `challengeId`, or code; THEN verification MUST fail without identity/session change.

#### Scenario: [AUTH-S31]
GIVEN an active replacement challenge; WHEN the prior `challengeId`/code is submitted; THEN replacement attempts/lock state MUST remain unchanged.

#### Scenario: [AUTH-S32]
GIVEN one active challenge; WHEN verify and resend race; THEN one linearizable order MUST result and each conditional update MUST affect only its target challenge.

### Requirement: [AUTH-R4]
Request/verify limits MUST independently bind normalized email/IP, persist across restart/concurrency, and expose `Retry-After`. Every rotatable JWT, OTP-pepper, or auth-data-HMAC key ring MUST have one effective current ID/key pair; a previous ID/key pair MAY be absent, but if configured it MUST be complete, have an ID distinct from current, and become visible atomically. New artifacts MUST use current IDs. Previous JWT keys MUST be accepted only through the access-token acceptance window; previous OTP peppers MUST be accepted through the OTP lifetime plus retained verification window; previous auth-data-HMAC keys MUST remain accepted through the longest live rate-limit or idempotency-key window and until no live subject depends solely on the previous alias and every live subject has a verified current alias. A previous pair MUST be retired when, and MUST NOT be retired before, its acceptance and live-dependency conditions are satisfied. During initial migration, `AUTH_JWT_SECRET` MAY supply the effective current JWT key under a designated compatibility ID when an explicit current pair is absent. During rollout, legacy OTP MUST use only the isolated `AUTH_LEGACY_OTP_SECRET`, which MUST remain until no active unexpired legacy OTP challenge exists and MUST NOT be reused as a v2 OTP pepper or JWT key.

#### Scenario: [AUTH-S7]
GIVEN email at action limit; WHEN action repeats; THEN `throttled` plus accurate `Retry-After` MUST result.

#### Scenario: [AUTH-S15]
GIVEN IP at action limit; WHEN action repeats; THEN `throttled` plus accurate `Retry-After` MUST result.

#### Scenario: [AUTH-S16]
GIVEN persisted counters, sessions, v2 and legacy OTP challenges, and auth-data subjects across a configured key rotation; WHEN the service restarts and later crosses each acceptance and live-dependency boundary; THEN limits/cooldowns MUST persist, startup MUST reject a missing current ID/key or a partial/matching-ID previous pair, new artifacts MUST carry the current ID, current and eligible previous keys MUST validate only within their defined windows, each previous pair MUST remain until its retirement conditions are met and fail after retirement, initial `AUTH_JWT_SECRET` compatibility MUST provide only the effective current JWT key, and legacy OTP MUST remain verifiable only with isolated `AUTH_LEGACY_OTP_SECRET` until no active unexpired legacy challenge remains.

#### Scenario: [AUTH-S17]
GIVEN counters near limits; WHEN request/verify race; THEN each email/IP/action counter MUST enforce atomically and independently.

#### Scenario: [AUTH-S29]
GIVEN trim/case email variants; WHEN lookup/counting occurs; THEN variants MUST share identity/counters.

### Requirement: [AUTH-R5]
Protected session reads and refresh MUST return `401 invalid_session` for absent, invalid, expired, revoked, or inactive-user credentials. Bootstrap MUST call `/auth/v2/me`; its 401 MUST trigger one single-flight refresh and one `/auth/v2/me` retry. Among bootstrap failures, only refresh 401 MUST clear credentials. Network/5xx MUST preserve credentials and fail closed. Reachable logout MUST revoke remotely; absent/invalid logout credentials MUST return the canonical signed-out outcome; explicit logout MUST clear locally.

#### Scenario: [AUTH-S8]
GIVEN refresh returns 401; WHEN classified; THEN `invalid_session` MUST result, no session MUST issue, and stored credentials MUST clear.

#### Scenario: [AUTH-S9]
GIVEN offline credentials; WHEN logout is explicit; THEN local credentials MUST clear and repeated logout MUST succeed.

#### Scenario: [AUTH-S18]
GIVEN valid refresh; WHEN submitted; THEN usable session MUST result.

#### Scenario: [AUTH-S19]
GIVEN active session; WHEN logout succeeds then credentials replay; THEN revocation MUST persist and replay MUST fail.

#### Scenario: [AUTH-S20]
GIVEN refresh network/5xx failure; WHEN automatic refresh fails; THEN credentials MUST remain, protected access MUST stay closed, and `transient_session` MUST result.

#### Scenario: [AUTH-S33]
GIVEN absent/invalid access credentials; WHEN `/auth/v2/me` runs; THEN `401 invalid_session` MUST result without directly clearing stored credentials.

#### Scenario: [AUTH-S34]
GIVEN `/auth/v2/me` returns 401 and refresh succeeds; WHEN bootstrap continues; THEN one refresh MUST run and one retried `/auth/v2/me` MUST establish state.

#### Scenario: [AUTH-S35]
GIVEN bootstrap and a deep link race; WHEN both require session state; THEN they MUST share one refresh and navigation MUST wait for the retried `/auth/v2/me` result.

#### Scenario: [AUTH-S36]
GIVEN `/auth/v2/me` network/5xx failure; WHEN bootstrap evaluates it; THEN credentials MUST remain, refresh MUST NOT start from that failure, and protected access MUST stay closed.

#### Scenario: [AUTH-S37]
GIVEN a transport-valid logout with absent/invalid credentials; WHEN processed; THEN the server MUST return canonical 204 and local credentials MUST clear.

#### Scenario: [AUTH-S38]
GIVEN an empty logout request; WHEN processed; THEN the server MUST return canonical 204 and local credentials MUST clear.

#### Scenario: [AUTH-S39]
GIVEN a logout body containing malformed JSON; WHEN transport validation runs; THEN `400 validation` MUST result before logout semantics.

### Requirement: [AUTH-R6]
Auth controls MUST have roles/labels; OTP MUST support keyboard/autofill/paste; errors MUST receive focus/live announcement; resend MUST preserve email and disable during cooldown.

#### Scenario: [AUTH-S10]
GIVEN resend cooldown; WHEN inspected/activated; THEN disabled state/time/outcome MUST be announced.

#### Scenario: [AUTH-S11]
GIVEN keyboard/autofill/paste; WHEN valid OTP submits; THEN labeled input MUST accept/submit.

#### Scenario: [AUTH-S26]
GIVEN invalid OTP input; WHEN submission fails; THEN focus MUST enter labeled live-region error.

### Requirement: [AUTH-R7]
Each test MUST carry one scenario ID in title/metadata. CI MUST require every normative ID; duplicates MAY pass, zero MUST fail.

#### Scenario: [AUTH-S12]
GIVEN normative AUTH IDs; WHEN CI discovers metadata; THEN each ID MUST appear separately.

### Requirement: [AUTH-R8]
Error kind MUST be `validation`, `throttled`, `provider_unavailable`, `invalid_otp`, `expired_otp`, `invalid_session`, or `transient_session`; responses MUST NOT enumerate.

#### Scenario: [AUTH-S21]
GIVEN failure; WHEN response appears; THEN kind MUST be machine-readable/non-enumerating.

### Requirement: [AUTH-R9]
Body-bearing auth requests MUST require `Content-Type: application/json`, a parseable JSON object, and endpoint-minimum transport shape before authentication. Authentication MUST precede domain semantics and idempotency. Transport failures MUST return `400 validation` and MUST NOT claim idempotency state or mutate domain state. An empty logout request MUST be transport-valid; other canonical logout 204 branches apply only after transport validation.

#### Scenario: [AUTH-S40]
GIVEN unsupported `Content-Type`; WHEN an applicable auth request arrives; THEN `400 validation` MUST result before authentication or domain processing.

#### Scenario: [AUTH-S41]
GIVEN parseable JSON violating minimum transport shape; WHEN transport validation runs; THEN `400 validation` MUST result without domain mutation.

#### Scenario: [AUTH-S42]
GIVEN transport-valid protected request without valid authentication; WHEN authentication runs; THEN `401 invalid_session` MUST result before domain/idempotency processing.
