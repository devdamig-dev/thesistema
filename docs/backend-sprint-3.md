# Backend Sprint 3 — Deudas + Balances

## Objetivo

Sumar al módulo **Operación** dos secciones nuevas que estaban
pendientes en el brief: **Deudas** y **Balances**. Extender la IA del
Inbox para que entienda mensajes sobre deudas y los rutee a las
tablas correspondientes.

La demo en `NEXT_PUBLIC_APP_MODE=demo` sigue 100% intacta. Como
siempre: si Supabase no está conectado o las tablas están vacías,
los repos caen al adaptador demo.

## Definition of Done

- [x] Nueva ruta `/deudas` con tabla, KPIs, drawer de detalle e
      historial de pagos.
- [x] Nueva ruta `/balances` con hero ejecutivo, KPIs, charts y
      recomendaciones IA.
- [x] Migración con `debts`, `debt_payments` y `balance_snapshots`
      + RLS por business.
- [x] Server actions: `registerDebtAction`, `registerPaymentAction`,
      `markDebtAsSettledAction`.
- [x] IA reconoce `debt_created` y `debt_payment` con los 3
      ejemplos exactos del brief.
- [x] `approveExtractionAction` enrutea los nuevos tipos a `debts`
      y `debt_payments`.
- [x] Sidebar actualizado: Deudas después de Gastos fijos y
      Balances como último ítem de Operación.
- [x] Build verde · 18 rutas en 200.

## Migración nueva

**`supabase/migrations/0005_debts_balances.sql`**

- Enum `debt_status`: `active | overdue | settled`.
- `debts` (id, business_id, creditor, supplier_id, concept,
  original_amount, pending_amount, interest_rate, due_date,
  status, taken_at, settled_at, notes, created_by).
- `debt_payments` (id, debt_id, amount, paid_at, payment_method,
  notes, created_by).
- **Trigger** `recalc_debt_after_payment` que actualiza
  `pending_amount` y `status` automáticamente al insertar/borrar
  un pago. Si el pendiente llega a 0, marca `settled` y completa
  `settled_at`.
- `balance_snapshots` (snapshot mensual con todos los totales).
- RLS habilitado en las 3 tablas + policies por business_id.

## Archivos creados / modificados

```
A app/deudas/page.tsx                       (server fetch)
A app/deudas/deudas-client.tsx              (UI premium)
A app/balances/page.tsx                     (server fetch)
A app/balances/balances-client.tsx          (UI ejecutiva con charts)
A app/actions/debts.ts                      (3 server actions)
A components/charts/income-vs-expense.tsx   (chart compuesto)
A supabase/migrations/0005_debts_balances.sql
A docs/backend-sprint-3.md

M components/shell/sidebar.tsx              (Deudas + Balances en Operación)
M lib/mock-data.ts                          (debts, debtKpis, balanceSnapshot, balanceMonthly, balanceRecommendations)
M lib/supabase/types.ts                     (3 tablas nuevas)
M lib/data/demo.ts                          (debts + balances repos demo)
M lib/data/supabase.ts                      (debts + balances repos reales con fallback)
M lib/data/index.ts                         (export)
M lib/data/mappers.ts                       (mapDebt + labels nuevas)
M lib/ai/types.ts                           (MovementType debt_created/debt_payment)
M lib/ai/heuristic.ts                       (detectDebtCreated/detectDebtPayment)
M lib/ai/prompt.ts                          (3 ejemplos de deuda)
M app/actions/inbox.ts                      (createDebt/createDebtPayment + switch)
```

## UI /deudas

- **KPIs**: Deuda total · Vencidas · Próximo vencimiento · Impacto
  mensual en caja.
- **Filtros**: Todas / Activas / Vencidas / Saldadas (con counts).
- **Tabla** con barra de progreso de pagado vs pendiente, badge de
  estado, indicador de interés mensual si aplica, botón "Pagar"
  rápido en línea.
- **Drawer de detalle** con:
  - Saldo pendiente grande + barra de progreso animada.
  - Tomada / Vencimiento / Interés / Saldada el.
  - Historial de pagos.
  - Botones "Registrar pago" y "Marcar como saldada".
- **Acciones cableadas** a server actions vía `useTransition` +
  `router.refresh()`.

En modo demo: las acciones devuelven `{ ok: true, persisted: false }`
y la UI muestra toast diferenciado.

