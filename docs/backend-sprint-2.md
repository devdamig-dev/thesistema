# Backend Sprint 2 — Inbox IA end-to-end

## Objetivo

Implementar el primer flujo real de punta a punta:
**mensaje WhatsApp → IA estructura → Inbox → aprobación → registro real**.

La demo en `NEXT_PUBLIC_APP_MODE=demo` sigue 100% intacta — el webhook
y las acciones devuelven OK sin persistir, y el Inbox cae a mock-data
cuando no hay nada en Supabase.

## Lo que funciona real ahora

### Capa IA (`lib/ai/`)

- `prompt.ts` — system prompt argentino con ejemplos por tipo y
  schema JSON exacto.
- `claude.ts` — cliente Anthropic (model: `claude-haiku-4-5-20251001`
  por default). Devuelve `null` si no hay `ANTHROPIC_API_KEY`.
- `heuristic.ts` — fallback regex robusto que detecta los 6 tipos
  principales sin API key. Parsea "180mil", "$180.000", "30k", "1.2M".
- `extract.ts` — orquesta: intenta Claude → cae a heurístico → si
  todo falla devuelve `failed` con confidence 0 para que el flujo
  marque el mensaje como `needs_review`.

### Webhook (`/api/webhooks/whatsapp`)

- **GET** — sigue verificando token de Meta.
- **POST** — ahora:
  1. Resuelve `business_id`.
  2. Inserta en `whatsapp_messages`.
  3. Corre `extractFromMessage()`.
  4. Inserta en `ai_extractions` con `status` calculado:
     - `failed` si la IA no entendió (confidence < 0.4 o source = failed).
     - `needs_review` si tiene missing_fields o confidence < 0.7.
     - `pending` si todo está claro.
  5. Devuelve `{ ok, message_id, extraction_id, extraction, status }`.

### Server actions (`app/actions/inbox.ts`)

- `approveExtractionAction(extractionId)` — lee la extracción y crea
  el registro real en la tabla correspondiente:

  | Tipo | Tabla | Notas |
  |------|-------|-------|
  | `purchase` | `purchases` + `purchase_items` | Auto-crea `suppliers` si no existe. |
  | `sale` | `sales` (uno por canal) | Normaliza `channel` al enum válido. |
  | `expense` | `expenses` | |
  | `stock_update` | `stock_movements` | Busca `ingredient` por nombre. |
  | `employee_advance` | `advance_payments` | Busca `employee` por nombre. |
  | `daily_closure` | `daily_closures` | Guarda parsed + totales calculados. |
  | `supplier_price_change` / `unknown` | — | Sólo marca approved. |

  Si esperaba crear algo y falta info crítica, marca `needs_review`
  para que el operador edite y reintente.

- `rejectExtractionAction(extractionId)` — marca rejected.
- `requestMoreInfoAction(extractionId)` — marca needs_review.
- `updateExtractionFieldsAction(extractionId, fields)` — patch al
  `fields` JSONB antes de aprobar.

### Inbox real (`/inbox`)

- Ahora es un Server Component que fetchea `inbox.list()`.
- En database mode lee `whatsapp_messages` + `ai_extractions`
  joined y mapea a la estructura que la UI ya consume.
- En demo mode (o si no hay nada en DB) cae a `inboxItems` de
  mock-data → la demo sigue idéntica.
- Acciones cableadas a las server actions vía `useTransition` +
  `router.refresh()`.
- Botón **Actualizar** en el header para refetch manual.

### Migración (`0004_inbox_enhancements.sql`)

- Nuevo valor `failed` en el enum `approval_status`.
- `ai_extractions` ahora tiene: `business_id` (denormalizado),
  `summary`, `target_entity`, `target_record_id`, `source`.
- Backfill de `business_id` para filas existentes.
- Policy RLS de `ai_extractions` ajustada para leer por
  `business_id` directo o por la relación con
  `whatsapp_messages`.

## Lo que sigue mock

- Conversación bidireccional del copiloto (`inbox.getConversation`) —
  la implementamos en Sprint 3 con una tabla
  `whatsapp_conversation_turns`.
- Dashboard, Facturas, Cierres, Marketing, Sales, Stock como
  fuentes principales — siguen leyendo de demo cuando la DB está
  vacía.
- Transcripción de audios y OCR de fotos — Sprint 3.

## Variables de entorno nuevas

```env
# Opcional. Si no está, se usa el heurístico.
ANTHROPIC_API_KEY=sk-ant-...

# Opcional. Default: claude-haiku-4-5-20251001
ANTHROPIC_MODEL_ID=claude-haiku-4-5-20251001
```

