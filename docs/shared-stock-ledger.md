# D1 · Shared stock ledger

Local implementation on the catalog A/B dependency. Not published, migrated remotely, or deployed by this increment.

## Invariants

- `stock_items` and `stock_movements` remain the only inventory and movement tables. `current`, `min`, movement `qty`, invoice `qty_numeric` and purchase `qty` support six decimal places.
- Every new balance change is an append-only movement. `qty` is the signed delta in the ingredient's base unit. `input_quantity`/`input_unit` preserve the submitted quantity, and `balance_before`/`balance_after` are computed under the stock-row lock.
- `in` adds, `out` and `waste` subtract, `set` records the delta to an explicit physical count. Counts can be zero or unchanged; other quantities must be positive. Negative stock is rejected.
- A nonempty reason of 1–1000 characters is required. Actor/profile activity, membership, existing `stock.adjust` role, business and branch assignment are checked in SQL, including service-role transports. Service role is never the human actor.
- Conversion reuses `catalog_unit_factor`: kg↔g, l↔ml and documented unit aliases only. No packages, slices, portions or density are inferred. Unsupported units and precision finer than six base decimals fail visibly.
- Old balances and movements are not replayed or reconciled. New metadata is nullable on old rows; history labels missing source/balance/unit information honestly. Corrections append a new event against the current balance.

## Service contract for later purchases/sales

`record_stock_movement_atomic(p_business_id, p_actor_id, p_ingredient_id, p_branch_id, p_operation, p_quantity, p_reason, p_unit = null, p_source = 'manual', p_ref_type = null, p_ref_id = null)`

Returns one row: `stock_item_id`, `new_current`, `delta`.

SQL `SECURITY INVOKER`, as are the manual/WhatsApp/approval wrappers. Its only stock write is inserting a movement. The validation trigger locks the stock row, validates and derives metadata; the private derived-state trigger updates the balance and audit in the same transaction. Any error rolls everything back.

- Manual UI calls `adjust_stock_manual(ingredient, branch, operation, quantity, reason, unit?)` with the authenticated session. Actor is `auth.uid()`, business is the ingredient's business, source is `manual`.
- WhatsApp calls server-only `adjust_stock_for_agent(business, actor, ingredient, branch, operation, quantity, reason, unit?)`. The same boundary rechecks active profile/role/branch. Source is `whatsapp`; original validated request text is retained as reason and an explicit unit is required at the WhatsApp validation/clarification boundary. Its unit is preserved. No currency/thousands scaling is applied to stock decimals.
- Invoice approval calls existing server-only `approve_invoice_atomic(invoice, business, actor)`. It locks the invoice and existing lines, requires an explicit branch, writes each purchase line, then calls the service once per matched line using source `ocr`, reference `purchase_item` and that line's ID. Multiple lines for the same ingredient stay separate. A unique reference prevents replay. Cost recalculation, invoice state, logs and notification are in the same transaction. Repeat approvals return the existing purchase, including legacy approvals, without replaying stock.
- Inbox calls `approve_stock_extraction_atomic(extraction, business)` with the authenticated session. Required persisted fields are `ingredient_id` or one exact unambiguous ingredient name, numeric `qty`, compatible `unit`, explicit `operation`, and `reason_note`. Business and branch must agree with the source message. Incomplete/ambiguous legacy fields become `needs_review`; no default quantity, fuzzy first match, main-branch fallback or guessed movement direction is used. The source is `inbox` and the reference is `ai_extraction`; source approval state, movement, balance and audit are inseparable and repeat-safe. The old `reason` enum alone is not a detailed reason. The heuristic now marks explicit “quedan” counts as `set` and preserves their text.
- New manual purchase transactions should persist their line first, then invoke the service with `purchase_item`; the line's ingredient, business, branch, quantity and unit must match. This reference is currently server-transport-only. Do not update `current` separately.
- Sales integration should extend the validated reference contract for its real line entity and deduplication, then call this same service within its sale transaction. Arbitrary `sale` references are intentionally rejected until that entity contract exists. Do not create a second balance updater.
- After invoker actor/business/branch authorization, a private lock-only trigger takes ingredient SHARE before validation reads the base unit. It blocks concurrent unit edits, including the first-stock race, without granting ingredient UPDATE rights to operational stock roles. Inbox source locks precede ingredient locks in both RPC and direct-INSERT paths. Invoice approval locks its ingredient rows in deterministic order before any stock row, matching catalog-save lock order. Future purchase/sale transactions that will update ingredient costs must also lock all affected ingredient rows in sorted order before calling the ledger.
- The service represents one movement per call. For batches use individual calls in one transaction, as invoice approval does; don't rely on multi-row direct INSERTs to the same stock item.

Old four-argument manual and actorless WhatsApp overloads are removed so stale clients fail visibly rather than double-updating stock or inventing a reason/actor. Deploy this migration together with its callers.

