# Realtime + Multiusuario + Roles

## Objetivo

Transformar GastroPilot en una plataforma operativa **multiusuario en
tiempo real**:

- Roles reales (owner, admin, manager, accountant, marketing, employee
  + granulares) con matriz de permisos.
- Multi-user: invitaciones, miembros del negocio, cambio de roles.
- Sidebar adaptativo que cambia por rol + módulos activos.
- Realtime con Supabase subscriptions en inbox/dashboard/facturas/
  notificaciones.
- Activity logs / audit trail.
- Notificaciones in-app con badge, dropdown y read/unread.

Demo mode sigue funcionando: rol default `owner`, todos los módulos
visibles, subscriptions noop, notifications + actividad demoeadas.

---

## Migración 0007

`supabase/migrations/0007_realtime_roles.sql`:

- Enum `role_key` extendido con `marketing` y `employee`.
- Tabla **`activity_logs`** (audit trail por business, acciones,
  target, summary legible, data JSONB).
- Tabla **`notifications`** con `tone` enum (info/success/warn/danger/ai),
  recipient opcional, `read_at`, link y source.
- Tabla **`user_invitations`** con token + expiración + status
  (pending/accepted/expired/revoked).
- Tabla **`branch_assignments`** para qué sucursales puede ver cada
  miembro.
- RLS en todas las tablas nuevas.
- **Publication `supabase_realtime`** habilitada para
  `whatsapp_messages`, `ai_extractions`, `invoices`, `invoice_items`,
  `notifications`, `activity_logs`, `ai_recommendations`,
  `stock_items`.

---

## Matriz de permisos (`lib/permissions/`)

11 roles canónicos:

```
owner · admin · manager · accountant · marketing
employee · kitchen · cashier · waiter · delivery · viewer
```

Cada uno tiene un set explícito de `Permission` y de `ModuleKey`
visibles. Los roles operativos (`kitchen`, `cashier`, etc) heredan de
`employee`.

Helpers:
- `hasPermission(role, "invoices.approve")` — chequeo programático.
- `canSeeModule(role, "marketing_ai", enabledModules)` — filtra
  módulo + intersección con módulos activos del business.
- `getRoleLabel(role)` — etiqueta legible.

### Sidebar adaptativo

```
contador:
  General → Dashboard · Reportes IA
  IA y documentos → Facturas OCR
  Operación → Gastos fijos · Deudas · Balances

marketing:
  General → Dashboard · Reportes IA · Marketing IA
  Equipo → Clientes

employee (genérico):
  General → Dashboard · Inbox IA
  IA y documentos → Cierres diarios
  Operación → Ventas · Stock
```

El sidebar recibe `role` + `enabledModules` desde el layout server,
filtra los items y oculta grupos vacíos. **Ayuda** y **Ajustes**
siempre visibles.

---

## Contexto de usuario (`lib/data/auth.ts`)

`getCurrentUserContext()` (server-only) resuelve:
- `userId`, `businessId`
- `role` desde `business_members`
- `enabledModules` desde `business_modules` (sólo los `enabled=true`)
- `fullName`, `email` desde `profiles`

En demo mode devuelve `owner` con todos los módulos visibles.

El layout fetchea el contexto una vez y lo pasa a sidebar y topbar
como props.

---

## Activity feed (`lib/data/activity.ts`)

Helper `logActivity({ businessId, action, summary, ... })` llamado
desde server actions cuando ocurren operaciones:
- `inbox.X.approved` cuando se aprueba una extracción del Inbox.
- `invoice.approved` cuando se aprueba una factura OCR.
- `team.invited` al invitar un usuario.

`listRecentActivity(businessId, limit)` para mostrar en feeds.

---

## Notificaciones (`lib/data/notifications.ts`)

Sistema completo:
- `getRecentNotifications(limit)` — server, lee tabla `notifications`.
  Demo mode devuelve 4 notificaciones plausibles (pendientes inbox,
  factura vencida, stock crítico, factura aprobada).
- `createNotification({...})` — server-only, usa admin client.
- Server actions de read: `markNotificationReadAction`,
  `markAllNotificationsReadAction`.

**Disparadores actuales:**
- Webhook WhatsApp → crea notificación cuando llega un mensaje
  (`needs_review`, `failed` o `pending`).
- `approveExtractionAction` → notificación de "Movimiento aprobado".
- `approveInvoiceAction` → notificación de "Factura aprobada" o
  "N alertas de margen" según recálculo.

**UI en topbar**:
- Botón campana con badge contador (rojo brand) — muestra hasta "9+".
- Dropdown animado (framer-motion) que lista las últimas 10.
- Cada notificación: ícono por tone, título + detalle, link "Ver →",
  botón "Marcar leída".
- Header del dropdown: "X sin leer" + botón "Marcar todas".

---

## Realtime (`lib/realtime/use-realtime.ts`)

