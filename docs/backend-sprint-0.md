# Backend Sprint 0 — foundation Supabase

## Objetivo

Conectar Supabase y dejar la arquitectura backend lista **sin romper la
demo visual actual**. La app sigue funcionando 100% en modo demo y se
puede activar el modo database cambiando una variable de entorno.

## Definition of done

- [x] La app sigue funcionando visualmente como demo.
- [x] Hay Supabase preparado (clients browser/server/admin).
- [x] Hay migraciones iniciales (schema + helpers + RLS).
- [x] Hay tipos y repositories base.
- [x] Hay demo mode y database mode con un switch (`env.appMode`).
- [x] Hay auth inicial: `/login` con magic link, `/logout` route
      handler, middleware que protege rutas privadas cuando se
      activa `database`.
- [x] Hay seed demo preparado.
- [x] El backend queda listo para arrancar por **Inbox IA** real en
      Sprint 1.

## Archivos creados

```
.env.example                                    NUEVO
package.json                                    +@supabase/ssr, +@supabase/supabase-js
middleware.ts                                   NUEVO

lib/env.ts                                      NUEVO
lib/supabase/types.ts                           NUEVO
lib/supabase/client.ts                          NUEVO
lib/supabase/server.ts                          NUEVO
lib/supabase/admin.ts                           NUEVO

lib/data/README.md                              NUEVO
lib/data/index.ts                               NUEVO
lib/data/demo.ts                                NUEVO
lib/data/supabase.ts                            NUEVO

supabase/README.md                              NUEVO
supabase/seed.sql                               NUEVO
supabase/migrations/0001_initial_schema.sql     NUEVO
supabase/migrations/0002_helpers.sql            NUEVO
supabase/migrations/0003_rls_policies.sql       NUEVO

app/login/page.tsx                              NUEVO
app/logout/route.ts                             NUEVO
app/ajustes/page.tsx                            usa el data layer (await business.getCurrent())

components/shell/app-shell.tsx                  soporta rutas "bare" (login)
```

## Cómo configurar Supabase

1. Crear proyecto en https://supabase.com.
2. Copiar las claves a `.env.local` (ver `.env.example`).
3. Cambiar `NEXT_PUBLIC_APP_MODE=database`.
4. Aplicar migraciones (ver `supabase/README.md`).
5. Crear un usuario en Authentication → Users.
6. Correr `supabase/seed.sql` pasándole el `owner_id` del usuario.
7. `npm run dev` → ir a `/login` → magic link.

Si las variables no están seteadas, la app degrada automáticamente al
modo demo y loguea un warning en server console.

## Tablas creadas (27)

Multi-tenant: `organizations`, `businesses`, `branches`, `profiles`,
`business_members`, `business_modules`.

Operación: `suppliers`, `ingredients`, `products`, `recipes`,
`recipe_items`, `stock_items`, `stock_movements`, `purchases`,
`purchase_items`, `sales`, `expenses`, `employees`, `shifts`,
`advance_payments`, `customers`.

IA / docs: `invoices`, `invoice_items`, `daily_closures`,
`whatsapp_messages`, `ai_extractions`, `ai_recommendations`,
`campaigns`.

Enums: `industry`, `role_key`, `module_key`, `sales_channel`,
`invoice_type`, `invoice_lifecycle`, `approval_status`,
`campaign_channel`, `campaign_type`, `campaign_status`,
`stock_movement_reason`, `priority`, `weekday`, `whatsapp_channel`.

Helpers SQL: `user_organization_id()`, `is_member_of_business()`,
`is_admin_of_business()`, `handle_new_auth_user()` (trigger que crea
el profile cuando se registra un usuario).

## Data layer

La UI consume datos vía `@/lib/data`, no directamente desde
`lib/mock-data` ni `lib/supabase`. Cada repositorio expone funciones
async (`list()`, `getCurrent()`, `getRecipe(name)`, etc.).

El switch entre demo y database vive en `lib/data/index.ts`:

```ts
const adapter = env.appMode === "database" ? supabaseAdapter : demoAdapter;
```

En Sprint 0 el `supabaseAdapter` delega 100% al `demoAdapter` — eso
hace que migrar cada módulo en Sprint 1+ sea reemplazar una sola
función a la vez sin tocar la UI.

## Auth inicial

- `/login` con magic link + CTA "Entrar como demo" que sigue
  funcionando incluso sin Supabase.
- `/logout` route handler que limpia sesión y redirige a /login.
- `middleware.ts` que:
  - en modo `demo` no hace nada (sin interferir con la demo);
  - en modo `database` refresca el token Supabase y redirige a
    `/login?next=<ruta>` cuando el usuario no tiene sesión.

Rutas públicas en modo database: `/login`, `/ayuda`.

## Próximos pasos — Backend Sprint 1

El orden recomendado:

1. **Inbox IA real** — el corazón del producto.
   - Webhook WhatsApp Cloud API → escribe en `whatsapp_messages`.
   - Edge function que llama a Claude/GPT y guarda `ai_extractions`.
   - Reemplazar `inbox.list()` y `inbox.getConversation()` en
     `lib/data/supabase.ts` por queries reales.
   - Realtime subscription para que el badge del sidebar se
     actualice en vivo.

2. **Facturas OCR** — segundo módulo más alto valor.
   - Storage bucket `invoices/`.
   - Edge function con OCR (Mindee / Google Vision) que puebla
     `invoices` + `invoice_items` y matchea con `ingredients`.
   - Trigger Postgres que recalcula `avg_unit_cost` de cada
     ingrediente cuando se aprueba una factura.

3. **Ajustes conectables** — primer módulo de escritura.
   - Server actions para editar `business`, `branches`,
     `business_modules`, `suppliers`.
   - RLS ya está lista, sólo falta cablear los forms a actions.

4. **Adaptive industry** — feature de venta.
   - Cuando cambia `business.industry`, recalcular qué módulos
     están `suggested` en `business_modules` y filtrar el sidebar
     del frontend según ese estado.

5. **Realtime + roles refinados**.
   - Subscriptions a `whatsapp_messages`, `invoices`,
     `ai_recommendations`.
   - Refinar RLS por rol (kitchen no aprueba facturas,
     accountant ve sólo lo que necesita).

6. **Más adelante** (fuera de Sprint 1): WhatsApp Cloud API real,
   OCR real, Marketing IA con LLM real, pagos, integraciones.

## QA Sprint 0

Build OK · 20 rutas verificadas en 200 · modo demo intacto.
