# Tenderos persistent catalog and stock

Objective: complete the next Tenderos roadmap module with store-scoped persistent inventory while preserving the shared business catalog and existing order-compatible custom-product model.
Branch: `feat/tenderos-persistent-inventory` (the older `feat/tenderos-catalog-stock` branch is already merged into `main`); delivery strategy `ask-on-risk`; chosen chain strategy `feature-branch-chain` (current forecast ~1,300 authored changed lines, generated files excluded). Runner: `pnpm --filter @repo/backend-core test:catalog`, backend/mobile type checks, and focused mobile tests.

## Specs

### S1 — Shared catalog and store-owned product paths

- Keep the business-provided global catalog available for tenderos to select into a store.
- Preserve the existing store-owned custom-product model; tenderos may create products missing from the shared catalog, and each custom product is private to its store.
- The selected store's price, stock, and sale unit belong to that store's inventory entry, not the global catalog product.
- User wording: “la idea es yo darles un catalogo de productos. El tendero al ser mayor se le facilita esta mobilidad de agregar producto, no puedo dejarko fuera es estrategia mia”; “si tambien puede crearlo”; “solo para su tienda”; “si obviamente disponible para pedidos”.
- The customer-facing order API is explicitly deferred to a future module. This module does not add customer checkout, payment, or order-creation endpoints. Preserve stable product and store-assignment identities so the future order module can order either source without replacing historical product references.

### S2 — Store selection and ownership

- Tenderos may have multiple stores and can select which store's inventory they are managing.
- Every read or mutation remains scoped to a store owned by the authenticated tendero; selecting another store must not expose or mutate its products or categories.
- User wording: “si” (confirming that a tendero can manage more than one store).

### S3 — Product price and initial stock

- A store inventory entry cannot be added or saved without a price greater than zero. Prices are USD with at most two decimal places. Ordinary catalog products cannot have a zero price; free items are deferred to the later promotions/combos module.
- Preserve existing inventory records with `null` or zero prices; flag them as “price pending” and require a positive price before activation. Do not invent prices or delete these records.
- New store inventory entries start with stock `1`; changing a product's unit does not silently convert its stock.
- User wording: “debe ser obligatorio esto evita que el tendero olvide actualizar despues”; “si siemopre mayor a 0 producto del catalogo de la tienda, para productos gratuitos deberiamos crear un modulo llamado promociones o combos mirale el mejor nombre y ahi podra incluir produtos en 0”; “en 1”.

### S4 — Sale unit, stock precision, and package content

- Each store inventory entry requires one sale/inventory unit from `unidad`, `kg`, `g`, `L`, or `ml`.
- `unidad` accepts nonnegative integer stock only. Weight/volume units accept whole or fractional values up to three decimal places; the tendero may configure an item as integer-only. A fractional-capable item also accepts whole quantities.
- Catalog package/net-content metadata is informational and separate from sale/inventory units. For example, a sealed 500 ml bottle is sold/counts as a unit; loose goods may be sold by kg, g, L, or ml. Do not convert package content into inventory or order quantity automatically.
- User wording: “si fraccionarias para ciertos casos”; “sipi”; “si los mas populares en el mercado”; “si”; “es que 500 ml es informacion mas no una unidad de venta, no voy a pedir un 800 ml de agua, no?4”.

### S5 — Categories

- A custom product may use a shared category, a category created by that tendero for their store, or no category at creation.
- New tendero-created categories are private to that store. An uncategorized product is shown as `Sin categoría` and can be assigned a category later.
- User wording: “si al tendero le sirve una categoria comun selecciona o sino podra crear una tambien crees que sea prudente que pueda crear sin categoria un producto?”; “claro despues puede asi que si adoptemos esa regla”; “si”.

### S6 — Deactivation and reactivation

- Removing a store inventory entry deactivates it rather than deleting its history. Existing active/inactive controls remain available; a store cannot create a duplicate assignment for the same global catalog product.
- User wording: “si” (confirming deactivation rather than deletion).

### S7 — Persistence and user-facing states

- Catalog and store inventory are loaded from the backend and remain available after app restart. The mobile experience provides loading, empty, error, and retry states.
- Keep global catalog entries distinct from store inventory; demo/reference data must not be presented as the store's operational stock.
- Roadmap acceptance wording: “Un producto creado o editado sigue disponible después de reiniciar la app y solo puede asignarse a una tienda del tendero.”

### S8 — Future order rules (recorded, not implemented in this module)

- Both shared-catalog assignments and store-private products are intended to be orderable. Customer-facing order API and checkout remain deferred, per user instruction.
- Future order behavior: reserve stock when an order is created; restore it when the customer cancels or the tendero rejects; represent `rejected` separately from `cancelled`; customers may cancel only before tendero acceptance and tenderos may reject only pending orders.
- Future order quantities follow S4, including the tendero's integer-only setting.
- User wording: “Al crear el pedido”; “si como quien dice algo tipo optimista”; “fraccionarias tambien o enteras, solo enteras cuando el tendero habilite ese modo o tambien permite solo fraccionarias, o ambos”; “si”; “si”; “dejarla para un módulo futuro”.
- No order reservation, restoration, checkout endpoint, payment, or customer-facing API behavior is implemented in this catalog module.

