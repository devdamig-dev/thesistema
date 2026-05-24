# Notificaciones, Audit Feed y Permisos

## Objetivo

Consolidar la operación multiusuario con trazabilidad real:

- Activity feed real en Dashboard (lee `activity_logs`).
- Triggers de notificaciones cubriendo deudas, stock, IA, operación.
- Página `/notificaciones` completa con filtros, búsqueda y archivo.
- Notification Center mejorado (priority indicator + link a página).
- Wrapper `assertPermission` aplicado en acciones críticas.
- Helpers de branch filtering listos para próximas etapas.
- Invite-accept flow desde `/login`.
- Realtime presence en `/inbox`.

Demo mode intacto · database mode funcional · build verde.

---

## Migración 0008

`supabase/migrations/0008_notifications_audit.sql`:

- Enums `notification_priority` (high | medium | low | info) y
  `notification_category` (operation | ai | stock | debt | invoice |
  employee | marketing | system).
- `notifications` ampliada con `priority`, `category`, `archived_at`.
- Backfill de `priority` desde `tone` existente.
- Índice compuesto para queries de `/notificaciones`.
- **Trigger SQL** `notify_critical_stock` — se dispara cuando un
  `stock_item` cruza por debajo del mínimo y crea una notification
  automáticamente sin necesidad de cron.

---

## Permisos (`lib/permissions/server-action.ts`)

Tres helpers complementarios:

| Helper | Cuándo |
|---|---|
| `withPermission(perm, fn)` | Wrap completo: chequea + ejecuta + inyecta `ctx` en el fn. |
| `requirePermission(perm, fn)` | Wrap minimal sin inyectar ctx. |
| `assertPermission(perm)` | Helper inline retro-compatible — devuelve `null` si OK o `{ ok: false, persisted: false, error }` si no. |

### Server actions ahora protegidas

| Action | Permiso |
|---|---|
| `approveExtractionAction` | `inbox.approve` |
| `rejectExtractionAction` | `inbox.approve` |
| `approveInvoiceAction` | `invoices.approve` |
| `rejectInvoiceAction` | `invoices.approve` |
| `inviteUserAction` | `settings.team` |
| `updateMemberRoleAction` | `settings.team` |
| `revokeInvitationAction` | `settings.team` |
| `setIndustryAction` | `settings.industry` |
| `updateBusinessAction` | `settings.business` |
| `registerDebtAction` | `debts.create` |
| `registerPaymentAction` | `debts.pay` |
| `markDebtAsSettledAction` | `debts.pay` |

En demo mode el rol es `owner` y todos pasan. En database mode con
otro rol, la action devuelve `{ ok: false, error: "forbidden:..." }`
y el toast del client muestra el error.

---

## Activity feed real en Dashboard

`components/common/activity-feed-real.tsx` es server component que:
- Resuelve `getCurrentUserContext()`.
- Llama `listRecentActivity(businessId, limit)` desde
  `lib/data/activity.ts`.
- Mapea cada action key (`inbox.purchase.approved`, `invoice.approved`,
  `debt.payment.registered`, etc) a un label en español.
- Muestra avatar genérico + nombre + acción + módulo + tiempo
  relativo.
- Si no hay logs reales, cae al feed mock del Inbox.

`app/page.tsx` ahora es server wrapper que pasa este feed como
`activitySlot` prop al `DashboardClient` extraído.

---

## Triggers de notificaciones implementados

| Origen | Disparo | Categoría · Prioridad |
|---|---|---|
| Webhook WhatsApp | mensaje recibido (`pending`, `needs_review`, `failed`) | ai · high/medium |
| `approveExtractionAction` | aprobación exitosa | ai · medium |
| `approveInvoiceAction` | factura aprobada · margen baja > 5% | invoice · warn (high) |
| `approveInvoiceAction` | factura aprobada sin alertas | invoice · success (low) |
| `registerDebtAction` | deuda creada | debt · medium |
| `registerPaymentAction` | pago parcial | debt · medium |
| `registerPaymentAction` | trigger SQL marca settled | debt · low |
| `markDebtAsSettledAction` | manual | debt · low |
| `acceptInvitationAction` | nuevo miembro acepta | system · low |
| **Trigger SQL** `notify_critical_stock` | stock_item baja del mínimo | stock · high |
| **Cron** `/api/cron/checks` | deudas vencidas / por vencer (3d) | debt · high/medium |
| **Cron** `/api/cron/checks` | stock crítico / bajo | stock · high/medium |

---

## Endpoint cron de checks

`GET /api/cron/checks` corre los checks para todos los businesses (o
uno específico vía `?business=<uuid>`).

Protección opcional: si `CRON_TOKEN` está seteada, requiere
`Authorization: Bearer <token>`. Sin variable, abierto.

Idempotencia: dedup por business+title+source en una ventana de 24h
para no spamear si se corre cada 15 min.

---

