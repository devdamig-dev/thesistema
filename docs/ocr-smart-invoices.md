# OCR & Smart Invoices

## Objetivo

Pipeline completo de facturas inteligentes que toma una foto o PDF y
lo convierte en información estructurada que impacta automáticamente
en compras, stock, ingredientes, recetas, costos, márgenes y
recomendaciones IA.

Mantiene `NEXT_PUBLIC_APP_MODE=demo` 100% funcional (provider OCR
mock por default + heurístico de extracción).

## Flujo end-to-end

```
[Upload UI / WhatsApp]
        ↓
[uploadInvoiceAction]
        ↓
1. Storage upload → bucket "invoices"
        ↓
2. invoices row creada (status uploaded → processing)
        ↓
3. OCR pipeline → text plano
        ↓
4. IA extraction → header + items estructurados
        ↓
5. supplier auto-create
        ↓
6. invoice_items creados + matching con ingredients
        ↓
7. status = extracted | needs_review
        ↓
[Drawer de revisión humana]
        ↓
[approveInvoiceAction]
        ↓
8. purchase + purchase_items creados
        ↓
9. stock_movements por ingrediente matcheado
        ↓
10. RPC recalc_ingredient_cost → avg_unit_cost actualizado
        ↓
11. recalcRecipesForIngredient → products.cost actualizado
        ↓
12. Si margen baja > 5% → ai_recommendations
```

## Migración 0006

- **Storage bucket `invoices`** con policies por business
  (los path tienen formato `{org_id}/{business_id}/{uuid}.{ext}`).
- `invoices`: nuevas columnas `storage_path`, `storage_bucket`,
  `file_mime`, `file_size`, `ocr_text`, `ocr_provider`,
  `processing_started_at`, `processing_completed_at`,
  `processing_error`, `ai_provider`.
- Nuevos valores en enum `invoice_lifecycle`: `uploaded`,
  `extracted`, `rejected`, `failed`.
- `invoice_items`: nuevas columnas `match_status`, `match_score`,
  `suggested_ingredient_id`, `unit`, `qty_numeric`.
- Nuevo enum `item_match_status`: `matched | ambiguous |
  unmatched | manual`.
- Nueva tabla `invoice_processing_logs` (trazabilidad por stage:
  upload / ocr / ai / matching / approval / recalc / error).
- RPC `recalc_ingredient_cost(p_ingredient_id)` — promedio
  ponderado de los últimos 5 purchase_items.

## Storage

Bucket privado de 20 MB max. MIME permitidos:
`image/jpeg`, `image/png`, `image/webp`, `image/heic`,
`application/pdf`.

Policies de lectura/insert por membresía en el business; delete
restringido a `owner | admin`.

## OCR pipeline (`lib/ocr/`)

Adapter pattern con tres providers:

| Provider | Cuándo se usa | Estado |
|---|---|---|
| `mock` | Default · sin API keys | ✅ funcional · arma facturas plausibles según filename |
| `google-vision` | Si `GOOGLE_VISION_API_KEY` | ✅ implementado · usa `DOCUMENT_TEXT_DETECTION` |
| `mindee` | Si `MINDEE_API_KEY` | ✅ implementado · serializa el JSON estructurado a texto plano |

Selección automática:
1. `OCR_PROVIDER` env explícito
2. `MINDEE_API_KEY` si está
3. `GOOGLE_VISION_API_KEY` si está
4. `mock` (fallback)

Si el provider real falla, se cae al mock automáticamente
(`primary_failed: ... · used_mock_fallback`).

## IA extraction (`lib/ai/invoice-extract.ts`)

Toma el texto OCR y devuelve `InvoiceExtraction` con:

- `supplier`, `tax_id`, `invoice_type` (A|B|C), `invoice_number`,
  `invoice_date`, `subtotal`, `tax`, `total`, `currency`,
  `payment_method`
- `items[]` con `description`, `qty`, `unit`, `unit_price`, `total`
- `confidence` (0..1) y `source` (`claude | heuristic | failed`)

Estrategia: si hay `ANTHROPIC_API_KEY` intenta Claude; siempre
cae al heurístico robusto.

El **`parseArs`** soporta tanto formato AR (`180.000,50`) como
US-like (`148,760.00`), compactos (`180mil`, `30k`, `1.2M`) y sin
separadores. Detecta el decimal por cantidad de dígitos después
del último separador.

## Ingredient matching (`lib/ingredients/matching.ts`)

Algoritmo:

1. **Normalización**: minúsculas, sacar acentos, sacar cantidades
   con unidad (`180g`, `1kg`, `500ml`), sacar `x10` / `por 5`,
   sacar números sueltos.
2. **Stopwords**: `de`, `del`, `la`, `el`, atributos vacíos
   (`premium`, `extra`, `xl`, `pack`, `block`, `lata`),
   genéricos (`queso`).
3. **Stem naïve**: saca `s` final en tokens ≥ 5 chars
   (gaseosas → gaseosa).
4. **Score combinado** (0..1):
   - 50% F1 sobre tokens (recall × precision balanceados).
   - 30% bonus si algún token "fuerte" del ingrediente (≥ 5
     chars) está en la descripción → captura "CHEDDAR BLOCK 1KG"
     ↔ "Queso cheddar".
   - 20% bonus si el primer token coincide.
5. **Status**:
   - `matched`: score ≥ 0.7 y diferencia con el segundo
     candidato > 0.15.
   - `ambiguous`: score ≥ 0.4 pero hay competencia.
   - `unmatched`: nada por encima de 0.4.

Resultados verificados sobre el mock OCR (5 facturas distintas):

