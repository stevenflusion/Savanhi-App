# Customer API — everything the client app calls

This is the single reference for building the Savanhi customer app (`client` role). It documents the API **as the code behaves today**, not as the plan describes it.

Every response body and every error message below was captured from a real run of `tenderos-backend` against a throwaway PostgreSQL database on 2026-11-04, with fictional stores, products and customers — the registration, name, feed and release responses (C1–C4) from a second run on the same day, after those rules landed. Nothing here is hand-written. The `curl` lines use the default development port (`$API=http://localhost:4300`); access tokens, refresh tokens, QR tokens and the presigned image signature are replaced with placeholders.

The customer capability lives inside the Tenderos backend (`apps/Tenderos/backend`) under its own namespace, `/api/v1/clientes`. There is no separate customer service, and there is no customer UI in this repository yet (S2).

- **9 customer routes**, all behind `requireRole(["client"])` **and the eligibility gate** (a stored birth date making the customer at least 18, C9), plus **2 profile routes** (`GET`/`PUT /api/v1/clientes/profile`) that are `client`-only and deliberately NOT behind the gate.
- **6 auth routes** the app needs, all unauthenticated or any-role.
- **One response envelope**: `{ "data": … }` for customer routes, `{ "user" }` / `{ "session" }` / `{ "ok" }` for auth.

---

## Read this first: what does not exist yet

Four gaps this document used to list are **closed** — a customer can register itself, a saved name completes its registration, the feed answers without coordinates, and a claim can be released. They are specified in `odd/tasks/clientes-app.md` as C1–C4 and documented below. What is still missing:

| Gap | What it means for the app | Evidence |
| --- | --- | --- |
| `POST /auth/registration/complete` is `requireAuth(["tendero"])` and creates a **store**. | The customer's profile step is `PUT /api/v1/clientes/profile` (name **and** birth date, C8) — see "Customer eligibility" below. `PATCH /auth/me` with `fullName` still works and still completes a client's `registrationStatus` (C2), but it does **not** make the customer eligible. | `packages/backend-core/src/auth/router.ts:137` |
| **One email is one account and one role.** An address that already registered through the tendero app stays a `tendero` for ever; the customer app's indication cannot change it (C1). | Signing in with such an address succeeds and then answers `403` on every customer route. Word that dead end — "este correo ya tiene una cuenta de tienda" — instead of retrying the sign-in. | C1 below |
| No pagination on the feed or the wallet. | `GET /coupons/feed` and `GET /claims` return **everything**, always. No `limit`, no `offset`, no cursor. Plan for client-side windowing and for the payload growing. | `routes/index.ts`, the two customer read routes |
| No single-coupon read for a customer, and **no deep links in the MVP** (C5). | There is no `GET /api/v1/clientes/coupons/:id`. A coupon is only ever reachable embedded in a feed item or in a claim. Sharing a coupon by link was decided OUT of the MVP, so nothing has to open one. | route inventory below |
| No store detail, and no store photos for a customer. | A customer only ever sees `{ id, name, address, latitude, longitude }` (+ distance). The store photos uploaded by the tendero are exposed **only** on `GET /api/v1/tenderos/stores/me`. | `CustomerStore` in `packages/api-contracts/src/coupons.ts:499` |
| The followed-stores list carries **no distance**. | `GET /stores/followed` returns `CustomerStore` without `distanceMeters`/`distanceKm`. Distance for followed stores is only available inside the feed. | `routes/index.ts:1092` |
| No product browsing for customers. | The catalog routes are all `requireRole(["tendero"])`. A customer only sees the product references embedded in a coupon. | `routes/index.ts:436` |
| A released claim can **never** be claimed again (C4). | The claim row stays and `UNIQUE(coupon, customer)` still holds, so releasing is final for that coupon: the re-claim is a `409`. Confirm the release in the UI; it is not an undo. | C4 below |
| No session list and no "sign out everywhere". | `POST /auth/logout` revokes **only** the session behind the access token you send. | `service.ts:723` |
| No notifications of any kind. | Nothing pushes "the store you follow published a coupon" or "your coupon expires tomorrow". There is no device-token endpoint. | repository-wide: no push dependency, no route |
| Rate limiting is per-process, in memory. | Two backend replicas have two independent counters. Treat the documented limits as a floor, not a contract. | `BACKENDS.md` §Rate limiting, `middleware/rate-limit.ts` |
| Order and delivery capabilities are frozen. | Every order/delivery path answers `404`. The cuponera MVP is coupons only (S12). | `routes/index.ts:1322` |

### The five product questions, and how they were answered

The questions this document used to open with were decided on 2026-11-04 (`odd/tasks/clientes-app.md`, L2):

1. **How does a customer register?** Each app says which role it is creating: `POST /auth/otp/verify` takes an optional `registrationRole` of `client` or `tendero` (C1).
2. **Does a customer need a name before claiming?** Yes, at registration: a `client` is `profile_required` until it saves a `fullName`, and the claim route refuses a nameless customer (C2).
3. **Deep links.** Out of the MVP (C5). Nothing has to open a shared coupon, so the missing single-coupon endpoint is no longer blocking anything.
4. **Claim mistakes.** A customer can release a claim, which puts the unit back (C4) — but it cannot take that coupon again.
5. **Discovery without permission.** Followed stores, and ask for the permission: the feed answers with no coordinates at all (C3).

### What the app still has to decide for itself

- Whether to keep asking for the location permission after a refusal, and where the "activar ubicación" affordance lives — the API only decides what the feed answers in each case.
- The Spanish wording for every new `409` below. The tendero's own app falls back to a generic Spanish sentence for a message it does not know yet (`coupon-errors.ts`), so the four new ones (`Add your name…` and the three release ones) are not yet translated anywhere.
- Whether releasing needs a confirmation step. The API makes it final for that coupon (C4), which argues for one.

---

## Quick start

```bash
# 1. infrastructure and the backend (see "Run it locally" for the full setup)
docker compose up -d
pnpm --filter tenderos-backend dev     # http://localhost:4300

API=http://localhost:4300
```

```bash
# 2. sign in: ask for a code, then exchange it for a session
curl -s -X POST "$API/auth/otp/request" \
  -H 'content-type: application/json' \
  -d '{"email":"camila.cliente@example.test"}'
# {"ok":true,"challengeId":"38e3081d-617c-4c11-9edb-9be20ae76123","cooldownSeconds":30}

curl -s -X POST "$API/auth/otp/verify" \
  -H 'content-type: application/json' \
  -d '{"email":"camila.cliente@example.test","challengeId":"38e3081d-…","token":"123456","registrationRole":"client"}'
# { "user": {...}, "session": { "accessToken": "<access-token>", "refreshToken": "<refresh-token>", "expiresIn": 900 }, "isNewUser": false }

TOKEN=<access-token>
```

```bash
# 2b. first run only: a customer must save name AND birth date (18+) before any customer route answers
curl -s -X PUT "$API/api/v1/clientes/profile" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"fullName":"Camila Vega","birthDate":"2002-11-04"}'
# {"data":{"fullName":"Camila Vega","birthDate":"2002-11-04","eligibility":"eligible"}}
```

```bash
# 3. discover: the single feed, from the customer's own position
curl -s "$API/api/v1/clientes/coupons/feed?lat=-0.18212&lng=-78.46834" \
  -H "authorization: Bearer $TOKEN"

# 4. claim: 201, and the ONLY response that carries the QR token
curl -s -X POST "$API/api/v1/clientes/coupons/462a7c0b-…/claims" \
  -H "authorization: Bearer $TOKEN"

# 5. the wallet, afterwards
curl -s "$API/api/v1/clientes/claims" -H "authorization: Bearer $TOKEN"

# 6. gave it back? release it and the unit returns to the coupon's stock
curl -s -X POST "$API/api/v1/clientes/claims/55eac512-…/release" \
  -H "authorization: Bearer $TOKEN"
```

