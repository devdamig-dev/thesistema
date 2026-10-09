# Debt plan transport contract

Local implementation only. No WhatsApp/Meta calls, production migration, deployment or publication is part of this work.

## One financial model

`lib/debts/plans.ts` generates every schedule. Amounts are integer cents; UI request parsers in `app/deudas/plan-contract.ts` validate the same create/payment/edit/void request boundaries. Transports never calculate interest or silently spread a selected-installment payment to another installment.

WhatsApp capabilities:
- `debts.createPlan`: single obligation or installment plan, with complete schedule preview before confirmation
- `debts.getPlan`: uniquely selected debt, verified full ledger, balance and installment state
- `debts.listDue`: bounded explicit period, tenant/branch-scoped commitments; separate currencies
- `debts.registerPlanPayment`: explicit amount, paid date, method and selected installment or `oldest_due` rule
- `debts.voidPlanPayment`: identified payment and explicit reason
- `debts.editPlan`: notes or one installment's date/notes only
- `debts.create`: safe compatibility alias. Legacy `amount` only becomes original cents; missing currency, origin date, financing and other required facts trigger clarification. It cannot insert a legacy debt.
- `debts.registerPayment`: recognized but blocked. Historical payments require review in the controlled manual Deudas UI; this old command cannot guarantee a currency-pinned destination and safe retries. Planned debts use the explicit plan command, including plans at version zero.

Preparation reads and resolves the branch, debt and installment uniquely before showing the confirmation. It pins the debt version and server-generated operation UUID. Every plan write traverses the confirmation gate, including tools categorized WRITE. The service derives actor/business/branch scope from existing authorized identity and conversation checks. Meta transport, signature checks and enrollment are unchanged.

## Persistence and uncertain outcomes

Create/payment/void/edit delegate to the existing audited RPCs. WhatsApp passes the verified actor as `p_actor_id` only through its existing service-role adapter. RPCs revalidate the actor and financial scope. Actor, origin and tenant cannot be injected into tool arguments.

Pending replacement is atomic through a service-role-only, security-invoker RPC and a same-scope advisory lock. A trigger prevents a second active row even from older raw-insert code. Historical duplicates are preserved and fail closed on lookup. Malformed pending reads/consume results cannot authorize execution. A pending uncertain outcome cannot be replaced by a different operation or changed payload.

A lost plan RPC response retains the exact payload and operation UUID. A new confirmation safely retries that same operation. Cancellation stops retries and explicitly does not claim a possible original commit was undone. Unresolved expired retries cannot silently authorize a fresh write. Historical WhatsApp payments are disabled; no old atomic-payment RPC remains reachable through that command.

## Inbox

This path approves existing typed Inbox proposals. The current production webhook does not generate ai_extractions for this flow; no live WhatsApp-to-Inbox extraction pipeline or model call is claimed.

Complete proposals use exactly one of:
- `fields.planRequest`: the manual `CreatePlanRequest` data excluding requestId/scheduleConfirmed; an explicit branch or the verified source-message branch is required
- `fields.paymentRequest`: the manual `PaymentPlanRequest` data excluding requestId

The extraction ID supplies the operation UUID. Partial or legacy extractor fields remain `needs_review`; they never fall back to a single simplified debt or multiple disconnected debts. The current extractor prompt supports the complete proposal shapes but must omit unknown facts. It cannot set confirmation, actor or tenant metadata.

Inbox first requests a read-only server preview. The UI displays the complete generated schedule or exact payment/imputation and then asks for a second confirmation. A SHA-256 digest binds the snapshot to the authenticated actor, tenant and complete RPC payload. Changed data/session requires a new review. An uncertain response retains the same review and extraction UUID for retry. Debt-domain permissions are checked in addition to `inbox.approve`.

`approve_debt_extraction_atomic` locks the extraction and source message, checks the exact reviewed fields and canonical financial payload, delegates to the same debt RPCs, and commits the ledger plus approved status/actor/target together. There is no separate status write after the financial commit. Terminal debt proposals are immutable; editing, rejection and requests for more information use open-state and fields compare-and-swap predicates.

## Deliberate limits

- Natural language support is progressive and conservative. Missing year, currency, financing, payment amount/date/method or allocation is requested, never guessed. Names resolving to multiple debts require an exact debt ID.
- Financial schedule amendments, cancellation of the whole debt and interest recalculation are not exposed. Only already-supported note/date edits and payment voids exist.
- WhatsApp sends a complete creation preview only when it fits in one safe message. Larger schedules must be confirmed in the Deudas UI. Read summaries explicitly disclose truncation and never combine currencies.
- Portfolio reads currently cap at 100 debts, fail closed if exceeded, and request narrower filtering. Per-debt ledger rows are paginated and validated with the shared mapper.
- Inbox payment proposals currently require an exact debt ID, expectedVersion and explicit installment ID where applicable. Automatic contextual resolution of partial extraction fields is a later increment; incomplete proposals stay in review.
- Browser-interaction QA is not claimed. The real Inbox component bundles with inert fixtures, but local Chromium is blocked by the execution environment's socket restriction. `tests/inbox-debt-ui.browser.mjs` provides the isolated interaction harness.

## Regression checks

`tests/debt-transport-parity.test.ts` covers UI/RPC payload parity, single/installment creation, version-zero plans, selected/global payment, unknown/missing fields, tenant/branch/role guards, ambiguity, cross-debt installments, confirmation races, idempotency after lost responses, cancellation of uncertain operations, legacy alias safety, disabled historical-payment bypass, malformed RPC response recovery, clarification acknowledgements, invalid optional-field corrections, relative read periods and Inbox reviewed-snapshot rules. Existing conversation/Meta security tests remain in the aggregate suite. `supabase/tests/whatsapp-pending.sql` exercises the real migration, server-only permissions, single active scope, raw-insert protection and unchanged uncertain recovery. `scripts/verify-whatsapp-pending-concurrency.mjs` supplies the true multi-session check for the disposable native PostgreSQL runner; PGlite alone is not a concurrency pass.
