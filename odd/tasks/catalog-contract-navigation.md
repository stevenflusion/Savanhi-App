# Feature: Canonical catalog contract and Tenderos navigation

## Objective

Close the next Tenderos roadmap gap by making the catalog contract executable and shared, then replace the current tab bar with a rounded icon navigation bar whose central `+` opens product creation.

## Problem

The repository already has persistent catalog storage and API integration, but request validation is duplicated inside the Tenderos backend and the legacy product model still obscures which contract is canonical. The mobile navigation also uses Unicode glyphs and three conventional tabs, so adding a product is buried inside the Products workspace.

## Why

The roadmap names the canonical catalog contract as the next task. A shared executable contract prevents the app and API from silently disagreeing about stock, price, identifiers, and activation. The central add action makes the primary catalog operation immediately reachable without presenting demo data as operational functionality.

## Scope

- Export runtime catalog request specs and inferred TypeScript types from `@repo/api-contracts/catalog`.
- Reuse those specs in the Tenderos API instead of local catalog request schemas.
- Add contract tests for valid and invalid stock, price, product ID, and empty updates.
- Keep the legacy order/product migration outside this change, but document that boundary in the contract.
- Build a rounded bottom bar with `Inicio`, `Productos`, central `+`, `Pedidos`, and `Perfil`.
- Use `@expo/vector-icons`; no emojis or Unicode icon substitutes.
- Make the central `+` open the Products screen directly in add-product mode.
- Keep Pedidos honest as unavailable until its roadmap task is implemented.

## Constraints

- Workflow: specs → implementation → verification → completion; failed verification returns to fix → verification.
- ODD only; no SDD artifacts.
- TDD is disabled by explicit user direction.
- Tests verify executable contract specs and domain rules, not frontend rendering or snapshots.
- Only the central `+` omits a visible label. All lateral destinations show an icon and text.
- Do not expose the legacy local sale flow as a primary navigation destination.
- Preserve safe-area handling, keyboard hiding, accessibility labels, and 44 px minimum touch targets.
- Delivery strategy: `ask-on-risk`.
- Forecast: approximately 300 authored changed lines, excluding generated build output.

## Specifications

### Catalog contract

- Product identifiers are UUIDs.
- Catalog prices are nullable or non-negative numbers and use USD.
- Stock is a non-negative integer.
- Adding a store product requires `productId`; `price` is optional and nullable.
- Updating a store product accepts at least one of `price`, `stock`, or `active`; an empty payload is invalid.
- Unknown fields are rejected so clients cannot send silently ignored catalog state.
- The global catalog and store assortment remain the canonical catalog surfaces for Tenderos. Legacy `Product` and order migration are explicitly deferred.

### Bottom navigation

- Visual order: `Inicio`, `Productos`, `+`, `Pedidos`, `Perfil`.
- Lateral items display vector icon and label; selected state has stronger color/weight without changing layout.
- The bar is a floating rounded surface above the safe-area edge.
- The central action is circular, visually elevated, and contains only a vector `+` icon.
- Pressing `+` navigates to Products with an explicit add intent; Products consumes the intent and opens the add-product tool.
- Pedidos routes to a truthful unavailable state and does not claim order operations work.

## Tasks

- [x] **CAT-1 — Executable canonical catalog specs**
  - Route: delegated writer; shared contract, backend route, dependency metadata, and domain tests span multiple non-trivial files.
  - Acceptance: the backend imports shared catalog schemas; focused tests prove stock/price/UUID/update invariants; package type checks pass.
  - Verification: `pnpm --filter @repo/backend-core test -- src/catalog/catalog-contract.test.ts` and relevant type checks.
  - Evidence: shared strict Zod schemas exported from `@repo/api-contracts/catalog` and consumed by Tenderos routes; 3/3 focused contract tests pass; API contracts, backend core, and Tenderos backend type checks pass.
- [ ] **NAV-1 — Product-centered bottom navigation**
  - Route: delegated writer; navigation layout, bar component, route intent, Products workspace, and Pedidos state span multiple files.
  - Acceptance: the five destinations match the specification; icons are vector-based; only `+` has no visible text; `+` opens add-product mode; no frontend tests are added.
  - Verification: mobile TypeScript check plus runtime/static inspection.
  - Evidence: pending.
- [ ] **VER-1 — Integrated verification and correction**
  - Route: delegated verifier independent from implementation.
  - Acceptance: contract tests, relevant builds/type checks, and navigation inspection pass; failures are fixed and re-verified.
  - Evidence: pending.

## Progress

- 2026-09-21: Request authorized and repository explored.
- 2026-09-21: Product decision resolved from the roadmap: navigation uses Inicio, Productos, `+`, Pedidos, Perfil; Pedidos remains explicitly unavailable in this cut.
- 2026-09-21: CAT-1 implemented and verified. The generic backend suite still requires PostgreSQL, so the new `test:catalog` runner isolates the executable contract specs.
- Current phase: CAT-1 complete; NAV-1 implementation pending.

## Next step

Close CAT-1 with a work-unit commit, then delegate NAV-1 implementation.
