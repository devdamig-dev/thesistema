# Consolidación operativa: filtering, guards, cron y alertas

## Objetivo

Cerrar las puntas abiertas que faltaban para correr **piloto real** con
varios usuarios:

- Branch-level filtering activo en repos.
- Middleware guard real por permisos.
- Cron scheduler programado (`vercel.json`).
- Email digest matutino vía Resend.
- Alertas operativas reales (stock, deudas, IA pendiente, margen crítico).
- QA multiusuario con cookie de rol para demo mode.

Demo mode 100% intacto · database mode con permisos efectivos · build verde.

---

## 1. Branch-level filtering

### `UserContext.assignedBranchIds`

`getCurrentUserContext()` ahora resuelve sucursales asignadas:

- `null` → sin restricción (owner / admin / manager / accountant). Ven TODAS las sucursales.
- `[]` → sin asignaciones (employee nuevo). Por default cae a la sucursal principal del business.
- `[...]` → sólo esas sucursales.

### Helper

```ts
import { applyBranchFilter, getEffectiveBranchIds } from "@/lib/data/branch-filter";

const branchIds = await getEffectiveBranchIds(db, ctx);
const query = db.from("sales").select("*");
const filtered = applyBranchFilter(query, "branch_id", branchIds);
```

### Migración 0009

- `whatsapp_messages.branch_id` (opcional)
- `ai_extractions.branch_id` (denormalizado con backfill)
- `invoices.branch_id` (opcional)
- Índices sobre `branch_id` en cada tabla.

### Repos con filtering activo

| Repo | Estado |
|---|---|
| `inbox.list()` | ✅ filtra `whatsapp_messages.branch_id IN (...)` OR `IS NULL` (mensajes del business) |
| `sales` | ⏳ todavía mock — listo para aplicar cuando se migre a DB |
| `stock` | ⏳ idem |
| `daily_closures` | ⏳ idem |
| `invoices` | ⏳ idem |
| `business / products / employees / customers / expenses / debts` | n/a · business-level, sin concepto de sucursal |

---

## 2. Middleware guard

`middleware.ts` ahora hace 3 chequeos:

1. **Auth** (database mode): refresca sesión Supabase. Sin sesión y ruta privada → `/login?next=<path>`.
2. **Permiso de módulo** (database + demo): si la ruta requiere un `ModuleKey` que el rol no puede ver, redirige a `/?denied=<module>`.
3. **Demo mode con cookie `gp_demo_role`**: respeta el rol "fake" para QA sin DB.

### Mapping ruta → módulo

`lib/permissions/route-map.ts` tiene la tabla compartida con el sidebar:

```
/inbox          → inbox_ai
/reportes       → reports_ai
/marketing      → marketing_ai
/facturas       → invoices_ocr
/cierres        → daily_closures
/ventas         → sales
/compras        → purchases
/gastos         → fixed_expenses
/deudas         → debts
/stock          → stock
/productos      → products
/balances       → balances
/empleados      → employees
/clientes       → customers
```

Públicas (sin guard): `/`, `/login`, `/ayuda`, `/notificaciones`, `/logout`.
Ajustes (`/ajustes/*`) pasan el guard genérico — granularidad fina la hacen las actions con `assertPermission`.

### Toast cuando es denegado

`components/shell/denied-toast.tsx` montado en el layout detecta `?denied=...` y muestra un toast warn explicativo, luego limpia el query param.

---

## 3. Cron scheduler

**Vercel cron** vía `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/checks", "schedule": "*/30 * * * *" },
    { "path": "/api/cron/digest", "schedule": "0 11 * * *" }
  ]
}
```

- `checks` corre cada 30 min: deudas vencidas / por vencer (3d), stock crítico/bajo, extracciones IA pendientes >4h, productos con margen crítico.
- `digest` corre 11:00 UTC = 8:00 ARG.

**Plan Hobby de Vercel** sólo permite 1 cron diario. Para production:
- Upgrade a Pro, o
- Mover los checks a **Supabase pg_cron**:
  ```sql
  select cron.schedule(
    'gp-checks',
    '*/30 * * * *',
    $$ select net.http_get('https://<host>/api/cron/checks', headers => '{"Authorization":"Bearer <CRON_TOKEN>"}'::jsonb); $$
  );
  ```

Protección: si `CRON_TOKEN` está seteada, ambos endpoints exigen `Authorization: Bearer <token>`.