| Descripción OCR | Mejor match | Status | Score |
|---|---|---|---|
| CARNE PREMIUM 180G x KG | Carne premium 180g | matched | 1.00 |
| CHEDDAR BLOCK 1KG | Queso cheddar | matched | 1.00 |
| GASEOSA 500ML PACK x24 | Gaseosas 500ml | matched | 1.00 |
| PAN BURGER XL | Pan brioche | ambiguous | 0.45 |
| INSUMO GENERICO | (ninguno) | unmatched | 0.00 |

## Server actions (`app/actions/invoices.ts`)

| Action | Qué hace |
|---|---|
| `uploadInvoiceAction(FormData)` | Sube a Storage, crea invoice, corre OCR, IA extraction, crea invoice_items con match. En demo no persiste pero devuelve la extracción. |
| `approveInvoiceAction(invoiceId)` | Crea `purchase` + `purchase_items` + `stock_movements`, llama RPC `recalc_ingredient_cost`, dispara `recalcRecipesForIngredient` que actualiza `products.cost` y genera `ai_recommendations` si el margen baja ≥ 5%. |
| `rejectInvoiceAction(invoiceId)` | Marca como `rejected`. |
| `updateInvoiceItemAction(itemId, patch)` | Patch a un item; si cambia `matched_ingredient_id`, actualiza `match_status` a `manual`. |

## Recalc engine (`lib/recipes/recalc.ts`)

Cuando entra una compra, por cada ingrediente afectado:

1. Actualiza `recipe_items.unit_cost` al nuevo `avg_unit_cost`.
2. Para cada producto cuya receta usa el ingrediente, recalcula
   `products.cost` sumando todos sus `recipe_items.unit_cost`.
3. Si el margen del producto cae ≥ 5%, crea
   `ai_recommendation` con prioridad alta (≥ 8%) o media,
   sugiriendo un precio nuevo que recupere el margen original.

Threshold configurable: `MARGIN_ALERT_THRESHOLD_PCT` (default 5).

## UI (`/facturas`)

- **Upload zone real**: input file + submit a server action +
  feedback via toast (incluye qué detectó la IA: proveedor,
  items, confianza).
- **Estados visuales** soportados:
  `uploaded` · `processing` · `extracted` · `needs_review` ·
  `approved` · `rejected` · `failed` · `contador`.
- **Drawer detalle**: aprobar / rechazar / editar (cableado a
  server actions con `useTransition` + `router.refresh()`).
- Loading state `Procesando…` en el botón mientras corre el
  pipeline.

## Endpoint dev para QA

```
GET /api/dev/ocr-pipeline?file=carne.pdf
```

Devuelve OCR + extracción IA + matching contra ingredientes
demo. Útil para validar el pipeline sin pasar por Supabase.

## Variables nuevas

```env
# OCR
OCR_PROVIDER=mock | mindee | google-vision   # opcional
MINDEE_API_KEY=
GOOGLE_VISION_API_KEY=

# Las de Sprints anteriores
ANTHROPIC_API_KEY=     # mejora la extracción
META_VERIFY_TOKEN=     # webhook WhatsApp
NEXT_PUBLIC_APP_MODE=demo | database
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Qué funciona real

- ✅ Upload a Supabase Storage con path multi-tenant.
- ✅ OCR pipeline con adapter pattern (mock + Vision + Mindee).
- ✅ Extracción IA (heurístico AR + Claude opcional).
- ✅ Ingredient matching con scoring robusto.
- ✅ Aprobación que crea purchase + items + stock_movements.
- ✅ Recalc de avg_unit_cost por RPC.
- ✅ Recalc de products.cost por ingrediente afectado.
- ✅ Generación de ai_recommendations si margen baja > 5%.
- ✅ Trazabilidad completa en `invoice_processing_logs`.
- ✅ UI con upload real + status states + acciones cableadas.

## Qué queda mock / futuro

- Audio transcription (no es OCR — Whisper iría aparte).
- Reconocimiento visual avanzado (códigos de barras, sellos).
- Export contable real (CSV con headers AFIP, XML 4to3).
- AFIP integration (validar CAE, consulta de comprobantes).
- Auto-approval total cuando confidence ≥ 0.95.
- Sidebar adaptativo por rubro.
- Realtime (subscription a invoices con badge en sidebar).

## Cómo probar

### Demo mode (sin Supabase)

```bash
# 1. Endpoint dev
curl "http://localhost:3000/api/dev/ocr-pipeline?file=carne.pdf"
curl "http://localhost:3000/api/dev/ocr-pipeline?file=panaderia-espiga.jpg"
curl "http://localhost:3000/api/dev/ocr-pipeline?file=serenisima-cheddar.pdf"
curl "http://localhost:3000/api/dev/ocr-pipeline?file=coca-cola.pdf"

# 2. Upload desde la UI
# Ir a /facturas → "Subir factura" → seleccionar cualquier archivo.
# La UI muestra el resultado del OCR mock + extracción.
```

### Database mode

```bash
# 1. Aplicar migración 0006 + las anteriores en Supabase
# 2. Crear el bucket "invoices" (las policies van por SQL)
# 3. NEXT_PUBLIC_APP_MODE=database + claves
# 4. npm run dev
# 5. /facturas → Subir factura
# 6. Aparece en la lista con status "extracted" o "needs_review"
# 7. Abrir drawer → revisar items y match
# 8. Aprobar → ver /compras (purchase creada) + /stock (movements)
#              + /productos (costs actualizados) + /reportes (nuevas
#              ai_recommendations si margen bajó > 5%)
```