Las de Sprint 0 siguen igual:

```env
NEXT_PUBLIC_APP_MODE=demo | database
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
META_VERIFY_TOKEN=gastropilot-dev
```

## Cómo probar el webhook localmente

Modo demo (sin Supabase) — devuelve la extracción sin persistir:

```bash
# 1. Compra
curl -X POST http://localhost:3000/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"from":"Mateo","role":"Socio","channel":"text",
       "text":"Compramos 20kg de carne a Don José por 180mil. Pagamos transferencia."}'

# 2. Venta multi-canal
curl -X POST http://localhost:3000/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"from":"Lucía","role":"Encargada","channel":"text",
       "text":"Hoy vendimos $850.000: local $500.000, delivery $250.000 y WhatsApp $100.000"}'

# 3. Adelanto a empleado
curl -X POST http://localhost:3000/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"from":"Mateo","role":"Socio","channel":"text",
       "text":"A Juan le dimos un adelanto de $30.000"}'

# 4. Gasto fijo
curl -X POST http://localhost:3000/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"from":"Mateo","role":"Socio","channel":"text",
       "text":"El alquiler de mayo fue $450.000"}'

# 5. Stock manual
curl -X POST http://localhost:3000/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"from":"Lucía","role":"Encargada","channel":"text",
       "text":"Quedan 8kg de cheddar"}'

# 6. Cierre operativo (multilinea)
curl -X POST http://localhost:3000/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"from":"Día Licha","role":"Equipo","channel":"text",
       "text":"CARRO foodtruck 16/05\nEFECTIVO: $290.000\nTARJETA: $225.000\nQR: $178.000\nTOTAL: $693.000\nGASTOS:\n$60.000 (DIA LICHA)\nRETIRO: $230.000\nCAMBIO: $8.000\nBurgers: 36"}'
```

Respuesta esperada para "compra":

```json
{
  "ok": true,
  "persisted": false,
  "mode": "demo",
  "extraction": {
    "movement_type": "purchase",
    "confidence": 0.86,
    "detected_fields": {
      "supplier": "Don José",
      "item": "carne",
      "quantity": 20,
      "unit": "kg",
      "total_amount": 180000,
      "payment_method": "Transferencia"
    },
    "missing_fields": ["stock_destination"],
    "suggested_action": "Confirmar compra de carne a Don José y descargar stock cocina.",
    "normalized_summary": "Compra 20kg carne · Don José · $180.000",
    "target_entity": "purchases",
    "source": "heuristic"
  }
}
```

En database mode el response incluye `message_id` y `extraction_id`
y la entrada aparece en `/inbox` lista para aprobar.

## QA

- ✅ `npm run build` verde · 26 páginas estáticas + 2 dynamic route handlers.
- ✅ Smoke test 16 rutas en 200.
- ✅ Webhook con 6 tipos diferentes — todos detectados correctamente
  por el heurístico:
  - compra → `purchase` (conf 0.86)
  - venta → `sale` (conf 0.90)
  - adelanto → `employee_advance` (conf 0.88)
  - gasto → `expense` (conf 0.82)
  - stock → `stock_update` (conf 0.78)
  - cierre → `daily_closure` (conf 0.78)
- ✅ Modo demo intacto · Vercel sigue mostrando la demo sin tocar.

## Próximos pasos — Sprint 3

1. **Conversación bidireccional real** — nueva tabla
   `whatsapp_conversation_turns` para que el copiloto pueda hacer
   repreguntas. Reemplaza `conversations` de mock.
2. **Audios + fotos** — transcripción de audios (Whisper) y OCR
   de fotos (Mindee). Hoy llegan como `[mensaje no textual]`.
3. **Facturas OCR completo** — Storage + edge function que parsea
   el PDF y popula `invoices` + auto-match con `ingredients`.
4. **Sidebar adaptativo** — leer `business_modules.suggested` del
   business actual y filtrar la navegación.
5. **Realtime** — `supabase.channel(...)` en `whatsapp_messages` +
   `ai_extractions` para que el Inbox y el badge del sidebar se
   actualicen sin refresh.
6. **Mejorar el LLM** — agregar self-consistency y few-shot
   examples por rubro. Permitir entrenar el tono a partir de los
   approvals/edits del operador.
7. **Roles refinados** — kitchen no aprueba facturas, accountant
   ve sólo el módulo de facturas y exports, etc.
