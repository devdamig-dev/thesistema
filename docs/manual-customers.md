# Manual customer directory (E1)

## Scope

- Existing `public.customers`, extended only with `active` and `notes`.
- Create, edit, archive and restore from `/clientes`, including name, phone, email, contact channel and notes.
- Directory remains business-wide, matching the existing model and RLS. It does not acquire a fabricated branch relation. The UI explains this scope.
- Roles: `customers.manage` remains owner/admin/manager/marketing. View-only users cannot see mutation controls and cannot call the actions or SQL RPC successfully.
- No physical deletion through the directory. A database guard rejects customer deletion while its business exists. Existing business-level cascades remain available to trusted system operations.
- No customer-to-sale relation exists in the current migrations. The directory therefore shows no transactional history, visit counts, spend, inferred recency, or average ticket. Legacy aggregate columns remain untouched. A future sales increment must introduce a real relationship before showing that history.
- Demo fixtures and transient demo edits are explicitly labeled and isolated from database mode. Demo saves do not call the server mutation.

## Integrity and provenance

`saveCustomerAction` validates unknown payloads before accessing Supabase and derives tenant/user context server-side. Only eight expected fields are accepted; clients cannot provide business, actor, role, branch, source, or historical aggregates.

The shared `lib/customers/service.ts` calls `save_customer_atomic`, a SECURITY INVOKER RPC. It independently rechecks current membership, active profile, permitted role, exact payload fields/types, and row tenant. The existing RLS policies are unchanged. Updates lock the row and compare `expectedUpdatedAt`; stale edits and archive attempts fail without mutation. A trigger provides a monotonic `greatest(clock_timestamp(), old.updated_at + interval '1 microsecond')` token and guards direct API writes, immutable customer identity/tenant, contact bounds, and archive-only lifecycle.

Every successful insert/update has a same-transaction `activity_logs` entry. The privileged sink is a trigger-only function in the revoked, non-exposed `customers_private` schema; no public definer write RPC is introduced. Actor and role come from `auth.uid()` and current membership. Manual RPCs record `manual`; direct authenticated writes record `api`; unauthenticated trusted system writes record `system`. The RPC resets its transaction-local source marker. Records include business, null branch (business-wide entity), action, result, timestamps and before/after snapshots. Audit failures roll back the mutation. `activity_logs` remains read-only to authenticated callers.

Transport failures report uncertain persistence and tell the user to reload before retrying. The interface disables repeated submission, supports cancel/close/Escape, keeps validation errors visible, and provides reload/search/status filters. Read failures never fall back to fixtures. Explicit 500-row ranges with an exact server count avoid Supabase’s default 1000-row response cap. Lists over 2000 rows disclose truncation and scope their displayed counts/search accordingly.

## Migration and checks

Migration created using Supabase CLI 2.120 via `supabase migration new manual_customers`:

`supabase/migrations/20261009003455_manual_customers.sql`

No production database, credentials, remote mutation, publish, or deploy is needed for the offline suite:

- `npm test`: validation, permission matrix, server-derived tenant/actor boundary, read guards, domain error semantics and regressions.
- `npm run test:customers:sql`: pinned PGlite 0.5.8, in-memory PostgreSQL, all 53 real repository migrations, Supabase auth/storage scaffold, transactional fixtures rolled back. Exercises CRUD, archive/restore, optimistic conflicts, spoofing/type/length errors, direct API writes, tenant isolation including dual membership, branch-restricted marketing's existing business-wide scope, inactive/denied roles, immutable tenant, inaccessible audit sink, and rollback when the audit sink fails.
- `npm run typecheck`
- `npm run lint`
- `npm run build`

The SQL runner is an isolated PostgreSQL regression harness, not a full Supabase emulator or a multi-session concurrency proof. Supabase advisors and target-environment migration apply remain deployment checks.

## Browser QA checklist

Browser execution was attempted in the assigned environment but Chromium cannot open its required socket (`Operation not permitted`). No browser pass is claimed. Run the following in a browser-enabled preview after deployment authorization:

1. Owner: create a customer using ordinary contacts and optional multiline notes. Refresh and verify persistence and a single audit entry with actual actor/source.
2. Edit and save, then archive with confirmation. Verify the active filter hides the row; archived/all filters retain its contacts. Restore it and confirm audit actions.
3. Open the same customer in two tabs, save one, then save/archive the stale copy. Verify conflict message and no overwritten data.
4. Double-click submit; confirm a single creation. Cancel, close, Escape, reopen, and navigate Back/Forward; confirm no stranded overlay or accidental submission.
5. Viewer: verify read-only controls and rejected forged action/RPC. Marketing with one assigned branch should see the existing business-wide directory but no unrelated transaction data. A foreign tenant must remain invisible.
6. Simulate offline/failed read and failed save. Verify no fixtures appear in database mode, no false success, and the instruction to reload before retrying an uncertain save.
7. At mobile width, inspect the form, table overflow, keyboard focus and dialog; verify labeled fields remain usable. Confirm screenshots before calling browser QA complete.

Publication, migration application, Vercel preview, merge and production verification were not performed by this increment.

Una respuesta de transporte incierta bloquea nuevos envíos del formulario hasta
cerrarlo y recargar el catálogo. No se infiere rollback de un error HTTP ni se
reintenta el alta automáticamente. Esto no es deduplicación entre altas distintas.