### S9 — Mobile/API integration boundary

- Keep the existing global-catalog and store-assignment routes. Adding a global item requires `productId`, a positive USD `price`, and `saleUnit` plus `integerOnly`; the server initializes stock to `1`.
- Keep the legacy `/api/v1/tenderos/products` path for store-private products. Add an owner-checked store-scoped list/create path, `/api/v1/tenderos/stores/:storeId/products`, so the mobile screen loads or creates only the selected store's custom products.
- Expose shared and store-private categories through `GET /api/v1/tenderos/stores/:storeId/product-categories`; create a store-private category through `POST` to that path with `{ name }`. The mobile uses the returned category ID or leaves it unset.
- Product updates/deactivation continue through the existing ID-scoped mutation endpoints, with authorization checked against the authenticated tendero's stores. Both global assignments and custom products must remain distinguishable in the mobile view so edits target the correct source.

## Tasks

- T1 — S1–S7, S9 — delegated direct, parallel backend unit; implementation and listed checks complete; commit pending.
- T2 — S1–S7, S9 — delegated direct, parallel mobile unit; implementation and listed checks complete; commit pending.
- T3 — S1–S8 — independent high-risk verification after T1/T2; bounded verification complete with database-backed proof limitations and one category-label advisory; native review pending; no commit expected.

## Log

- L1 — User request verbatim: “Hola necesito que veas cual es el siguiente modulo a cosntruir, el roadmap de desarrollo esta en: /home/stev/Savanhi-Docs/07 — Técnico/Roadmap de desarrollo por actor.md

revisa el codigo actual y el calnce del siguiente modulo, y las preguntas de logica de negocio me encargo yo totalmente asi que me pregunyas nomas

- usa subagentes para todo, tu no escrivas codigo para todo usbagentes hasta acabar el nuevo modulo”
- L2 — 2026-10-09: Roadmap and code review identify canonical catalog plus persistent Tenderos stock as the next module. Business rules above were clarified directly with the user. The worktree already contains unrelated modifications/deletions; preserve them. Existing customer-order API source is absent, so order endpoints and checkout remain explicitly deferred.
- L3 — Current technical findings: catalog assignments and legacy store-owned products are separate models; the order repository references legacy products only. Both models need unit-aware stock support for the confirmed inventory behavior. Preserve existing order records and do not make customer order APIs part of this feature.
- L4 — A local `feat/tenderos-catalog-stock` branch already exists and is an ancestor of `main`; implementation is on the new `feat/tenderos-persistent-inventory` branch. Next: implement T1/T2 through bounded delegated writers on disjoint edit surfaces, run focused checks, then independent high-risk verification. Before first commit, ask the user for the chain strategy because the forecast exceeds the ~400-line delivery budget.
- L5 — 2026-10-09: User clarified: “ya que quedamos que productos de catalogo/inventario seran siempre mayor a 0, productos a futuro en un modulo de ofertas-combos-otro podran estar en 0 pero aqui no entra” and “antes de implemntar todo, quiero hacerlo en otra sesion asi que cuando ya sea hora de la inmplemetacion quiero que me des el prompt para una nueva sesion”. No implementation is authorized in this session. Before any migration, ask how to handle existing store products with null/zero prices without inventing values or deleting data.
- L6 — 2026-10-09: User approved preserving existing null/zero-price inventory records, marking them “price pending,” and requiring a positive price before activation; never invent prices or delete records. Implementation is now authorized.
- L7 — 2026-10-09: T1 and T2 were implemented by delegated workers on disjoint surfaces. After scoped Prettier normalization, backend catalog contract tests passed 7/7, backend-core and API-contract type checks passed, mobile focused tests passed 3/3, and mobile type checks passed. Drizzle generated migration `0006_superb_silvermane.sql`. Independent scratch-copy verification reproduced no blockers; it reports that private-product category labels are omitted and database-backed ownership/persistence/rejected-write invariants were not exercised. Native RDD remains on and risk assesses high (initial assessment was unassessable because untracked files need canonical inventory). The current authored diff forecast is ~1,300 lines excluding generated files. Existing unrelated worktree changes remain untouched.
- L8 — 2026-10-09: User chose `feature-branch-chain` for the over-budget implementation. Keep the work on the current feature branch and divide it into cohesive reviewable work units; do not create remote branches or PRs without explicit remote-operation authorization.
- L9 — 2026-10-09: One slicing pass estimates 1,292 authored changed lines excluding generated files. The mobile view, card, and complete associated test form one cohesive 501-line slice; splitting it would separate integrated behavior from its tests. The user explicitly approved `size:exception` for the 101-line overage.
- L10 — 2026-10-09: Proposed behavior slices are shared catalog/schema/contracts/mapping and its tests; private-product persistence/category behavior and its tests; then store-scoped API integration; then the mobile view/card and its complete tests. Stage exact behavior hunks, keep each non-exempt PR slice within 400 changed lines, verify each staged count before committing, and perform no remote operations without separate authorization.
