# Coupon expiry push reminders
Objective: help reserved coupons turn into in-store redemptions. Branch: `feat/clientes-app`.
Delivery: `ask-on-risk`, `feature-branch-chain`; forecast ~850 authored changed lines before generated migrations. Local slices: T1 policy → T2 registration → T3 worker → T4 mobile; no push or PR authorized. Runners: backend `tsx --test`, Clientes Jest.

## Specs

- **S1 — Push delivery.** User choice: “Notificación push (Recommended)”. Send one notification before expiry even if Clientes is closed, only for a still-reserved coupon. Reuse the backend's coupon calendar and recheck the reservation before sending. Working default: the local calendar day before expiry; no reminder after the coupon expires.
- **S2 — Open the coupon.** Accepted proposal: “Al tocarlo, la persona vuelve al cupón y ve la tienda, cuándo vence y cómo abrir el QR.” Use the authenticated wallet; push data must not contain a QR or personal details.
- **S3 — Measure the pilot.** Accepted proposal: “Compararía **qué porcentaje de los cupones reservados se canjea antes de vencer** entre un grupo con aviso y otro sin aviso.” Compare equally eligible reservations in stable user-level groups after expiry; distinguish assignment from provider acceptance.

## Tasks

- [x] **T1** — S1, S3 — Inline: reminder policy verified locally (RED missing module → GREEN 3/3; backend-core typecheck passed); work-unit commit pending delivery choice. Risk: none.
- [ ] **T2** — S1, S3 — Inline: authenticated device registration and additive persistence; pending. Risk: item 2 (account-to-device ownership and revocation).
- [ ] **T3** — S1, S3 — Inline: one-shot backend job, claim deduplication, push transport and pilot counts; pending. Risk: item 4 (send races and job concurrency).
- [ ] **T4** — S1, S2 — Inline: native permission and token, wallet link, and device-test instructions; pending. Risk: item 5 (Expo native dependency and build configuration).

## Log

- **L1** — “Entonces apliquemos”
- **L2** — “Notificación push (Recommended)”
- **L3** — Baseline: `ccc5be3a050f5c4929317e1f291fb415b54c2508`. Coupon expiry is a date in `America/Bogota`; the backend already owns redemption. Clientes has no Expo project ID, Android FCM setup, or scheduler. Local implementation and mock verification do not authorize remote setup, customer sends, or production migrations.
- **L4** — Route: map delegated to Sonnet 5.5 Medium because the feature spans unfamiliar native and backend seams; the implementation units are sequential, so writes are inline. Pilot defaults should be configurable at activation where appropriate and must not change existing redemption behavior.
- **L5** — T1 adds a pure due-date predicate, stable user-level pilot assignment, and a generic push payload with only an opaque claim reference. The focused `tsx --test src/coupons/expiry-reminder-policy.test.ts` passed 3/3; backend-core `check-types` passed. No DB connection or push occurred.
- **L6** — “Rama de integración (Recommended)”. Keep server and mobile as separate reviewable units on the integration branch.