## UI /balances

- **Hero ejecutivo**: resultado neto del mes en grande con
  storytelling + 6 micro-stats (Ventas, Compras, Gastos, Sueldos,
  Retiros, Pagos deuda).
- **Resultado operativo / Margen bruto / Caja estimada** en cards.
- **Chart "Ingresos vs Egresos"** (área + línea de resultado) con
  los últimos 6 meses.
- **Card lateral de Deudas pendientes** con % sobre facturación,
  pagos del mes y stock valorizado, link a `/deudas`.
- **Recomendaciones del copiloto** con tonos warn/danger/info/success
  y los 4 insights del brief.

## IA · detección de deudas

Nuevos detectores en `lib/ai/heuristic.ts`:

### `detectDebtCreated`

Reconoce:
- `"Le debemos $300.000 a Don José, vence el viernes."`
- `"Tomamos deuda de $1.200.000 para comprar equipamiento."`
- `"Sacamos un préstamo de 500 mil"`

Parsea:
- `creditor` (Don José)
- `original_amount` (con soporte de "180mil", "$300.000", "1.2M")
- `due_date` (lunes/martes/.../viernes → fecha real próxima, o
  `DD/MM` / `DD/MM/YYYY`)
- `concept` (lo que sigue a "para …")

### `detectDebtPayment`

Reconoce:
- `"Pagamos $80.000 de la deuda con el proveedor de pan."`
- `"Pagamos 50 mil a cuenta del banco"`

Parsea:
- `amount`
- `creditor`
- `payment_method` (detecta transferencia/efectivo/MP/cheque)

### Orquestación

Los detectores de deuda corren **antes** de `expense`, sino
`"Pagamos $80.000…"` caería como gasto. El orden en
`DETECTORS[]` es:

1. `detectDailyClosure`
2. `detectDebtPayment` ← nuevo
3. `detectDebtCreated` ← nuevo
4. `detectPurchase`
5. `detectSale`
6. `detectAdvance`
7. `detectExpense`
8. `detectStockUpdate`
9. `detectPriceChange`

## Aprobación de extracciones de deuda

`approveExtractionAction` ahora rutea:

| Tipo | Tabla | Lógica |
|---|---|---|
| `debt_created` | `debts` | Busca supplier por nombre, crea la deuda. `pending_amount` = `original_amount` inicial. `due_date` se parsea (viernes → próximo viernes, 23/05 → 2026-05-23, etc). |
| `debt_payment` | `debt_payments` | Busca la deuda activa más cercana al vencimiento que matchee `creditor`. Inserta el pago. El **trigger** SQL recalcula automáticamente `pending_amount` y `status` (si llega a 0 → `settled` + `settled_at`). |

Si no se puede crear (falta creditor o amount), la extracción
vuelve a `needs_review`.

## QA

- ✅ `npm run build` · 28 páginas + 2 dynamic route handlers.
- ✅ 18 rutas verificadas en 200 (incluyendo `/deudas` y
  `/balances`).
- ✅ Los **3 ejemplos exactos del brief** detectados por la IA con
  confidence ≥ 0.84:

  ```
  "Le debemos $300.000 a Don José, vence el viernes."
    → debt_created, conf 0.84, $300.000

  "Pagamos $80.000 de la deuda con el proveedor de pan."
    → debt_payment, conf 0.85, $80.000

  "Tomamos deuda de $1.200.000 para comprar equipamiento."
    → debt_created, conf 0.84, $1.200.000
  ```

- ✅ Los 6 tipos del Sprint 2 siguen funcionando intactos.
- ✅ Demo intacta · Vercel sigue mostrando la app sin tocar.

## Próximos pasos sugeridos

1. **Cierre automático del mes** — server action que genera
   `balance_snapshots[period_month]` desde sales + purchases +
   expenses + payroll + withdrawals + debts del mes. Cron mensual.
2. **Form proper para Deudas** — reemplazar los `window.prompt`
   por un Drawer de creación con form completo.
3. **Reminders de vencimientos** — cron que marca `overdue` al
   pasar `due_date` y manda recordatorio por WhatsApp.
4. **Interés acumulado** — calcular automáticamente intereses
   mensuales y reflejarlos en `pending_amount` o como columna
   derivada.
5. **Vínculo deuda ↔ purchase** — si una compra se hace a
   crédito, crear la deuda asociada automáticamente.