Every call after step 2 sends `Authorization: Bearer <accessToken>`. The access token lives **900 seconds**; refresh it with `POST /auth/refresh` before it dies (see [Flows](#flows)).

---

## Conventions

| Topic | Rule |
| --- | --- |
| Base URL | `http://<host>:4300` in development. A release build **must** use HTTPS (`EXPO_PUBLIC_TENDEROS_API_URL`). |
| Versioning | Only the customer/tendero routes are versioned: `/api/v1/clientes/…`. The auth routes are **not** versioned: `/auth/…`. |
| Content type | `application/json` in and out. Request bodies are capped at **100 kb** (`express.json({ limit: "100kb" })`), so no image bytes ever travel through the API. |
| Success envelope | Customer routes: `{ "data": … }`. Auth: `{ "user": … }`, `{ "session": … }`, `{ "ok": true }`, and the OTP request's flat `{ ok, challengeId, cooldownSeconds }`. |
| Error envelope | `{ "error": "<message>", "code"?: "<code>", "details"?: … }`. `code` appears only on the OTP/rate-limit errors. `details` carries Zod's flattened field errors on a `400`. |
| Auth header | `Authorization: Bearer <accessToken>`. Anything else (missing, malformed, wrong scheme) is a `401`. |
| Role | Every `/api/v1/clientes/*` route requires role `client`. A valid `tendero` token gets `403`. |
| Dates | Every date in a request or a response is a date-only `YYYY-MM-DD` string. No response carries a display timestamp. |
| Distance | Both `distanceMeters` (integer) and `distanceKm` (2 decimals) travel, so the app never re-derives one from the other. |
| Unknown route | `404 {"error":"Route not found: GET /api/v1/clientes/coupons"}` — the method and path are echoed. |
| Server error | `500 {"error":"Internal server error"}`. Outside production the body also carries `details` with the raw message. |

### Status codes

| Code | Meaning in this API |
| --- | --- |
| `200` | Read succeeded, or an idempotent write (follow, unfollow, QR re-issue) reporting the **end state**. |
| `201` | A claim was created. |
| `400` | The request is malformed on its own terms: a bad path parameter, a bad query string, a bad body. Always `{"error":"Invalid request payload.", "details": …}` when Zod rejected it. |
| `401` | No access token, or an expired/revoked/garbage one. Also a wrong or expired OTP code, and an invalid refresh token. |
| `403` | Authenticated but not allowed: wrong role, a disabled account on OTP request, someone else's claim, or a customer who is not yet eligible (no birth date, or under 18). |
| `404` | The thing does not exist (store, coupon, claim), or the route does not exist. |
| `409` | The request is well formed and conflicts with **stored state**: already claimed, out of stock, paused, store deactivated, outside validity, already redeemed, no longer valid, no name on the account, already released. |
| `422` | `PUT /api/v1/clientes/profile` with a well-formed birth date that makes the customer younger than 18. Nothing is stored. |
| `413` | An image upload ticket asked for more than 5 MiB (tendero-only path). |
| `429` | Rate limited. `Retry-After` header + `details.retryAfterSeconds`. |
| `500` | Unexpected failure. `502` appears for impossible-state assertions (e.g. a row that should exist). |

### Strict parsing — extra parameters are errors, not hints

Query strings are parsed by **strict** Zod objects, so anything unexpected is a `400`. The app must send exactly the documented parameters.

```bash
curl -s "$API/api/v1/clientes/stores/nearby?lat=-0.18212&lng=-78.46834&radius=5000" -H "authorization: Bearer $TOKEN"
# 400 {"error":"Invalid request payload.","details":{"formErrors":["Unrecognized key: \"radius\""],"fieldErrors":{}}}
```

Coordinates must be **plain decimal** strings — an optional sign, digits, an optional fraction. Everything else is rejected *before* any conversion, because `Number("")`, `Number(" ")` and `Number("+")` are all `0` and would read as the equator:

| Query | Result |
| --- | --- |
| `?lat=-0.18212&lng=-78.46834` | `200` |
| `?lat=0&lng=0` | `200` (a real point; not special-cased) |
| *(missing)* | `400` `{"lat":["Latitude must be a decimal number."],"lng":["Longitude must be a decimal number."]}` |
| `?lat=&lng=-78.46834` | `400` `Latitude must be a decimal number.` |
| `?lat=1e1&lng=-78.46834` | `400` `Latitude must be a decimal number.` |
| `?lat=91&lng=-78.46834` | `400` `Too big: expected number to be <=90` |
| `?lat=-0.1&lat=-0.2&lng=-78.4` | `400` `Latitude must be a decimal number.` (Express hands back an array) |

### Rate limits

| Limiter | Default | Scope | Response |
| --- | --- | --- | --- |
| Whole API | **120 / minute** (`RATE_LIMIT_API`) | per IP, in-process memory; counts every request including `/health` | `429 {"error":"Too many requests. Try again later.","details":{"retryAfterSeconds":55}}` — **no** `code` field |
| OTP request | **5 / minute** (`RATE_LIMIT_OTP_REQUEST`) | three database buckets: per IP, per email, per IP+email | `429 {"error":"Too many requests. Try again later.","code":"rate_limited","details":{"retryAfterSeconds":30}}` |
| OTP cooldown | **30 s** between codes for one email | per email, from the live challenge | same body as above |
| OTP verify | **10 / minute** (`RATE_LIMIT_OTP_VERIFY`) | same three buckets | same body as above |
| Refresh | **30 / minute** (`RATE_LIMIT_REFRESH`) | per IP, in-process memory | `429` without `code` |
| OTP attempts | **5 wrong codes** locks the challenge | per challenge | subsequent verifies answer `expired_code` |

Both captured verbatim:

```text
429 Too Many Requests
Retry-After: 55
{"error":"Too many requests. Try again later.","details":{"retryAfterSeconds":55}}

429 Too Many Requests
Retry-After: 30
{"error":"Too many requests. Try again later.","code":"rate_limited","details":{"retryAfterSeconds":30}}
```

---

## Auth endpoints

### `POST /auth/otp/request`

Sends a 6-digit code to the email. **Unauthenticated.**

| Field | Type | Rules |
| --- | --- | --- |
| `email` | string | must be a valid email. Normalized (trimmed + lowercased) server-side. |

**200**

```json
{ "ok": true, "challengeId": "38e3081d-617c-4c11-9edb-9be20ae76123", "cooldownSeconds": 30 }
```

Keep `challengeId`: the verify call needs it. `cooldownSeconds` is how long "Resend code" must stay disabled.

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error":"Invalid request payload.","details":{"formErrors":[],"fieldErrors":{"email":["Invalid email address"]}}}` | malformed email |
| `403` | `{"error":"Account is disabled."}` | `users.active = false` |
| `429` | `{"error":"Too many requests. Try again later.","code":"rate_limited","details":{"retryAfterSeconds":30}}` | limit or cooldown |
| `503` | `{"error":"No pudimos enviar el código. Revisá el correo del remitente y la configuración de Resend.","code":"provider_error"}` | the email provider failed (only with `OTP_PROVIDER=resend`) |

> The `503` message is the one Spanish string in the API. Everything else is English and the app translates it.

### `POST /auth/otp/verify`

Exchanges the code for a session. **Unauthenticated.** Creates the user on first verification, with the role the calling app asks for (C1).

| Field | Type | Rules |
| --- | --- | --- |
| `email` | string | valid email, same address the code was sent to |
| `challengeId` | string | UUID from the request step |
| `token` | string | the code, min length 1 |
| `registrationRole` | `"client" \| "tendero"` | **optional.** Which app is registering. Read **only** when this verification creates the account; absent means the backend process's own default (`tendero` in `apps/Tenderos/backend`). |

#### The registration role (C1)

The customer app sends `registrationRole: "client"` on every verify. Three rules make that safe to send always:

1. **It applies at account creation and nowhere else.** An existing account keeps its stored role, and no statement in the auth service writes `role_id` of a user that already exists. Sending it for a returning customer is a no-op.
2. **The set is closed to the two app roles.** `admin`, `marca` and `delivery` are stored values no app registers into, so they are rejected by the schema — before any statement runs, which is why a refused registration leaves no account behind:

   ```text
   400 {"error":"Invalid request payload.","details":{"formErrors":[],"fieldErrors":{"registrationRole":["Invalid option: expected one of \"client\"|\"tendero\""]}}}
   ```

3. **One email is one account and one role.** An address registered through the tendero app answers `200` with `role: "tendero"` and `isNewUser: false`, whatever the indication says — and then `403` on every customer route. There is no upgrade, no second role and no merge.

**200** — the first verification of an unknown email with `registrationRole: "client"`, verbatim:

```json
{
  "user": {
    "id": "3eb582c2-7c8a-4886-b108-f2c173b4ae20",
    "email": "camila.cliente@example.test",
    "fullName": "",
    "role": "client",
    "active": true,
    "emailVerifiedAt": "2026-11-04T14:58:11.849Z",
    "registrationStatus": "profile_required"
  },
  "session": { "accessToken": "<access-token>", "refreshToken": "<refresh-token>", "expiresIn": 900 },
  "isNewUser": true
}
```

`registrationStatus: "profile_required"` is the state C2 requires a name out of, and `isNewUser: true` is the signal to show the name step.

**200** — a **returning** customer (verbatim, tokens replaced):

```json
{
  "user": {
    "id": "96a8bb86-9deb-443a-9e45-e2318d5bf4ab",
    "email": "andres.cliente@example.test",
    "fullName": "",
    "role": "client",
    "active": true,
    "emailVerifiedAt": "2026-11-04T14:10:28.302Z",
    "registrationStatus": "profile_required"
  },
  "session": {
    "accessToken": "<access-token>",
    "refreshToken": "<refresh-token>",
    "expiresIn": 900
  },
  "isNewUser": false
}
```

**200** — the **first-ever** verification of an unknown email with **no** `registrationRole`, verbatim. The role is the backend process's default, which is what keeps the tendero app working unchanged:

```json
{
  "user": {
    "id": "26177d19-3bcf-4f4c-8721-74fb684abb97",
    "email": "camila.cliente@example.test",
    "fullName": "",
    "role": "tendero",
    "active": true,
    "emailVerifiedAt": "2026-11-04T14:07:14.965Z",
    "registrationStatus": "profile_required"
  },
  "session": { "accessToken": "<access-token>", "refreshToken": "<refresh-token>", "expiresIn": 900 },
  "isNewUser": true
}
```

`emailVerifiedAt` is account state, **not** a display field — S11 forbids rendering it. `fullName` is `""` until the app sends one. `isNewUser` is the only signal that an account was just created.

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error":"Invalid request payload.", …}` | missing field, non-UUID `challengeId`, a `registrationRole` outside `client`/`tendero` |
| `401` | `{"error":"Incorrect verification code.","code":"incorrect_code"}` | wrong code |
| `401` | `{"error":"Verification code expired. Request a new code.","code":"expired_code"}` | unknown/expired/consumed/locked challenge |
| `403` | `{"error":"Account is disabled."}` | `users.active = false` |
| `429` | rate-limited body with `code: "rate_limited"` | verify limit |

### `GET /auth/me`

The authenticated user. **Any role**, bearer required.

```bash
curl -s "$API/auth/me" -H "authorization: Bearer $TOKEN"
```

```json
{"user":{"id":"26177d19-3bcf-4f4c-8721-74fb684abb97","email":"camila.cliente@example.test","fullName":"Camila Vega","role":"client","active":true,"emailVerifiedAt":"2026-11-04T14:07:14.965Z","registrationStatus":"completed"}}
```

| Status | Body |
| --- | --- |
| `401` | `{"error":"Missing access token."}` — no `Authorization` header, or not `Bearer ` |
| `401` | `{"error":"Invalid or expired access token."}` — bad signature, expired, revoked, rotated, or the account was disabled |

### `PATCH /auth/me`

The shared name write, and the step that **completes a customer's `registrationStatus`** (C2). **Any role**, bearer required. A customer's birth date is **not** written here: this route is the tendero's too, its body and responses are frozen, and an unknown key such as `birthDate` is ignored. Use `PUT /api/v1/clientes/profile` (below) for the birth date and for eligibility.

| Field | Type | Rules |
| --- | --- | --- |
| `fullName` | string | min length 1. A whitespace-only name passes this check but does **not** satisfy the claim route — see below. |

```bash
curl -s -X PATCH "$API/auth/me" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"fullName":"Camila Vega Ortiz"}'
```

**200** — the full user, with `fullName` updated and the registration **completed**, verbatim:

```json
{"user":{"id":"3eb582c2-7c8a-4886-b108-f2c173b4ae20","email":"camila.cliente@example.test","fullName":"Camila Vega","role":"client","active":true,"emailVerifiedAt":"2026-11-04T14:58:11.849Z","registrationStatus":"completed"}}
```

| Status | Body |
| --- | --- |
| `400` | `{"error":"Invalid request payload.","details":{"formErrors":[],"fieldErrors":{"fullName":["Too small: expected string to have >=1 characters"]}}}` |
| `401` | as `GET /auth/me` |

> **`registrationStatus` is not eligibility (C9).** A customer who saved only a name through this route is `completed` and still gets `403` on every customer route until the birth date is stored. Read eligibility from `GET /api/v1/clientes/profile`.
>
> **`registrationStatus` now has a customer end state (C2).** For a `client`, this route advances `profile_required` → `completed` in one step: a customer has no store to create, so there is nothing between its name and a finished registration. A second write never degrades it. For every other role the old path is untouched — a `tendero` still goes `profile_required` → `store_required` here and reaches `completed` only through the tendero-only `registration/complete` route. `profile_required` therefore means "no name saved yet" and `completed` means "a name was saved" — not that the customer may use the API.
>
> The **claim** route is where the name is enforced, not this one. `fullName` only has to be one character here, and a whitespace-only name would leave the tendero's scanner with no name to read, so the claim route tests for a renderable name instead (see route 6). The validation of this route is shared with the tendero's own auth flow and is deliberately left alone.

### `POST /auth/refresh`

Rotates the session. **Unauthenticated** (the refresh token *is* the credential). Rate limited to 30/minute per IP.

| Field | Type | Rules |
| --- | --- | --- |
| `refreshToken` | string | min length 1 |

**200**

```json
{"session":{"accessToken":"<access-token>","refreshToken":"<refresh-token>","expiresIn":900}}
```

Rotation is strict and has two consequences the app must handle:

1. The **previous access token stops working immediately** (`401 Invalid or expired access token.`). Never keep using the old one.
2. **Replaying a refresh token revokes the whole session family.** Verified: a second call with the same token answers `401 {"error":"Invalid refresh token."}` *and* the freshly issued access token from the first call also becomes `401`. A duplicated refresh (two parallel requests, a retry after a timeout) therefore signs the customer out. Serialize refreshes behind one in-flight promise.

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error":"Invalid request payload.", …}` | missing/empty `refreshToken` |
| `401` | `{"error":"Invalid refresh token."}` | unknown, already rotated, revoked, expired (30 days), or the user is inactive/unverified |
| `429` | `{"error":"Too many requests. Try again later.","details":{"retryAfterSeconds":N}}` | refresh limit |

### `POST /auth/logout`

Revokes the session behind the access token you send. **Any role**, bearer required. No body.

```json
{ "ok": true }
```

Afterwards the access token is `401 Invalid or expired access token.` and its refresh token is `401 Invalid refresh token.` Both verified.

| Status | Body |
| --- | --- |
| `401` | as `GET /auth/me` |

### `POST /auth/registration/complete` — not available to the customer app

`requireAuth(["tendero"])`, and its payload creates a **store**. A `client` token gets:

```text
403 {"error":"You do not have access to this resource."}
```

---

## Customer eligibility and profile (C8, C9)

A customer may call the nine customer routes below only with a **stored birth date that makes them at least 18** on the `America/Bogota` calendar day (the 18th birthday itself qualifies). This applies to new accounts **and to accounts that existed before the rule** — nobody is grandfathered, and no birthday was invented for them: their `birthDate` is `null` until they save one. `registrationStatus` plays no part in it. Tendero accounts are not affected in any way: they are never asked for a birth date, their auth responses carry no new key, and their routes are not gated.

Two routes sit **outside** the gate, because the way out of it cannot be behind it. Both need `Authorization: Bearer <accessToken>` with role `client` (`401` without a token, `403 {"error":"You do not have access to this resource."}` for another role). Sign-out is the existing `POST /auth/logout`, also outside the gate. Responses below were captured from a real run on 2026-11-08 against a throwaway PostgreSQL database; ids, tokens and timestamps are replaced.

### `GET /api/v1/clientes/profile`

```json
{"data":{"fullName":"","birthDate":null,"eligibility":"birth_date_required"}}
```

| Key | Type | Meaning |
| --- | --- | --- |
| `fullName` | string | The stored name, `""` when none. |
| `birthDate` | `YYYY-MM-DD` string or `null` | Date-only (S11): never a time, never shifted by a timezone. |
| `eligibility` | `"eligible"` \| `"birth_date_required"` \| `"underage"` | `underage` can only be seen for a date stored outside this API; this API refuses to store one. |

### `PUT /api/v1/clientes/profile`

Saves the name and the birth date **together or not at all**, and answers with the same shape as the `GET`. It also advances a client's `registrationStatus` from `profile_required` to `completed`, exactly as `PATCH /auth/me` does. It can never change the stored role; unknown keys such as `role` are ignored. Sending it again overwrites both values; that is how a mistyped date is corrected, and it does not imply an edit-profile screen.

| Field | Type | Rules |
| --- | --- | --- |
| `fullName` | string | Trimmed, then at least 1 character. The trimmed value is stored. |
| `birthDate` | string | Exactly `YYYY-MM-DD`, a real calendar date (no `2002-02-30`, no `2023-02-29`), written with a four-digit positive year. No earliest year is enforced. |

```bash
curl -s -X PUT "$API/api/v1/clientes/profile" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"fullName":"Camila Vega","birthDate":"2002-11-04"}'
```

**200** — `{"data":{"fullName":"Camila Vega","birthDate":"2002-11-04","eligibility":"eligible"}}`

| Status | Body | When |
| --- | --- | --- |
| `422` | `{"error":"You must be at least 18 years old to use Savanhi.","details":{"eligibility":"underage","minimumAge":18}}` | a real date younger than 18 (including a future date). Nothing is stored. |
| `400` | `{"error":"Invalid request payload.","details":{"formErrors":[],"fieldErrors":{"birthDate":["Birth date must be a real date written YYYY-MM-DD."]}}}` | a missing, mistyped or impossible date. Nothing is stored. |
| `400` | `{"error":"Invalid request payload.","details":{"formErrors":[],"fieldErrors":{"fullName":["Too small: expected string to have >=1 characters"]}}}` | an empty or whitespace-only name. Nothing is stored. |

Age is counted in completed years on the Bogota calendar day. A 29 February birthday is reached on 1 March in a common year, so a customer born on 29 February 2008 is still under 18 on 28 February 2026 and eligible on 1 March 2026.

The Spanish sentence the app shows for the `422` and for `underage` is the app's, not the API's: the messages above are English log text; key on `details.eligibility`.

### The gate on every other customer route

An ineligible customer gets, on all nine routes, before any validation of the request:

| Status | Body | When |
| --- | --- | --- |
| `403` | `{"error":"Complete your profile to use Savanhi.","details":{"eligibility":"birth_date_required","minimumAge":18}}` | no stored birth date |
| `403` | `{"error":"You must be at least 18 years old to use Savanhi.","details":{"eligibility":"underage","minimumAge":18}}` | a stored date younger than 18 |

The check reads the database on every request, so saving a valid profile unlocks the very next call. A nameless but adult customer passes the gate and is still refused at the claim with the name `409` (C2).

---

## Customer endpoints

All nine require `Authorization: Bearer <accessToken>` with role `client` **and an eligible profile** (see the section above).

Shared failures, identical on every one of them:

| Status | Body | When |
| --- | --- | --- |
| `401` | `{"error":"Missing access token."}` | no bearer header |
| `401` | `{"error":"Invalid or expired access token."}` | bad/expired/revoked token |
| `403` | `{"error":"You do not have access to this resource."}` | a valid token whose role is not `client` |
| `403` | `{"error":"Complete your profile to use Savanhi.","details":{"eligibility":"birth_date_required","minimumAge":18}}` or the under-18 message | an ineligible customer (C9) |
| `400` | `{"error":"Invalid request payload.","details":{"formErrors":[],"fieldErrors":{"storeId":["Invalid UUID"]}}}` | a path parameter that is not a UUID (field name is `storeId`, `couponId` or `claimId`) |
| `429` | `{"error":"Too many requests. Try again later.","details":{"retryAfterSeconds":N}}` | the 120/minute API limiter |

### 1. `GET /api/v1/clientes/stores/nearby`

Active stores within the fixed **3 km** radius, nearest first.

| Parameter | In | Type | Rules |
| --- | --- | --- | --- |
| `lat` | query | decimal string | required, `-90 … 90` |
| `lng` | query | decimal string | required, `-180 … 180` |

No other parameter is accepted; the radius is **not** configurable (`COUPON_FEED_RADIUS_METERS = 3000`).

**200** — `{ data: NearbyStore[] }`, sorted by distance ascending then by name. A store with no coordinates is never included (it has no distance), and an inactive store is excluded.

```bash
curl -s "$API/api/v1/clientes/stores/nearby?lat=-0.18212&lng=-78.46834" -H "authorization: Bearer $TOKEN"
```

```json
{
  "data": [
    {
      "id": "e123f6cc-1230-4698-a295-dcc733c3d20c",
      "name": "Tienda Doña Rosa",
      "address": "Calle Los Nogales 142",
      "latitude": -0.18065,
      "longitude": -78.46784,
      "distanceMeters": 173,
      "distanceKm": 0.17
    }
  ]
}
```

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error":"Invalid request payload.", …}` | any coordinate problem or an extra parameter |
| `502` | `{"error":"Unable to measure the distance to a store."}` | a store inside the radius came back without a measurable distance (should be unreachable) |

### 2. `GET /api/v1/clientes/stores/followed`

The active stores this customer follows. No parameters.

**200** — `{ data: CustomerStore[] }`, sorted by name. **No distance fields here.** A store that was deactivated disappears from this list (verified: the list goes to `[]`), while the follow row itself survives.

```json
{
  "data": [
    {
      "id": "ff86d66b-9498-42a9-8c96-9b9f58d7d4e0",
      "name": "Minimarket El Vecino",
      "address": "Av. Los Cipreses 88",
      "latitude": -0.2801,
      "longitude": -78.521
    }
  ]
}
```

### 3. `PUT /api/v1/clientes/stores/:storeId/follow`

Follows a store. **Idempotent**, no body, answers the end state.

| Parameter | In | Type |
| --- | --- | --- |
| `storeId` | path | UUID |

**200**

```json
{ "data": { "storeId": "ff86d66b-9498-42a9-8c96-9b9f58d7d4e0", "following": true } }
```

Calling it twice answers `200` with the same body both times (verified).

| Status | Body | When |
| --- | --- | --- |
| `404` | `{"error":"Store not found."}` | unknown store **or** a store that is not active — a customer can only follow what discovery can show |

### 4. `DELETE /api/v1/clientes/stores/:storeId/follow`

Unfollows. **Idempotent**, no body.

**200**

```json
{ "data": { "storeId": "ff86d66b-9498-42a9-8c96-9b9f58d7d4e0", "following": false } }
```

Unlike follow, this does **not** require the store to be active: a customer must always be able to stop following a store that was deactivated.

| Status | Body | When |
| --- | --- | --- |
| `404` | `{"error":"Store not found."}` | the store does not exist at all |

### 5. `GET /api/v1/clientes/coupons/feed`

**The** discovery screen, in one request: every claimable coupon of every active store within 3 km, **plus** every followed store's coupons however far away.

| Parameter | In | Type | Rules |
| --- | --- | --- | --- |
| `lat` | query | decimal string | **optional**, `-90 … 90`. Required when `lng` is sent. |
| `lng` | query | decimal string | **optional**, `-180 … 180`. Required when `lat` is sent. |

The pair is all-or-nothing (C3): both, or neither. Half a position is a `400`, because the missing axis has no honest value to stand in for it:

```text
GET /api/v1/clientes/coupons/feed?lat=4.711
400 {"error":"Invalid request payload.","details":{"formErrors":["Latitude and longitude travel together."],"fieldErrors":{}}}
```

"Claimable" is evaluated in the database: not paused, today inside `[validFrom, validTo]` (inclusive, in the `America/Bogota` calendar), and `claimedCount < totalStock`. An inactive store's coupons never appear.

**200** — `{ data: CustomerCouponFeedItem[] }`:

- Ordered by `store.distanceMeters` ascending, with never-pinned stores last. The sort is stable, so coupons of equally distant stores keep newest-first order.
- A store reached both ways (nearby **and** followed) appears **once**.
- `followed` drives the "Siguiendo" badge. `claimed` is true when this customer already holds a claim for that coupon — the card must not offer "Reclamar" again (it would be a `409`).

```bash
curl -s "$API/api/v1/clientes/coupons/feed?lat=-0.18212&lng=-78.46834" -H "authorization: Bearer $TOKEN"
```

Projection of a real 5-item response (`jq '.data | map({title: .coupon.title, type: .coupon.type, store: .store.name, distanceKm: .store.distanceKm, followed, claimed})'`):

```json
[
  { "title": "$0.50 de descuento en gaseosa",     "type": "fixed_amount", "store": "Tienda Doña Rosa",     "distanceKm": 0.17,  "followed": false, "claimed": false },
  { "title": "Pan de yuca gratis con tu compra",  "type": "free_text",    "store": "Tienda Doña Rosa",     "distanceKm": 0.17,  "followed": false, "claimed": false },
  { "title": "Combo gaseosa + pan de yuca",       "type": "combo",        "store": "Tienda Doña Rosa",     "distanceKm": 0.17,  "followed": false, "claimed": false },
  { "title": "20% en galletas Sol de Oro",        "type": "percentage",   "store": "Tienda Doña Rosa",     "distanceKm": 0.17,  "followed": false, "claimed": false },
  { "title": "15% en arroz Campo Lindo",          "type": "percentage",   "store": "Minimarket El Vecino", "distanceKm": 12.37, "followed": true,  "claimed": false }
]
```

The last item is the point of the single feed: **12.37 km away, included because the customer follows that store**, carrying `followed: true`.

One full item, verbatim (the far followed store):

```json
{
  "coupon": {
    "id": "f6d71e22-505e-4b1a-919c-70e70864582b",
    "storeId": "ff86d66b-9498-42a9-8c96-9b9f58d7d4e0",
    "type": "percentage",
    "title": "15% en arroz Campo Lindo",
    "description": null,
    "freeText": null,
    "percentageValue": 15,
    "fixedAmountValue": null,
    "validFrom": "2026-11-01",
    "validTo": "2026-11-25",
    "totalStock": 40,
    "claimedCount": 0,
    "remainingStock": 40,
    "paused": false,
    "imageUrl": null,
    "products": [
      {
        "productId": "8871846b-7db8-4cb5-9052-f4650fc774cd",
        "name": "Arroz Campo Lindo 2 kg",
        "source": "store_private",
        "category": null
      }
    ]
  },
  "store": {
    "id": "ff86d66b-9498-42a9-8c96-9b9f58d7d4e0",
    "name": "Minimarket El Vecino",
    "address": "Av. Los Cipreses 88",
    "latitude": -0.2801,
    "longitude": -78.521,
    "distanceMeters": 12369,
    "distanceKm": 12.37
  },
  "followed": true,
  "claimed": false
}
```

After claiming, the same feed shows `claimed: true` and the reduced stock (same projection, plus `remainingStock`):

```json
[
  { "title": "Combo gaseosa + pan de yuca", "remainingStock": 29, "distanceKm": 0.17, "followed": false, "claimed": true },
  { "title": "20% en galletas Sol de Oro",  "remainingStock": 49, "distanceKm": 0.17, "followed": false, "claimed": true },
  { "title": "15% en arroz Campo Lindo",    "remainingStock": 40, "distanceKm": 12.37, "followed": true,  "claimed": false }
]
```

> Note what left that list: the exhausted coupon (`remainingStock 0`) and the one whose window was moved into the past. The feed only ever shows what is claimable **today**.

#### Without coordinates: the followed half (C3)

Send **no query string at all** when the location permission was denied. The answer is the same shape — one list of `CustomerCouponFeedItem` — holding the claimable coupons of the customer's followed stores only, each with `followed: true` and no distance. Verbatim, one item (the coupon object projected):

```json
{
  "data": [
    {
      "coupon": { "title": "15% en arroz Campo Lindo", "totalStock": 40, "remainingStock": 40, "paused": false },
      "store": {
        "id": "a670d4ac-6e79-4066-9e63-4365c950d965",
        "name": "Minimarket El Vecino",
        "address": null,
        "latitude": 4.761,
        "longitude": -74.0729,
        "distanceMeters": null,
        "distanceKm": null
      },
      "followed": true,
      "claimed": false
    }
  ]
}
```

Three consequences for the screen:

1. **A customer who follows nothing gets `[]`.** That empty state is the place to ask for the permission — the decision was "seguidas + pedir permiso", not "seguidas instead of permission".
2. `distanceMeters` and `distanceKm` are `null` for **every** item, including stores that do have coordinates: nothing is measurable from nowhere. Render "sin distancia", never "0 km".
3. Nothing nearby appears. A non-followed store 200 m away is absent, which is the honest answer and not a bug to work around.

The coordinate grammar is unchanged when the pair **is** sent: a blank, a space, a lone sign, `1e1` or `0x10` are all still `400` before any conversion. `.optional()` admits an absent parameter, never an empty one.

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error":"Invalid request payload.", …}` | exactly one coordinate, a coordinate problem, or an extra parameter |
| `502` | `{"error":"Unable to read the coupon feed."}` | internal assembly failure (should be unreachable) |

### 6. `POST /api/v1/clientes/coupons/:couponId/claims`

Claims a coupon: reserves one unit of stock and creates the claim. **This is the only response that carries the plaintext QR token** besides the re-issue below.

| Parameter | In | Type |
| --- | --- | --- |
| `couponId` | path | UUID |

No body.

**201** — `{ data: CustomerClaim }`, verbatim (QR token replaced with a placeholder, image signature truncated):

```json
{
  "data": {
    "id": "55eac512-26d4-4ba5-931f-80438f13bc7d",
    "status": "claimed",
    "qrToken": "<qr-token: 43 base64url chars>",
    "claimedOn": "2026-11-04",
    "redeemedOn": null,
    "coupon": {
      "id": "462a7c0b-ef6a-4b1d-9899-530adfbde892",
      "storeId": "e123f6cc-1230-4698-a295-dcc733c3d20c",
      "type": "percentage",
      "title": "20% en galletas Sol de Oro",
      "description": "Solo en tienda, hasta fin de mes.",
      "freeText": null,
      "percentageValue": 20,
      "fixedAmountValue": null,
      "validFrom": "2026-11-01",
      "validTo": "2026-11-30",
      "totalStock": 50,
      "claimedCount": 1,
      "remainingStock": 49,
      "paused": false,
      "imageUrl": "http://localhost:3900/savanhi-dev/coupons/e123f6cc-…/02bab9d3-….jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=<redacted>&…",
      "products": [
        {
          "productId": "abd420fa-68db-4fd2-a997-130d6574f71a",
          "name": "Galletas Sol de Oro Vainilla",
          "source": "store_catalog",
          "category": {
            "id": "09dc9772-efe5-4627-a5f4-347e3619d52c",
            "name": "Confitería",
            "key": "confiteria"
          }
        }
      ]
    },
    "store": {
      "id": "e123f6cc-1230-4698-a295-dcc733c3d20c",
      "name": "Tienda Doña Rosa"
    }
  }
}
```

**Store `qrToken` immediately and securely** (Keychain / Keystore, never plain `AsyncStorage`, never a log). Only its SHA-256 hash is kept server-side, so the plaintext cannot be read back — losing it means re-issuing (route 9), which invalidates the one you lost.

Every rejection leaves stock and counters **unchanged**:

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error":"Invalid request payload.","details":{"formErrors":[],"fieldErrors":{"couponId":["Invalid UUID"]}}}` | `couponId` is not a UUID |
| `404` | `{"error":"Coupon not found."}` | no such coupon |
| `409` | `{"error":"This store is deactivated and is not accepting new claims."}` | the owning store is inactive (checked first) |
| `409` | `{"error":"This coupon is paused and is not accepting new claims."}` | `paused = true` |
| `409` | `{"error":"This coupon is not valid today."}` | today is outside `[validFrom, validTo]` |
| `409` | `{"error":"Add your name before claiming a coupon."}` | the customer's stored `fullName` has no non-whitespace character (C2) |
| `409` | `{"error":"You have already claimed this coupon."}` | once per customer per coupon |
| `409` | `{"error":"You already released this coupon and cannot claim it again."}` | the customer released this very coupon (C4) |
| `409` | `{"error":"This coupon is out of stock."}` | `claimedCount = totalStock` (concurrency-safe: the loser of a race gets this) |
| `502` | `{"error":"Unable to create the claim."}` / `{"error":"Unable to read the claim."}` | internal failure |

The name check is the customer's own precondition and is evaluated **inside** the claim transaction, before the reservation, so a refused claim leaves `claimedCount` and the stored claim count untouched (verified). Gate the claim button on `registrationStatus === "completed"` and this `409` never surfaces.

### 7. `GET /api/v1/clientes/claims`


The wallet: every claim of this customer, newest first. No parameters, **no pagination**.

**200** — `{ data: CustomerClaim[] }` with `qrToken: null` on every entry. One captured response holding all three statuses at once (coupon objects projected for brevity):

```json
[
  { "id": "dbd012f5-…", "status": "expired",  "qrToken": null, "claimedOn": "2026-11-04", "redeemedOn": null,         "coupon": { "title": "Pan de yuca gratis con tu compra", "validTo": "2026-11-02" }, "store": { "name": "Tienda Doña Rosa" } },
  { "id": "c1a935b1-…", "status": "claimed",  "qrToken": null, "claimedOn": "2026-11-04", "redeemedOn": null,         "coupon": { "title": "Combo gaseosa + pan de yuca",      "validTo": "2026-11-20" }, "store": { "name": "Tienda Doña Rosa" } },
  { "id": "55eac512-…", "status": "redeemed", "qrToken": null, "claimedOn": "2026-11-04", "redeemedOn": "2026-11-04", "coupon": { "title": "20% en galletas Sol de Oro",       "validTo": "2026-11-30" }, "store": { "name": "Tienda Doña Rosa" } }
]
```

Each entry carries the **full** `coupon` object (same 16 keys as in the feed) and a minimal `store` of `{ id, name }` — the wallet tells the customer *where* to redeem, not how far away it is.

A released claim appears here too, with `status: "released"` and `qrToken: null` (verbatim capture in route 8 below).

`expired` is **derived on read**, never stored: the first entry's row still says `claimed` in the database (verified), and it reads `expired` only because `validTo` is in the past. Three consequences for the app:

1. Status is a function of today. A screen left open overnight can be wrong; re-read on focus.
2. Never cache `status` as a fact about the claim.
3. The server is the only authority on expiry — do not compute it from `validTo` in a different timezone (see the calendar rule below).

### 8. `POST /api/v1/clientes/claims/:claimId/release`

Gives one of **your own** claims back (C4): the reserved unit returns to the coupon's stock and the QR stops working. Nothing is deleted — the claim row stays, which is why this is a POST on a sub-resource and not a `DELETE`.

| Parameter | In | Type |
| --- | --- | --- |
| `claimId` | path | UUID |

No body. The answer is `200` and not `201`: the claim already existed and this call transitions it.

**200** — the same `CustomerClaim` shape, now `released` (coupon object projected; `claimedCount` and `remainingStock` already reflect the returned unit):

```json
{
  "data": {
    "id": "74083851-f4d8-4607-86ee-ccf5c7617ebb",
    "status": "released",
    "qrToken": null,
    "claimedOn": "2026-11-04",
    "redeemedOn": null,
    "coupon": { "title": "20% en galletas Sol de Oro", "totalStock": 50, "claimedCount": 0, "remainingStock": 50 },
    "store": { "id": "9769f5f3-fc6b-4487-bcbd-5657614e58fc", "name": "Tienda Doña Rosa" }
  }
}
```

What the release does, all in one transaction with the claim row locked:

1. `claimedCount` goes **down by one**, exactly once. Three parallel releases of one claim answer one `200` and two `409`, and the counter moves once (verified).
2. The QR dies. The tendero's preview, the redemption and the re-issue below all answer `409 {"error":"This claim was released and is no longer valid."}` (all three verified).
3. The claim stays in the wallet reading `status: "released"`, `qrToken: null`. It is **not** hidden: a claim that silently disappeared would read as a bug, and the re-claim refusal would have nothing to point at.
4. **The coupon cannot be taken again by this customer.** `UNIQUE(coupon, customer)` still holds, so a second claim is `409 {"error":"You already released this coupon and cannot claim it again."}`. Another customer can take the unit immediately.
5. A release racing a redemption has exactly one winner — both take the same row lock and both carry their precondition in their own `UPDATE`.

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error":"Invalid request payload.","details":{"formErrors":[],"fieldErrors":{"claimId":["Invalid UUID"]}}}` | `claimId` is not a UUID |
| `404` | `{"error":"Claim not found."}` | no such claim |
| `403` | `{"error":"This claim belongs to another customer."}` | the claim exists but is someone else's |
| `409` | `{"error":"This claim was already released."}` | released before (idempotency is deliberately **not** a silent success) |
| `409` | `{"error":"This claim has already been redeemed."}` | already redeemed — there is nothing to give back |
| `409` | `{"error":"This coupon is no longer valid."}` | past `validTo`: the validity end date already took it out of circulation |

A paused coupon and a deactivated store are deliberately **not** checked here, the same way the redemption does not check them: both block new claims only, and refusing a release would trap the customer in a coupon they can neither use nor give back.

> Treat this as **final, not undo**. Confirm it in the UI ("¿Devolver este cupón? No podrás volver a reclamarlo"), because the only way back is another customer taking that unit.

### 9. `POST /api/v1/clientes/claims/:claimId/qr`

Re-issues the QR of one of **your own** claims. Use it when the stored token was lost (reinstall, new device, cleared storage).

| Parameter | In | Type |
| --- | --- | --- |
| `claimId` | path | UUID |

No body.

**200** — the same `CustomerClaim` shape as the claim response, with a **new** `qrToken`:

```json
{ "data": { "id": "55eac512-…", "status": "claimed", "qrToken": "<new-qr-token>", "claimedOn": "2026-11-04", "redeemedOn": null, "coupon": { … }, "store": { … } } }
```

**The previous token dies instantly.** Verified: scanning the old token at the counter answers `404 {"error":"No claim matches this QR code."}`. Never call this while the customer is standing at the counter with the QR on screen.

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error":"Invalid request payload.","details":{"formErrors":[],"fieldErrors":{"claimId":["Invalid UUID"]}}}` | `claimId` is not a UUID |
| `404` | `{"error":"Claim not found."}` | no such claim |
| `403` | `{"error":"This claim belongs to another customer."}` | the claim exists but is someone else's |
| `409` | `{"error":"This claim has already been redeemed."}` | already redeemed (also the race winner's answer) |
| `409` | `{"error":"This claim was released and is no longer valid."}` | released (C4) — there is no QR to re-issue |
| `409` | `{"error":"This coupon is no longer valid."}` | past `validTo` |

---

## Shared models

### `Coupon` — 16 keys, no timestamps

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string (UUID) | for requests only; **never rendered** (S11) |
| `storeId` | string (UUID) | never rendered |
| `type` | `"free_text" \| "combo" \| "percentage" \| "fixed_amount"` | exactly one type per coupon |
| `title` | string | ≤ 120 chars |
| `description` | string \| null | ≤ 500 chars |
| `freeText` | string \| null | non-null **only** when `type = "free_text"` (≤ 280 chars) |
| `percentageValue` | number \| null | non-null only for `percentage`; whole percent, 1–100 |
| `fixedAmountValue` | number \| null | non-null only for `fixed_amount`; positive, ≤ 2 decimals |
| `validFrom`, `validTo` | string | `YYYY-MM-DD`, `validFrom <= validTo` |
| `totalStock` | integer | ≥ 0 |
| `claimedCount` | integer | reservations made (S8) |
| `remainingStock` | integer | `max(totalStock - claimedCount, 0)`; `0` means exhausted |
| `paused` | boolean | a paused coupon never reaches the feed |
| `imageUrl` | string \| null | **presigned and expiring** — see below |
| `products` | `CouponProductDetail[]` | at least one; exactly one for every type except `combo` |

`combo` is one type with two readings: **one** product means a 2x1, **two or more** means a combo. The app decides the wording from `products.length`.

### `CouponProductDetail`

| Field | Type | Notes |
| --- | --- | --- |
| `source` | `"store_catalog" \| "store_private"` | the same `productId` under the two sources is two different products |
| `productId` | string (UUID) | never rendered |
| `name` | string | the catalog commercial name or the store-private product name |
| `category` | `CouponProductCategory` \| null | null as a whole when the product has no category |

### `CouponProductCategory`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string (UUID) | never rendered |
| `name` | string | for display |
| `key` | string \| null | the **stable icon key** (the catalog slug). `null` for a store-authored category, whose name is free text the tendero typed — fall back to a default icon. |

All four real variants, captured:

```json
{ "source": "store_catalog", "name": "Galletas Sol de Oro Vainilla", "category": { "name": "Confitería",       "key": "confiteria" } }
{ "source": "store_private", "name": "Gaseosa Fresca Andina 1.5 L", "category": { "name": "Bebidas gaseosas", "key": "bebidas-gaseosas" } }
{ "source": "store_private", "name": "Pan de yuca Doña Rosa",      "category": { "name": "Panadería del día", "key": null } }
{ "source": "store_private", "name": "Arroz Campo Lindo 2 kg",     "category": null }
```

There are **no product images** anywhere in the MVP: render the coupon's own `imageUrl` when it has one, otherwise the category icon of its first product (keys seeded today: `bebidas-gaseosas`, `lacteos`, `despensa`, `confiteria`, `higiene-del-hogar`).

### Stores — three shapes, deliberately different

| Model | Where | Fields |
| --- | --- | --- |
| `CustomerStore` | `GET /stores/followed` | `id`, `name`, `address \| null`, `latitude \| null`, `longitude \| null` |
| `NearbyStore` | `GET /stores/nearby` | `CustomerStore` with **non-null** `latitude`/`longitude` + `distanceMeters` + `distanceKm` |
| `CustomerFeedStore` | feed items | `CustomerStore` + `distanceMeters \| null` + `distanceKm \| null` (null for a followed store that was never pinned on the map) |
| `CustomerClaimStore` | claims | `{ id, name }` only |

None of them carries a creation timestamp, the owner, or bank fields — the tendero-facing `Store` is a different model and never reaches a customer.

### `CustomerCouponFeedItem`

```ts
{ coupon: Coupon; store: CustomerFeedStore; followed: boolean; claimed: boolean }
```

### `CustomerClaim`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string (UUID) | never rendered; needed for the QR re-issue and the release |
| `status` | `"claimed" \| "redeemed" \| "expired" \| "released"` | `expired` and `released` are both derived, never stored |
| `qrToken` | string \| null | non-null **only** on `POST …/claims` and `POST …/claims/:id/qr` |
| `claimedOn` | string | `YYYY-MM-DD` |
| `redeemedOn` | string \| null | `YYYY-MM-DD`, null until redeemed |
| `coupon` | `Coupon` | full object |
| `store` | `CustomerClaimStore` | `{ id, name }` |

### Statuses

| Status | Stored? | Meaning | How it is reached |
| --- | --- | --- | --- |
| `claimed` | yes | reserved, not yet redeemed, still inside the validity window | `POST …/claims` |
| `redeemed` | yes | the tendero scanned the QR; `redeemedOn` is set | tendero's `POST /api/v1/tenderos/coupon-redemptions` |
| `expired` | **no — derived** | stored status is `claimed` and `validTo < today` | the calendar day moving past `validTo` |
| `released` | **no — derived** | stored status is `claimed` and the row carries a `released_on` date | `POST …/claims/:id/release` |

An expired claim can never be redeemed and can never get a new QR, and nothing ever flips it back. From the tendero's metrics it still counts as *claimed* (it happened) and never as *redeemed*.

A **released** claim is the opposite: from the tendero's metrics it counts as neither. Captured before and after one release of a coupon with `totalStock: 50` and one claim:

```json
{ "title": "20% en galletas Sol de Oro", "claimedCount": 1, "redeemedCount": 0, "remainingStock": 49 }
{ "title": "20% en galletas Sol de Oro", "claimedCount": 0, "redeemedCount": 0, "remainingStock": 50 }
```

It never appears in the redemption history either, and `released` wins over `expired` in the wallet: the release is why the claim ended, whatever the window later says. The `released_on` date is kept in the database and deliberately **not** in the response — the wallet needs the fact, and no new date reaches a screen (S11).

---

## Flows

### Sign in and refresh

```text
app                             API
 │  POST /auth/otp/request {email}        → 200 { ok, challengeId, cooldownSeconds }
 │  (user types the 6-digit code)
 │  POST /auth/otp/verify {email, challengeId, token, registrationRole: "client"}
 │                                        → 200 { user, session, isNewUser }
 │  isNewUser || registrationStatus === "profile_required"
 │      → ask for the name → PATCH /auth/me {fullName} → 200 { registrationStatus: "completed" }
 │  user.role !== "client"                → this email is a tendero account: dead end, say so
 │  store accessToken (900 s) + refreshToken (30 d) securely
 │  … any 401 "Invalid or expired access token." …
 │  POST /auth/refresh {refreshToken}     → 200 { session }   ← ONE call at a time
 │  replace BOTH tokens; the previous access token is already dead
 │  (a replayed refreshToken → 401 and the whole family is revoked → sign in again)
```

### Discover

```text
 │  ask for location permission
 │  granted → (lat, lng)
 │     GET /clientes/coupons/feed?lat&lng → 200 [ items ]   ← the one list screen
 │     GET /clientes/stores/nearby?lat&lng → 200 [ stores ] ← only for the map
 │  denied  → no coordinates at all
 │     GET /clientes/coupons/feed          → 200 [ followed items, distance null ]
 │     (no nearby call: a map without a position has nothing to draw)
 │     [] → the empty state is where you ask for the permission again
```

The map still needs coordinates; the feed does not (C3).

### Follow

```text
 │  PUT    /clientes/stores/:storeId/follow   → 200 { storeId, following: true }
 │  DELETE /clientes/stores/:storeId/follow   → 200 { storeId, following: false }
 │  GET    /clientes/stores/followed          → 200 [ stores ]
```

Both writes are idempotent and answer the end state, so the UI can be optimistic and reconcile with `following`. Re-read the feed afterwards: a newly followed far store adds items with `followed: true`.

### Claim and show the QR

```text
 │  POST /clientes/coupons/:couponId/claims   → 201 { data: { qrToken, … } }
 │  save qrToken in the secure store, keyed by claim id
 │  render it as a QR (the tendero scans it with expo-camera)
 │  tendero: POST /api/v1/tenderos/coupon-redemptions/preview {qrToken} → what it WOULD redeem
 │  tendero: POST /api/v1/tenderos/coupon-redemptions         {qrToken} → 200 status "redeemed"
```

The token travels only in a POST body, never in a URL — do the same in the app: no deep link, no query string, no log line.

### Lost QR re-issue

```text
 │  wallet shows a "claimed" claim with no token on this device
 │  POST /clientes/claims/:claimId/qr        → 200 { data: { qrToken: "<new>", … } }
 │  the OLD token is now dead: a scan of it answers 404 "No claim matches this QR code."
```

Offer it as explicit recovery ("Generar otro código"), never automatically, and never while the QR is on screen at the counter.

### Giving a coupon back

```text
 │  wallet shows a "claimed" claim the customer no longer wants
 │  confirm ("No podrás volver a reclamarlo")
 │  POST /clientes/claims/:claimId/release   → 200 { data: { status: "released", qrToken: null } }
 │  drop the stored qrToken for that claim from the secure store
 │  the feed still reports claimed: true for that coupon — read it as "ya lo tomaste"
 │  a re-claim answers 409 "You already released this coupon and cannot claim it again."
```

The unit is back in `remainingStock` the moment the call returns, so another customer can take it — including before this one changes their mind.

### Redemption seen from the wallet

```text
 │  before:  GET /clientes/claims → status "claimed",  redeemedOn null
 │  (the tendero scans)
 │  after:   GET /clientes/claims → status "redeemed", redeemedOn "2026-11-04"
```

Verified end to end. There is no push and no websocket, so the only way the app learns about a redemption is by re-reading the wallet — refresh it on focus.

---

## Rules the app must respect

### S11 — never render an identifier, never render a clock time

- IDs travel in payloads (`id`, `storeId`, `couponId`, `claimId`, `category.id`) and are for requests, keys and navigation **only**. No screen may show one.
- Every user-facing date is a `YYYY-MM-DD` string: `validFrom`, `validTo`, `claimedOn`, `redeemedOn`. Format them with one shared date-only helper and never construct a `Date` from them — `new Date("2026-01-01")` is UTC midnight and reads as *2025-12-31* in `America/Bogota`.
- The only ISO timestamp in any customer payload is `user.emailVerifiedAt`, which is account state, not display data. (`GET /health` also returns one; it is an ops route, not a screen.)

### The calendar is `America/Bogota`

Validity, the derived `expired` status, and the stored `claimedOn`/`redeemedOn` are all evaluated as calendar days in `America/Bogota` (`packages/backend-core/src/database/calendar.ts`). The zone has no DST. A device in another timezone must **not** decide what "today" means — ask the server (claim, re-issue and the wallet all answer from the same fragment).

### Discovery is 3 km, fixed, plus followed stores

- The radius is a constant (`COUPON_FEED_RADIUS_METERS = 3000`) shared with the map; it is not a parameter and sending one is a `400`.
- Followed stores are always in the feed, at any distance, carrying `followed: true` for the "Siguiendo" badge — that flag is the badge's only source.
- There is deliberately **no** followed-only feed endpoint. One feed, one screen.
- A followed store with no coordinates appears with `distanceMeters: null` / `distanceKm: null`. Render "sin distancia", not "0 km", and expect it at the end of the list.

### The QR token is a secret the app holds

- Returned **only** by `POST …/claims` (201) and `POST …/claims/:id/qr` (200). Everywhere else `qrToken` is `null`.
- The server stores only its SHA-256 hash, so it cannot be recovered — if the app loses it, the only path is a re-issue, which kills the old one.
- 43 printable base64url characters (32 random bytes). Store it in the OS secure store; never log it, never put it in a URL, never send it to analytics, and clear it when the claim becomes `redeemed`, `expired` or `released`.

### Image URLs expire — never persist them

`coupon.imageUrl` is a **presigned GET** URL (`X-Amz-Expires=3600` by default, `GARAGE_READ_URL_TTL_SECONDS`). Captured shape:

```text
http://localhost:3900/savanhi-dev/coupons/<storeId>/<uuid>.jpg
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=…&X-Amz-Date=20261104T141109Z
  &X-Amz-Expires=3600&X-Amz-Signature=<redacted>&X-Amz-SignedHeaders=host&x-id=GetObject
```

Consequences: a cached response older than the TTL has dead image URLs; cache the **bytes** (an image cache keyed by the path, not the query string), never the URL itself; and `imageUrl` differs between two responses for the same coupon — never use it as an identity or a cache key. When a deployment sets `GARAGE_PUBLIC_BASE_URL`, the URL is plain and stable instead; do not rely on either form.

### No pagination today

The feed and the wallet return everything. Nothing breaks with 20 items; plan for the day a dense neighbourhood returns hundreds, and do not build a UI that assumes a page size exists.

### Everything is role-scoped server-side

A customer can only ever read their own claims (another customer's claim id answers `403`, and it never appears in their wallet — verified). Do not add client-side filtering as a security measure; do not assume an id obtained elsewhere is reachable.

---

## Run it locally

```bash
# 1. PostgreSQL 16 + Garage (object storage), both with healthchecks
cp .env.example .env
docker compose up -d
./scripts/garage-bootstrap.sh          # once per fresh garage volume

# 2. schema and seed data (roles, catalog categories and products)
pnpm --filter @repo/backend-core db:migrate
pnpm --filter @repo/backend-core db:seed

# 3. the backend (port 4300 by default)
pnpm --filter tenderos-backend dev
curl -s http://localhost:4300/health
# {"service":"tenderos-backend","status":"ok","timestamp":"2026-11-04T14:06:48.034Z"}
```

### Signing in without an email provider

Set `OTP_PROVIDER=development` (the default) and, optionally, `OTP_DEV_CODE=123456` for a deterministic code. The development provider never logs the code, so a fixed `OTP_DEV_CODE` is the practical way to sign in locally. `OTP_DEV_CODE` is ignored when `NODE_ENV=production`.

### Making a `client` user

Through the API, with the role the customer app asks for (C1):

```bash
curl -s -X POST "$API/auth/otp/request" -H 'content-type: application/json' \
  -d '{"email":"camila.cliente@example.test"}'

curl -s -X POST "$API/auth/otp/verify" -H 'content-type: application/json' \
  -d '{"email":"camila.cliente@example.test","challengeId":"<id>","token":"123456","registrationRole":"client"}'
# {"user":{… "role":"client","registrationStatus":"profile_required"}, …}

curl -s -X PATCH "$API/auth/me" -H "authorization: Bearer <access-token>" \
  -H 'content-type: application/json' -d '{"fullName":"Camila Vega"}'
# {"user":{… "registrationStatus":"completed"}}
```

The role is read from the database on every request. Flipping `users.role_id` by hand still works and is what the older backend suites do for their fixtures, but it is no longer the only way in.

### A physical phone needs the LAN IP

`localhost` on a phone is the phone. Point the app at the machine's LAN address:

- **Expo dev client**: leave `EXPO_PUBLIC_TENDEROS_API_URL` unset and the app derives `http://<expo-host>:4300` from Expo's LAN host automatically (`src/features/auth/infrastructure/api-base-url.ts`).
- **Anything else**: set `EXPO_PUBLIC_TENDEROS_API_URL=http://192.168.x.y:4300` (find it with `ip addr` / `ipconfig getifaddr en0`). It must be an absolute URL with no query or fragment, and **HTTPS is mandatory in release builds**.
- Add that origin to `CORS_ORIGINS` only for a browser client; a native app sends no `Origin` and is always allowed.
- Both devices must be on the same network, and the host firewall must allow port 4300.

---

## Where the code lives

| What | File |
| --- | --- |
| Customer routes | `apps/Tenderos/backend/src/routes/index.ts` (from the "Customer routes (S2)" comment) |
| Auth routes | `packages/backend-core/src/auth/router.ts` |
| Auth logic, OTP, sessions | `packages/backend-core/src/auth/service.ts` |
| Contracts and response types | `packages/api-contracts/src/coupons.ts`, `packages/api-contracts/src/auth.ts` |
| Claims, feed, QR tokens | `packages/backend-core/src/database/repositories/coupons.repository.ts`, `src/coupons/qr-token.ts` |
| Nearby, followed, follow/unfollow | `packages/backend-core/src/database/repositories/stores.repository.ts` |
| Calendar zone | `packages/backend-core/src/database/calendar.ts` |
| Error envelope and status mapping | `packages/backend-core/src/errors.ts` |
| Presigned image URLs | `packages/backend-core/src/storage/object-storage.ts` |
| Product decisions and history | `odd/tasks/cuponera-mvp.md` (specs S2–S11, log L6/L7/L10/L11) |
| Customer app decisions (C1–C5) | `odd/tasks/clientes-app.md` |
| Registration role | `packages/api-contracts/src/auth.ts` (`REGISTRATION_ROLES`), `backend-core/src/auth/schemas.ts`, `auth/service.ts` |
| Customer registration status | `packages/backend-core/src/database/repositories/users.repository.ts` |
| Release and the name gate | `packages/backend-core/src/database/repositories/coupons.repository.ts`, migration `drizzle/0009_special_marvel_apes.sql` |

---

## Checklist before shipping a customer screen

- [ ] Every request sends `Authorization: Bearer <accessToken>` and nothing else is in the query string.
- [ ] A `401` triggers **one** serialized refresh; a failed refresh signs the user out.
- [ ] No UUID and no clock time is rendered anywhere on the screen.
- [ ] Dates go through the shared date-only formatter; no `Date` is built from a stored `YYYY-MM-DD`.
- [ ] `qrToken` is written to the OS secure store, never logged, never in a URL.
- [ ] Image URLs are used immediately and never persisted; bytes are cached by object path.
- [ ] `claimed: true` hides the claim action; `followed: true` shows the "Siguiendo" badge.
- [ ] A followed store with `distanceKm: null` renders without a distance — including **every** item of a feed read without coordinates.
- [ ] `status` is re-read on focus — `expired` and `released` are derived from stored state, not cached.
- [ ] Every `409` message has its own Spanish wording in the UI (there are eleven distinct ones now).
- [ ] Every verify sends `registrationRole: "client"`, and a `user.role` that is not `client` is handled as a dead end, not retried.
- [ ] The claim action is gated on `registrationStatus === "completed"`, so the name `409` never reaches a screen.
- [ ] Releasing asks for confirmation and clears that claim's stored `qrToken`.
