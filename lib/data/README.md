# Data layer

Capa de acceso a datos que **abstrae el origen** (mock vs Supabase) de la
UI. Las páginas y componentes nunca importan `lib/mock-data` ni
`lib/supabase/*` directamente — siempre piden datos a estos
repositorios.

## Estructura

```
lib/data/
├── index.ts                    Punto de entrada único.
├── demo.ts                     Adaptador demo: re-exporta mock-data.
├── supabase.ts                 Adaptador Supabase (Sprint 1+).
└── repositories/
    ├── business.ts
    ├── products.ts
    ├── inbox.ts
    ├── ...
```

## Modo de operación

El modo lo decide `NEXT_PUBLIC_APP_MODE`:

- `demo` *(default)* → `lib/data/index.ts` exporta el adaptador demo,
  que re-exporta los datos de `lib/mock-data.ts`. La app sigue
  funcionando sin Supabase.
- `database` → exporta el adaptador Supabase. En Sprint 0 todavía no
  está poblado, así que cae al demo como fallback hasta que cada
  módulo se migre.

## Migración módulo a módulo

Sprint 1 va a empezar por Inbox IA: `repositories/inbox.ts` va a leer
de Supabase y los demás siguen demo. Como la UI siempre habla con
estos repos, el switch es transparente.