## Data API boundary and privileged trigger justification

- Existing RLS branch and write-role policies are retained. Restrictive active-profile policies additionally govern authenticated access to both stock tables.
- `INSERT`, `UPDATE`, `DELETE` table grants on `stock_items` are revoked from anon/authenticated/service_role. The latter two retain only column INSERT for identity/minimum/timestamps and UPDATE for minimum/timestamp. They cannot set `current` on INSERT or UPDATE or delete/recreate a balance. Zero-balance setup and catalog minimum changes continue to work.
- Movement UPDATE/DELETE/TRUNCATE grants are revoked and mutation triggers reject historical edits/deletes. Corrections are new records. Parent cascades cannot erase stock history silently.
- Direct authenticated movement INSERT is allowed only under existing role/tenant/branch RLS and the same validation trigger. It cannot spoof actor, role, balances, delta, base unit or arbitrary references. Source is manual except an exact validated Inbox reference, which also approves its source via an AFTER INSERT invoker trigger under extraction RLS. Conflict-skipped inserts cannot approve a source. Repeat approval validates the exact movement source/reference/business; inconsistent legacy targets return an explicit error without replay.
- `stock_private.apply_movement()` is the derived-state privileged function. It is a trigger-only `SECURITY DEFINER` function in an unexposed private schema, `search_path=''`, with EXECUTE revoked from PUBLIC/anon/authenticated/service_role. It has no arguments or public endpoint. It writes only the validated movement's derived stock balance using a before-balance compare and its audit record. It does not authorize operations or broaden actor permissions; those are enforced by invoker code/RLS first. The second private function, `stock_private.lock_movement_ingredient()`, is trigger-only with identical schema/search-path/EXECUTE restrictions and only locks the already-authorized ingredient row. It changes no fields, exposes no values and does not replace invoker permission checks. Operational roles cannot acquire a row lock on ingredients through an ordinary invoker SELECT under existing ingredient UPDATE RLS, so this lock-only exception preserves that RLS while preventing a concurrent unit edit from reinterpreting new stock. The trigger order is invoker authorization → private ingredient lock → invoker quantity/reference validation → derived balance/audit → invoker source completion. This narrowly privileged sink is needed because callers cannot independently update balances or insert audit rows. Failure is transactional.
- Database owners retain administrative privileges, as in PostgreSQL generally; application/Data API roles do not. Tests that seed deliberately inconsistent legacy rows use owner-only trigger disabling strictly inside the local rolled-back fixture transaction. No deployment step does this.

## UX and uncertainty

Stock has a working “Nuevo movimiento” CTA, entry/exit/waste/correction, mandatory reason, branch and compatible unit selection. Current stock and real movement history are loaded from DB with no mock fallback. History has tenant/branch/ingredient filters, stable ordering and 25-row pagination beyond 5000 records. Legacy events disclose unverified impact.

Repeated submit is locked during the request. Missing/malformed successful RPC responses and transport interruptions are treated as uncertain, never a made-up zero or success; the form blocks resend and refreshes history. A cache refresh failure after confirmed persistence does not claim rollback. There is no automatic retry of a stock mutation.

## Verification and limitations

- `npm run test:db:stock`: isolated PGlite 0.5.8, all repository migrations, rolled-back fixtures. Covers tenant/branch/role/inactive restrictions, manual and Data API movement paths, grant boundaries, units/precision/NaN/infinity/reasons/insufficient stock, history preservation, WhatsApp context, invoice lines/repeat approval and rollback including costs, and Inbox typed inputs/repeat approval/source state/rollback.
- `npm run test:db:catalog`: existing catalog integration regression.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`: required final checks; final results supplied with the handoff.
- PGlite is a single-session PostgreSQL engine, not multi-session concurrency verification or a full PostgREST/Supabase emulator. `FOR UPDATE` and unique constraints are present; real concurrent-session testing is still required before production release.
- No browser QA claimed: the current environment blocks Chromium socket launch. No production data were changed, no remote migration applied and no preview/deployment/public repository publication performed.

### Recorded local verification · 2026-10-09

- `npm test`: 224/224 passed (31 new stock action/transport cases in addition to existing tests).
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; `/stock` and `/inbox` compiled.
- `npm run test:db:stock`: passed, 54 real migrations applied only to isolated in-memory PGlite, test fixtures rolled back.
- `npm run test:db:catalog`: passed, same 54 local migrations.
- `git diff --check`: passed.
- Independent read-only review: no concrete blockers remaining after fixes for conflict-skipped Inbox source state, inconsistent idempotent references, optional-unit clarification, competing replies to one stock clarification, uncertain/malformed transport replies and unit/stock lock ordering. Reviewer reran SQL ledger and all 13 transport tests.

No multisesion database test, browser verification, deployment, remote database migration or remote publication is represented by these passes.