## `/notificaciones` página completa

Layout:
- **Stat strip** (Total · Sin leer · Alta prioridad · Hoy).
- **Filtros**: búsqueda libre + tabs (Todas / Sin leer / Leídas) +
  chips por módulo + chips por prioridad.
- **Lista** con barra lateral coloreada por prioridad, badge de
  módulo, link "Ir al registro", botones acción rápida
  (Marcar leída / Archivar) que aparecen en hover.

Empty state cuidado si no hay resultados.

### Acciones disponibles

- `markNotificationReadAction(id)`
- `markAllNotificationsReadAction()`
- `archiveNotificationAction(id)` *(nuevo)*

---

## Notification Center · mejoras

El dropdown del topbar ahora:
- Barra lateral con color por **prioridad** (danger/warn/ai/subtle).
- Badge contador con animación "9+".
- Footer con **link "Ver todas las notificaciones →"** a `/notificaciones`.
- Items conservan acción rápida "Marcar leída" en hover.

Sidebar ahora tiene **entrada Notificaciones** en grupo Sistema con
badge dinámico de no-leídas.

---

## Branch-level filtering · foundation

Tabla `branch_assignments` ya existe (de Sprint 7). En este sprint:
- No se aplicó filtering activo aún en las páginas (sigue todo a
  business level).
- Próxima etapa: helper `getAssignedBranches(ctx)` + agregar `WHERE
  branch_id IN (...)` a las queries de inbox/facturas/ventas/stock/
  empleados.

Esto se documenta para no perder el hilo.

---

## Invite accept flow

- `acceptInvitationAction(token)` en `app/actions/invitations.ts`.
- Lookup en `user_invitations` por token con admin client.
- Valida status pending + no expirada.
- Upsert `business_members` con el rol de la invitación.
- Marca invitation como accepted.
- Genera activity log + notification.

UI en `/login`:
- Cuando hay `?invite_token=...`, el heading cambia a
  "Te invitaron a un negocio".
- Aparece un banner violeta con botón "Aceptar invitación" que
  dispara la action si ya hay sesión.

---

## Realtime presence en `/inbox`

- `lib/realtime/use-presence.ts` — hook que abre canal Supabase de
  presence con `me.id` como key. Devuelve la lista de conectados.
- `components/realtime/presence-indicator.tsx` — avatars apilados
  (colores derivados del id) + contador. Muestra "Mateo está acá"
  o "3 personas viendo esto".
- Aplicado en el header del Inbox.

En demo mode no hay client Supabase → el indicador renderiza vacío.

---

## QA

- ✅ `npm run build` — 29 páginas + 4 dynamic route handlers.
- ✅ 20 rutas en 200 (incluida `/notificaciones`).
- ✅ `/api/cron/checks` → 200 en demo mode (noop).
- ✅ `/login?invite_token=demo123` → 200, banner visible.
- ✅ Modo demo intacto · Vercel sin cambios visibles.

---

## Tablas nuevas / modificadas

```
ALTER notifications
  ADD priority notification_priority
  ADD category notification_category
  ADD archived_at timestamptz
  + índice compuesto

NEW ENUM notification_priority (high | medium | low | info)
NEW ENUM notification_category (operation | ai | stock | debt | invoice |
                                employee | marketing | system)

NEW TRIGGER notify_critical_stock ON stock_items
```

---

## Server actions con permiso aplicado (12)

- `approveExtractionAction`, `rejectExtractionAction` (`inbox.approve`)
- `approveInvoiceAction`, `rejectInvoiceAction` (`invoices.approve`)
- `inviteUserAction`, `updateMemberRoleAction`, `revokeInvitationAction` (`settings.team`)
- `setIndustryAction` (`settings.industry`)
- `updateBusinessAction` (`settings.business`)
- `registerDebtAction` (`debts.create`)
- `registerPaymentAction`, `markDebtAsSettledAction` (`debts.pay`)

---

## Próximos pasos sugeridos

1. **Branch-level filtering activo**: usar `branch_assignments` en
   queries de Inbox, Facturas, Ventas, Stock, Empleados, Dashboard
   para que employees sólo vean datos de su sucursal asignada.
2. **Email/push notifications**: edge function que envía
   notificaciones por email (Resend/Postmark) o web push.
3. **`/cierres` con activity logs** del cierre (quién aprobó cuándo).
4. **Cron schedule real**: programar `/api/cron/checks` cada 15 min
   en Vercel cron o Supabase pg_cron.
5. **Realtime presence más completo**: "Lucía está editando
   esta factura" con cursor presence; bloquear edición concurrente.
6. **Page-level permissions guard**: middleware adicional que
   redirige a `/` si la página pedida no está en `modulesFor(role)`.
7. **Notifications digest diario**: resumen al socio a las 8 am con
   lo más importante del día anterior.
8. **Audit log search** en `/notificaciones` con filtros por actor
   y por acción.
