# Supabase — guía local

Esta carpeta contiene las migraciones y el seed inicial de GastroPilot
AI. La app sigue funcionando 100% sin Supabase: el flag
`NEXT_PUBLIC_APP_MODE=demo` mantiene la demo viva.

## 1. Crear proyecto Supabase

1. Crear un proyecto nuevo en https://supabase.com.
2. Copiar las claves desde **Project Settings → API**:
   - `NEXT_PUBLIC_SUPABASE_URL` → "Project URL"
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → "anon public"
   - `SUPABASE_SERVICE_ROLE_KEY` → "service_role" (sólo server-side)
3. Pegarlas en `.env.local` (basate en `.env.example`).
4. Cambiar `NEXT_PUBLIC_APP_MODE=database`.

## 2. Aplicar migraciones

Las migraciones están en `supabase/migrations/` y se aplican en orden
numérico. Hay dos formas de correrlas.

### Opción A — Supabase CLI (recomendado)

```bash
# Instalar (si no lo tenés)
brew install supabase/tap/supabase

# Linkear al proyecto remoto
supabase link --project-ref <ref>

# Aplicar todas las migraciones pendientes
supabase db push
```

### Opción B — SQL Editor

Pegar cada archivo en orden desde el **SQL Editor** del panel de
Supabase:

1. `0001_initial_schema.sql`
2. `0002_helpers.sql`
3. `0003_rls_policies.sql`

## 3. Crear tu usuario

Antes de seedear necesitás tener al menos un usuario en `auth.users`.
Opciones:

- Ir a **Authentication → Users → Add user** y crear uno con email y
  password.
- O hacer signup desde `/login` con un magic link (requiere
  configurar SMTP en Supabase).

Copiar el **UUID** del usuario creado (Authentication → Users → click
en el user → ID).

## 4. Correr el seed

El seed carga GastroPilot Demo + La Birra Burger + Palermo y un
subset realista de proveedores, ingredientes, productos, gastos,
empleados, clientes y recomendaciones IA.

```bash
# Reemplazá los valores
psql "postgres://postgres:[password]@db.<ref>.supabase.co:5432/postgres" \
  -v owner_email="'tu@email.com'" \
  -v owner_id="'<uuid-del-usuario>'" \
  -f supabase/seed.sql
```

O desde el SQL Editor (sin variables):

```sql
\set owner_email '\'tu@email.com\''
\set owner_id    '\'00000000-0000-0000-0000-000000000000\''

\i supabase/seed.sql
```

El seed es **idempotente**: usa `on conflict do nothing` para no
duplicar filas si lo corrés más de una vez.

## 5. Probar la conexión

Con `NEXT_PUBLIC_APP_MODE=database` y las claves cargadas:

```bash
npm run dev
```

Abrir `/ajustes` — el header debería mostrar el negocio leído desde
Supabase (todavía cae al demo porque los repos cubren mock-data; en
sprint 1 se reemplazan uno por uno).

## 6. Apagar Supabase y volver al demo

Cambiar `NEXT_PUBLIC_APP_MODE=demo` y reiniciar. La app ignora
Supabase y consume `lib/mock-data.ts` como siempre.

## Estructura de tablas

```
organizations          ← multi-tenant root
└── businesses         ← un negocio por org (puede haber varios)
    ├── branches       ← sucursales / foodtrucks
    ├── business_members  ← usuarios + rol
    ├── business_modules  ← módulos activos según rubro
    ├── suppliers
    ├── ingredients
    ├── products
    │   └── recipes
    │       └── recipe_items
    ├── stock_items (por branch)
    ├── stock_movements
    ├── purchases / purchase_items
    ├── invoices / invoice_items          ← OCR
    ├── sales
    ├── expenses
    ├── employees
    │   ├── shifts
    │   └── advance_payments
    ├── customers
    ├── daily_closures                    ← cierres operativos
    ├── whatsapp_messages
    │   └── ai_extractions
    ├── ai_recommendations
    └── campaigns
```

Cada tabla usa `id uuid`, `created_at`, `updated_at` automáticos via
trigger.

## Row Level Security

Todas las tablas tienen RLS habilitado. Las policies viven en
`0003_rls_policies.sql` y se apoyan en dos helpers:

- `user_organization_id()` → org del usuario logueado.
- `is_member_of_business(uuid)` → ¿es miembro de este business?
- `is_admin_of_business(uuid)` → ¿es owner/admin?

La regla por defecto: un usuario sólo ve datos de un business si está
en `business_members`.