Hook `useRealtimeRefresh(table, options)`:
- Abre canal Supabase `realtime:<table>`.
- Escucha INSERT/UPDATE/DELETE.
- Throttle 800ms para evitar flooding.
- En demo mode (sin client) no hace nada.
- Al recibir un cambio, dispara `router.refresh()` → Server Component
  re-renderiza con los datos nuevos.

Componente headless `<RealtimeRefresher tables={["..."]} />` que se
monta en cualquier page server o client.

**Aplicado en:**
- `/inbox` — escucha `whatsapp_messages` y `ai_extractions`.
- `/` (dashboard) — escucha `notifications`, `ai_extractions`,
  `ai_recommendations`, `invoices`.
- Otras páginas pueden montarlo según necesidad.

---

## Multiusuario · UI

`/ajustes/equipo` totalmente cableado:

- **Lista de miembros** con avatar, badge "Aprobador" si el rol lo
  permite, dropdown `<select>` para cambiar rol en línea.
- Server action `updateMemberRoleAction(memberId, role)` con
  `useTransition` + `router.refresh()`.
- **Botón "Invitar usuario"** que abre form inline: email + rol del
  drop con `PRIMARY_ROLES`. Dispara `inviteUserAction()`.
- **Invitaciones pendientes** con vencimiento y botón "Revocar".
- Sección de Acceso del contador + Notificaciones (toggles UI mock).

---

## Server actions

| Action | Qué hace |
|---|---|
| `inviteUserAction({ email, role })` | Inserta en `user_invitations` con token + 7d expiración. Log de actividad. |
| `updateMemberRoleAction(memberId, role)` | Update directo a `business_members.role`. |
| `revokeInvitationAction(invitationId)` | Marca invitación como `revoked`. |
| `markNotificationReadAction(id)` | Update `read_at`. |
| `markAllNotificationsReadAction()` | Update masivo. |

---

## QA verde

- ✅ `npm run build` — 28 páginas + 3 dynamic route handlers.
- ✅ 19 rutas en 200 (incluida `/ajustes/equipo`).
- ✅ Webhook genera notificación + extracción.
- ✅ Modo demo intacto · Vercel sin cambios visibles.

---

## Módulos que respetan permisos

**Hoy filtran por permiso** (sidebar adaptativo activo):
- Todos los módulos del sidebar via `canSeeModule(role, key)`.

**Hoy registran actividad**:
- Inbox approve (`inbox.X.approved`).
- Facturas approve (`invoice.approved`).
- Team invite (`team.invited`).

**Hoy generan notificaciones**:
- Webhook WhatsApp (inbox).
- Aprobación de Inbox.
- Aprobación de Facturas.

---

## Qué queda para la próxima etapa

1. **Activity feed widget en Dashboard** — leer
   `activity_logs` y mostrar las últimas 10 operaciones del equipo
   (hoy el feed del Dashboard sigue mostrando mock-data).
2. **Más disparadores** de activity log + notificaciones:
   - Deuda creada / pago registrado / vencimiento próximo.
   - Stock crítico (trigger SQL o cron).
   - Recomendación IA nueva.
3. **Página `/notificaciones`** con vista completa, filtros por
   tono y archivo histórico.
4. **Email/push** para notificaciones (Supabase Edge + Resend o
   Postmark).
5. **Branch-level filtering** — usar `branch_assignments` para que
   employees sólo vean datos de su sucursal.
6. **Required-permission server actions** — wrap genérico que
   chequea `hasPermission` antes de ejecutar.
7. **`/login` + accept-invitation flow** — recibir token, crear
   profile + member, redirigir.
8. **Realtime presence** — quién está conectado, "Lucía está
   revisando el Inbox".

---

## Cómo probar

### Sidebar adaptativo en demo mode

Hoy demo mode usa rol `owner`. Para validar el filtrado por rol,
ir a `lib/data/auth.ts` y cambiar temporalmente:

```ts
const DEMO_CONTEXT: UserContext = {
  // ...
  role: "accountant", // o "marketing", "employee", etc.
};
```

Recargar `/` y verificar que el sidebar muestra sólo los módulos del
rol.

### Notificaciones en demo

Abrir cualquier ruta y clickear la campana en el topbar. Aparece el
dropdown con 4 notificaciones demo (3 sin leer, 1 leída). Probar
"Marcar leída" → toggle local.

### Realtime + activity logs en database mode

```bash
# 1. Aplicar migración 0007 en Supabase
# 2. NEXT_PUBLIC_APP_MODE=database
# 3. npm run dev

# Disparar un webhook
curl -X POST http://localhost:3000/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"from":"Mateo","role":"Socio","channel":"text",
       "text":"Compramos 20kg de carne a Don José por 180mil"}'

# 4. Si tenés /inbox abierto en otra ventana → debería refrescarse
#    automáticamente sin recargar.
# 5. La campana del topbar muestra "1 sin leer".
# 6. Aprobar la extracción → row en activity_logs + nueva notificación.
```
