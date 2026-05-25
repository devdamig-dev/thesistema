# Checklist de piloto · GastroPilot AI

## Antes de arrancar

### 1. Crear proyecto en Supabase
- Ir a https://supabase.com → New project
- Copiar claves: URL, anon key, service role key

### 2. Configurar `.env.local`
```env
NEXT_PUBLIC_APP_MODE=database
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
META_VERIFY_TOKEN=gastropilot-dev

# Opcionales pero recomendados
ANTHROPIC_API_KEY=sk-ant-...        # Mejora la IA (sin esto usa heurístico)
RESEND_API_KEY=re_...                # Email digest + alertas
DIGEST_FROM_EMAIL=GastroPilot <reportes@tu-dominio.com>
NEXT_PUBLIC_APP_URL=https://app.tu-dominio.com
CRON_TOKEN=tu-token-secreto          # Protege los endpoints cron
```

### 3. Aplicar migraciones
```bash
# Opción A: Supabase CLI
supabase db push

# Opción B: SQL Editor en el panel
# Copiar en orden: 0001 → 0002 → ... → 0010
```

### 4. Crear primer usuario
- Authentication → Users → Add user (email + password)
- Copiar UUID del usuario

### 5. Correr seed
```bash
psql "postgres://postgres:[pass]@db.<ref>.supabase.co:5432/postgres" \
  -v owner_email="'tu@email.com'" \
  -v owner_id="'<uuid>'" \
  -f supabase/seed.sql
```

### 6. Verificar la app
```bash
npm install && npm run dev
```
- Ir a http://localhost:3000/login
- Si el business no completó onboarding → redirige a /onboarding
- Completar los 7 pasos

---

## Primer uso real

### Conectar WhatsApp
1. Ir a /ajustes/whatsapp
2. Asignar un número de WhatsApp Business
3. Registrar el webhook en Meta:
   - URL: `https://tu-dominio.com/api/webhooks/whatsapp`
   - Token: valor de `META_VERIFY_TOKEN`

### Probar webhook (sin Meta)
```bash
curl -X POST https://tu-dominio.com/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"from":"Mateo","role":"Socio","channel":"text",
       "text":"Compramos 20kg de carne a Don José por 180mil"}'
```
→ Aparece en /inbox listo para aprobar.

### Probar OCR
```bash
curl "https://tu-dominio.com/api/dev/ocr-pipeline?file=carne.pdf"
```
→ Devuelve extracción + matching de ingredientes.

### Subir factura real
- Ir a /facturas → "Subir factura" → seleccionar foto o PDF
- La IA procesa, extrae items, matchea con insumos
- Aprobar → crea purchase + actualiza stock + recalcula costos

### Invitar equipo
- Ir a /ajustes/equipo → "Invitar usuario"
- Email + rol → se genera token de invitación
- El invitado entra con el link y acepta

### Verificar auditoría
- Ir a /auditoria → ver actividad del equipo
- Exportar CSV para el contador

### Verificar notificaciones
- Campana en el topbar → dropdown con alertas
- /notificaciones → vista completa con filtros

---

## Roles del piloto

| Rol | Qué ve | Qué puede hacer |
|---|---|---|
| **Socio (owner)** | Todo | Todo |
| **Encargado (manager)** | Todo excepto Marketing y ajustes de equipo | Aprobar inbox, registrar compras, ver reportes |
| **Contador (accountant)** | Facturas, gastos, deudas, balances, reportes | Exportar, enviar a contabilidad |
| **Empleado (employee)** | Dashboard, inbox, cierres, stock, ventas | Cargar cierres, actualizar stock |
| **Marketing** | Dashboard, marketing, clientes, reportes | Crear campañas, gestionar clientes |

---

## Variables de entorno completas

| Variable | Requerida | Para qué |
|---|---|---|
| `NEXT_PUBLIC_APP_MODE` | Sí | `demo` o `database` |
| `NEXT_PUBLIC_SUPABASE_URL` | En database | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | En database | Clave anon |
| `SUPABASE_SERVICE_ROLE_KEY` | En database | Admin (server-only) |
| `META_VERIFY_TOKEN` | Opcional | Verificación webhook Meta |
| `ANTHROPIC_API_KEY` | Opcional | Mejora extracción IA |
| `ANTHROPIC_MODEL_ID` | Opcional | Default: claude-haiku-4-5 |
| `OCR_PROVIDER` | Opcional | mock / mindee / google-vision |
| `MINDEE_API_KEY` | Opcional | OCR real con Mindee |
| `GOOGLE_VISION_API_KEY` | Opcional | OCR real con Google |
| `RESEND_API_KEY` | Opcional | Email digest + alertas |
| `DIGEST_FROM_EMAIL` | Opcional | Sender del digest |
| `NEXT_PUBLIC_APP_URL` | Opcional | Link en emails |
| `CRON_TOKEN` | Opcional | Protege endpoints cron |

---

## Cron (Vercel)

`vercel.json` ya configura:
- `/api/cron/checks` cada 30 min (deudas, stock, IA pendiente, márgenes)
- `/api/cron/digest` 11:00 UTC = 8:00 ARG (resumen matutino)

En Vercel Pro se activan automáticamente. En Hobby sólo 1/día.

---

## Soporte y debugging

- `/auditoria` → ver todas las acciones del equipo
- `/notificaciones` → alertas operativas
- `/api/dev/role?as=accountant` → probar otro rol en demo
- `/api/dev/ocr-pipeline?file=carne.pdf` → probar pipeline OCR
- `activity_logs` en Supabase → audit trail completo
- `invoice_processing_logs` → trazabilidad del pipeline OCR