---

## 4. Email digest matutino

### Setup

1. Crear cuenta en [Resend](https://resend.com).
2. Verificar dominio (ej `reportes@gastropilot.ai`).
3. `.env.local`:
   ```env
   RESEND_API_KEY=re_...
   DIGEST_FROM_EMAIL=GastroPilot <reportes@gastropilot.ai>
   NEXT_PUBLIC_APP_URL=https://app.gastropilot.ai
   ```

### Qué incluye el digest

- Header con nombre del business.
- Ventas de ayer (`$X.XXX.XXX`).
- Lista "Te esperan" con counters:
  - Movimientos del Inbox sin aprobar
  - Facturas en revisión
  - Deudas vencidas
  - Alertas de stock crítico
  - Nuevas recomendaciones de IA
- Footer con link a la app.

HTML inline-styled (compatible con todos los clientes de mail).

### Recipients

Roles `owner | admin | manager` del business. Email viene de `profiles.email`.

### Sin Resend

`/api/cron/digest` devuelve `{ ok: true, mode: "demo", noop: true }`. La función arma los queries pero no envía nada.

---

## 5. Alertas operativas

| Alerta | Origen | Endpoint |
|---|---|---|
| Stock crítico (`current < min`) | **Trigger SQL** instantáneo | `notify_critical_stock` |
| Stock crítico/bajo (refuerzo) | Cron `/api/cron/checks` | `checkStockForBusiness` |
| Deuda vencida | Cron — marca `status=overdue` + notifica | `checkDebtsForBusiness` |
| Vencimiento próximo (3 días) | Cron | `checkDebtsForBusiness` |
| Extracción IA pendiente >4h | Cron — agrupa todas | `checkPendingExtractionsForBusiness` *(nuevo)* |
| Producto con margen <35% | Cron — agrupa | `checkCriticalMarginForBusiness` *(nuevo)* |

Todas dedup por `business + title + source` en una ventana de 24h para evitar spam.

---

## 6. QA multiusuario con cookie

### Cómo usar

```bash
# Setea rol en demo (sin reload)
curl -c cookies.txt http://localhost:3000/api/dev/role?as=accountant

# Tomá la cookie y navegá:
curl -b cookies.txt http://localhost:3000/balances    # 200
curl -b cookies.txt http://localhost:3000/marketing   # 307 → /?denied=marketing_ai

# Reset
curl -b cookies.txt http://localhost:3000/api/dev/role/reset
```

Roles válidos: `owner | admin | manager | accountant | marketing | employee | kitchen | cashier | waiter | delivery | viewer`.

### Validado en QA

| Rol | `/marketing` | `/inbox` | `/balances` | `/stock` |
|---|---|---|---|---|
| owner | ✅ | ✅ | ✅ | ✅ |
| accountant | ❌ → / | ❌ → / | ✅ | n/a |
| marketing | ✅ | n/a | ❌ → / | n/a |
| employee | ❌ → / | ✅ | n/a | ✅ |

Todos los redirects vienen con `?denied=<module>` que dispara el toast.

---

## Variables de entorno nuevas

```env
# Cron — protección Bearer opcional (recomendado en prod)
CRON_TOKEN=...

# Email digest
RESEND_API_KEY=re_...
DIGEST_FROM_EMAIL=GastroPilot <reportes@tu-dominio.com>
NEXT_PUBLIC_APP_URL=https://app.tu-dominio.com
```

---

## QA

- ✅ `npm run build` verde · 31 páginas.
- ✅ 19 rutas en 200 + cron endpoints + dev role.
- ✅ Guard funcional verificado con 4 roles distintos.
- ✅ Demo mode intacto · sin variables Supabase la app sigue funcionando.
- ✅ Cookie de rol permite QA multiusuario completo sin DB.

---

## Próximos pasos sugeridos

1. **Migrar repos restantes a DB** (sales, stock, daily_closures, invoices) y activar branch filtering automáticamente.
2. **Activity log search** + export CSV para contador.
3. **Notificaciones por email/push** complementarias al digest (avisos críticos en tiempo real).
4. **Aceptación de invitación con signup**: hoy requiere sesión previa; agregar flujo completo desde `/login` con magic link → accept en una sola operación.
5. **Páginas de error de permisos** dedicadas en vez de redirect a `/` con toast.
6. **Auditoría más fina**: log de "permission_denied" para detectar intentos.
