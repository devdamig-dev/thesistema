# Backend Sprint 1 — integración Supabase

## Objetivo

Activar lectura/escritura real contra Supabase para los dominios que
ya están en seed, conectar los primeros forms de Ajustes con server
actions, dejar el rubro adaptativo persistido, y abrir el endpoint de
webhook de WhatsApp listo para enchufar Meta Cloud API en Sprint 2.

La demo en modo `NEXT_PUBLIC_APP_MODE=demo` sigue intacta. Cuando
falta Supabase o las tablas están vacías, cada repo cae al adaptador
demo automáticamente — la UI nunca se queda en blanco.

## Qué se hizo

### 1. Mappers DB → UI (`lib/data/mappers.ts`)

Convierten filas snake_case de Supabase a las estructuras que la UI ya
consume desde `lib/mock-data.ts`. Cubren:
business, product, employee, customer, supplier, expense,
ai_recommendation.

### 2. Repositorios reales (`lib/data/supabase.ts`)

Reemplazo del stub. Patrón estándar por cada función:

```ts
async list() {
  const supabase = createSupabaseServerClient();
  if (!supabase) return demo.X.Y();           // 1
  const res = await supabase.from(...)...     // 2
  const rows = res.data as Tables[..."Row"][] | null;
  if (res.error || !rows?.length) return demo.X.Y();   // 3
  return rows.map(mapX);                       // 4
}
```

Dominios con queries reales:
- `business.getCurrent()` — resuelve org + business + branch +
  profile del usuario actual.
- `products.list()`
- `employees.list()`
- `customers.list()`
- `expenses.fixed()`
- `purchases.topSuppliers()`
- `reports.weeklyDecisions()` ← reads `ai_recommendations`

Dominios que siguen 100% demo (van en próximos sprints, requieren
seed expandido o lógica adicional):
- inbox, invoices, closures, marketing, sales, stock, dashboard.

### 3. Server actions (`app/actions/`)

- `business.ts → updateBusinessAction({ name, taxId })`
- `industry.ts → setIndustryAction(industry)` que:
  1. Actualiza `businesses.industry`.
  2. Resetea `business_modules.suggested = false`.
  3. Upserta los módulos del nuevo rubro con `suggested = true`.
  4. `revalidatePath("/ajustes")` y `/ajustes/rubro`.

En modo demo, las actions devuelven `{ ok: true, persisted: false }`
y la UI muestra un toast distinto que en database mode.

### 4. Rubro adaptativo (`lib/industries.ts`)

Constantes compartidas entre el selector visual y la server action:

- `INDUSTRIES` — 9 rubros con label + tagline.
- `SUGGESTED_MODULES_BY_INDUSTRY` — qué módulos `module_key` se
  marcan como sugeridos por rubro.
- `MODULE_LABELS` — descripciones cortas que se muestran en la UI.

`/ajustes/rubro` ahora consume esto y dispara `setIndustryAction()`
al apretar "Aplicar rubro". El form de `/ajustes/negocio` también
está conectado a `updateBusinessAction()`.

### 5. Webhook WhatsApp (`/api/webhooks/whatsapp`)

Endpoint listo para registrar en Meta WhatsApp Cloud API.

- **GET** — verificación inicial. Devuelve `challenge` si el
  `hub.verify_token` coincide con `META_VERIFY_TOKEN`
  (default `gastropilot-dev`).
- **POST** — recibe mensaje. En modo demo devuelve `200` sin
  persistir. En database mode:
  1. Resuelve `business_id` (en sprint 2 → mapear por número
     receptor; ahora toma el primer business).
  2. Inserta en `whatsapp_messages` (uses admin client para saltarse
     RLS desde el webhook).
  3. Crea una `ai_extraction` placeholder con `confidence = 0`,
     `type = "unknown"`.
- Acepta dos formatos de payload:
  - **Simplificado**: `{ from, role, channel, text }` — útil para
    testear con curl.
  - **Cloud API real**:
    `entry[0].changes[0].value.messages[0]` (parsing parcial, se
    completa en Sprint 2).

### 6. QA

- 26 páginas estáticas + 1 dynamic route handler.
- 21 rutas verificadas en 200, más:
  - `GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=gastropilot-dev&hub.challenge=test123` → 200.
  - `POST /api/webhooks/whatsapp` con payload simplificado → 200.

## Cómo probar en database mode

1. Tener Supabase corrido con las migraciones de Sprint 0 y el seed.
2. `.env.local` con `NEXT_PUBLIC_APP_MODE=database` y las claves.
3. `npm run dev` → ir a `/ajustes` → debería mostrar
   "Conectado a Supabase".
4. Ir a `/empleados`, `/clientes`, `/productos`, `/gastos`,
   `/reportes` → los datos vienen del seed.
5. En `/ajustes/negocio` cambiar el nombre y guardar →
   refresca y vuelve a leer desde Supabase.
6. En `/ajustes/rubro` cambiar el rubro y aplicar → se actualiza
   `business_modules` (verificable con SQL).

## Próximos pasos — Sprint 2

1. **Inbox IA real** — webhook completo para Meta Cloud API + edge
   function que llama a Claude/GPT y guarda el resultado en
   `ai_extractions`. Reemplazar `inbox.list()` y
   `inbox.getConversation()` en `lib/data/supabase.ts`. Realtime
   subscription para que el badge del sidebar se actualice solo.

2. **Facturas OCR** — bucket Storage + edge function con
   Mindee/Vision → puebla `invoices` + `invoice_items` + auto-match
   con `ingredients`. Trigger SQL `on insert / on update` que
   recalcula `ingredients.avg_unit_cost`.

3. **Sidebar adaptativo** — leer `business_modules` con
   `suggested = true` del business actual y filtrar los ítems del
   sidebar. Sprint 1 sólo persiste el cambio; sprint 2 lo refleja.

4. **Roles refinados** — RLS por rol (kitchen no aprueba facturas,
   accountant sólo lee ciertas tablas, owner/admin todo).

5. **Realtime** — `whatsapp_messages`, `invoices`,
   `ai_recommendations` con subscriptions vía
   `supabase.channel(...)` y un store client global mínimo.

6. **Regenerar types.ts** — con `supabase gen types typescript` para
   eliminar los `as any` del data layer y server actions.
