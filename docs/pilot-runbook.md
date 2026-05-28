# Runbook · Inicio de piloto real

> Guía operativa para pasar de la demo validada a un piloto real con un
> restaurante / cafetería / hamburguesería. Pensada para correrla en
> 4–6 horas la primera vez y deja al negocio operando con datos propios.

Si querés el resumen visual en la app: `/ayuda/piloto`.
Para arquitectura técnica de cada sprint: `docs/backend-sprint-*.md`.

---

## 0. Pre-requisitos

- [ ] Cuenta en **Supabase** (free alcanza para el piloto).
- [ ] Cuenta en **Vercel** (Hobby alcanza; Pro recomendado por cron cada 30 min).
- [ ] Dominio propio apuntable a Vercel (ej. `app.tu-negocio.com`).
- [ ] **Número de WhatsApp Business** dedicado del local (no el personal del dueño).
- [ ] Cuenta en **Resend** para el digest matutino (opcional pero recomendado).
- [ ] Cuenta en **Meta Business** + acceso a WhatsApp Cloud API (opcional para piloto inicial; se puede simular con curl).
- [ ] Email del dueño y del contador.
- [ ] CUIT del negocio + datos básicos (rubro, sucursal, canales de venta).

---

## 1. Crear el proyecto en Supabase

- [ ] `https://supabase.com` → **New project** en la región más cercana (sa-east-1 / São Paulo recomendado para AR).
- [ ] Anotar las 3 claves desde **Settings → API**:
  - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
  - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (server-only, nunca exponer)
- [ ] Anotar la **DB password** desde **Settings → Database**.
- [ ] Habilitar **Storage** (viene por default, no requiere acción).
- [ ] Habilitar **Auth → Email** (default).

---

## 2. Aplicar migraciones SQL

Las 11 migraciones están en `supabase/migrations/`. Aplicarlas **en orden**:

| Orden | Archivo | Qué hace |
|---|---|---|
| 1 | `0001_initial_schema.sql` | Tablas core (orgs, businesses, profiles, branches) |
| 2 | `0002_helpers.sql` | Funciones SQL utilitarias |
| 3 | `0003_rls_policies.sql` | Row-Level Security por business |
| 4 | `0004_inbox_enhancements.sql` | Inbox IA + WhatsApp messages |
| 5 | `0005_debts_balances.sql` | Deudas, pagos, snapshots de balance |
| 6 | `0006_invoice_ocr.sql` | Facturas OCR + bucket `invoices` + RLS storage |
| 7 | `0007_realtime_roles.sql` | Realtime + roles granulares |
| 8 | `0008_notifications_audit.sql` | Notificaciones + `activity_logs` |
| 9 | `0009_branch_filtering.sql` | Filtrado por sucursal |
| 10 | `0010_onboarding.sql` | Estado de onboarding por business |
| 11 | `0011_accounting_categories.sql` | Categorías de deuda (impuestos/sueldos/etc) |

**Opción A — Supabase CLI (recomendado):**
```bash
supabase link --project-ref <ref>
supabase db push
```

**Opción B — SQL Editor del panel:**
- Para cada archivo: pegar contenido en SQL Editor → Run. Verificar que no haya errores antes de pasar al siguiente.

- [ ] Verificar que existen las tablas:
  ```sql
  select count(*) from information_schema.tables
   where table_schema = 'public';
  -- Esperado: ≥ 35 tablas
  ```
- [ ] Verificar bucket de Storage:
  ```sql
  select id, public from storage.buckets where id = 'invoices';
  -- Esperado: invoices, public=false
  ```

---

## 3. Crear el usuario owner

- [ ] **Auth → Users → Add user**: email del dueño + password temporal.
- [ ] Marcar "Auto Confirm User" para que no pida verificación de email.
- [ ] Copiar el **UUID** del usuario creado (lo necesitamos en el seed).

> El trigger `handle_new_auth_user` crea automáticamente la fila en `profiles`.

---

## 4. Seed del negocio piloto

Hay dos caminos:

### 4.A. Seed manual de mínimos (recomendado para piloto real)
La estrategia más limpia es **no usar el seed demo** (que carga "La Birra Burger") y dejar que el dueño complete el onboarding desde la app:

- [ ] Saltar al paso 7 (variables en Vercel) y al paso 11 (login + onboarding).
- [ ] El onboarding crea organización + business + sucursal principal + datos de rubro a partir de las semillas en `lib/onboarding/seeds.ts`.

### 4.B. Seed demo + renombrar (más rápido para arrancar viendo data)
Útil si querés ver la app llena de datos antes y después limpiarlos.

```bash
psql "postgres://postgres:[DB_PASSWORD]@db.<ref>.supabase.co:5432/postgres" \
  -v owner_email="'dueno@negocio.com'" \
  -v owner_id="'<uuid-del-usuario>'" \
  -f supabase/seed.sql
```

Luego desde la app (`/ajustes/negocio`) cambiar el nombre, dirección y rubro.

- [ ] Decidir entre A o B.
- [ ] Verificar membership:
  ```sql
  select bm.role, b.name from business_members bm
    join businesses b on b.id = bm.business_id
   where bm.user_id = '<uuid>';
  -- Esperado: 1 fila con role='owner'
  ```

---

## 5. Configurar Resend (digest matutino)

- [ ] `https://resend.com` → API Keys → **Create API Key**.
- [ ] Anotar `re_...` para `RESEND_API_KEY`.
- [ ] Agregar dominio en **Resend → Domains** y configurar SPF + DKIM en el DNS del dominio.
- [ ] Validar que el dominio queda en estado `Verified`.
- [ ] Sender sugerido: `GastroPilot <reportes@tu-dominio.com>` → variable `DIGEST_FROM_EMAIL`.

> Si saltás Resend, el digest igual corre pero no manda email — los datos quedan disponibles en la app.

---

## 6. Configurar WhatsApp dedicado

### 6.1. Número
- [ ] Conseguir un **número dedicado** para el local (no el del dueño). Puede ser un chip nuevo o un VOIP.
- [ ] Instalar **WhatsApp Business** en ese número.

### 6.2. Meta Cloud API (cuando ya querés webhook real)
- [ ] `https://developers.facebook.com` → crear app **Business** → agregar producto **WhatsApp**.
- [ ] Anotar el `Phone Number ID` y el `Business Account ID`.
- [ ] Generar **System User Token** permanente.
- [ ] En la app GastroPilot, ir a `/ajustes/whatsapp` y cargar el número.

> Para los primeros 1–2 días podés saltarte Meta y simular con `curl` (paso 8 + smoke test 1).

---

## 7. Variables de entorno en Vercel

En **Vercel → Project → Settings → Environment Variables**, agregar en `Production` (y opcionalmente `Preview`):

```env
NEXT_PUBLIC_APP_MODE=database
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

META_VERIFY_TOKEN=<token-largo-y-aleatorio>
CRON_TOKEN=<token-largo-y-aleatorio>

RESEND_API_KEY=re_...
DIGEST_FROM_EMAIL=GastroPilot <reportes@tu-dominio.com>
NEXT_PUBLIC_APP_URL=https://app.tu-negocio.com

# Opcionales — mejoran la IA real, no son críticas para el piloto
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL_ID=claude-haiku-4-5
OCR_PROVIDER=mock                 # mock | mindee | google-vision
# MINDEE_API_KEY=...
# GOOGLE_VISION_API_KEY=...
```

Generar tokens aleatorios:
```bash
openssl rand -hex 32
```

- [ ] Verificar que **todas** las variables `NEXT_PUBLIC_*` están en **Production** (sin ellas el cliente no resuelve Supabase).
- [ ] Hacer **Redeploy** del último commit para que las variables se inyecten.

---

## 8. Webhook URL en Meta

Una vez que el dominio resuelve a Vercel y el último deploy está verde:

- [ ] **Meta → tu app → WhatsApp → Configuration → Webhooks**:
  - **Callback URL:** `https://app.tu-negocio.com/api/webhooks/whatsapp`
  - **Verify token:** mismo valor que `META_VERIFY_TOKEN` en Vercel.
- [ ] Suscribirse al campo **`messages`** del producto WhatsApp Business Account.
- [ ] Verificar que Meta marca el webhook como **Verified** (hace un GET con `hub.challenge`).
- [ ] Probar con un mensaje real: enviar `"hola"` al número y revisar la tabla `whatsapp_messages` en Supabase.

---

## 9. Negocio piloto (configuración inicial desde la app)

Loguearse a `https://app.tu-negocio.com/login` con el owner.

- [ ] Completar onboarding en `/onboarding` (7 pasos):
  1. Datos del negocio (nombre, CUIT, rubro)
  2. Sucursales (al menos la principal)
  3. Canales de venta (Salón, Delivery propio, PedidosYa, WhatsApp)
  4. Rubro / industria (carga semillas de productos típicos)
  5. Insumos / ingredientes base
  6. Recetas básicas (opcional al arranque)
  7. Equipo (se completa en paso 10)
- [ ] Ir a `/ajustes/negocio` y confirmar dirección + horario.
- [ ] Ir a `/ajustes/rubro` y aceptar / ajustar las semillas cargadas.

---

## 10. Roles de prueba (invitar al equipo)

Desde `/ajustes/equipo` → **Invitar usuario**. Repetir para cada uno:

| Persona | Email | Rol | Por qué |
|---|---|---|---|
| Dueño / socio | `dueno@…` | `owner` | Ya creado en paso 3 |
| Encargado / manager | `encargado@…` | `manager` | Aprueba inbox, registra compras |
| Contador / estudio | `contador@…` | `accountant` | Recibe facturas + exporta CSV |
| Cajero / empleado | `caja@…` | `employee` | Carga cierres + actualiza stock |
| Marketing (opcional) | `marketing@…` | `marketing` | Sólo si hay alguien dedicado |

- [ ] Verificar que cada invitado recibió el mail.
- [ ] El invitado abre el link → setea password → entra.
- [ ] Probar permisos con **un rol distinto al owner** (ver smoke test 9).

---

## 11. Pruebas mínimas (smoke tests)

Estas 9 pruebas validan que el piloto puede arrancar. Si falla una, **no avanzar** con el cliente — debuggear primero. Idealmente correrlas con el dueño mirando para que vea cómo funciona.

### 11.1. Compra por WhatsApp
- [ ] Enviar al webhook (con `curl` para simular o desde Meta una vez configurado):
  ```bash
  curl -X POST https://app.tu-negocio.com/api/webhooks/whatsapp \
    -H "Content-Type: application/json" \
    -d '{"from":"Mateo","role":"Socio","channel":"text",
         "text":"Compramos 20kg de carne a Don José por 180mil"}'
  ```
- [ ] Ir a `/inbox` → debe aparecer el ítem clasificado como **compra**.
- [ ] Aprobar → debe quedar registrada en `/compras` y en activity_logs.

### 11.2. Cierre diario
- [ ] Ir a `/cierres` → **Nuevo cierre** → cargar montos por canal del día.
- [ ] Aprobar → impacta en `/ventas` y en el dashboard del día siguiente.

### 11.3. Factura OCR
- [ ] Ir a `/facturas` → **Subir factura** → adjuntar un PDF/foto real.
- [ ] Esperar 5–15 segundos. La IA debe extraer proveedor, CUIT, ítems, IVA y total.
- [ ] Abrir la factura → **Ver adjunto** → confirmar que abre la URL firmada de Storage.
- [ ] **Aprobar factura** → debe crear `purchase`, actualizar stock y recalcular costos.
- [ ] Revisar `invoice_processing_logs` en Supabase para confirmar pipeline OK.

### 11.4. Deuda + impuesto
- [ ] Ir a `/deudas` → **Registrar deuda** → cargar una real (ej. IIBB de este mes).
  - Acreedor: `ARCA · IVA` o `ARBA · Ingresos Brutos`
  - Categoría: `impuesto`
  - Monto y vencimiento reales
- [ ] Verificar que aparece en filtro **Impuestos** y en **Por vencer** si vence < 7 días.
- [ ] Pagar parcial → saldo recalcula vía trigger.

### 11.5. Export CSV de compras
- [ ] `/compras` → **Exportar compras Excel**.
- [ ] El navegador descarga `compras-YYYY-MM-DD.csv`.
- [ ] Abrir con Excel/LibreOffice. Verificar:
  - Acentos y `ñ` se ven bien (BOM UTF-8 OK).
  - Separador `;` reconocido automáticamente.
  - Columnas: fecha, proveedor, CUIT, tipo, PV, número, subtotal, IVA, otros impuestos, total, medio pago, categoría, estado IA, estado aprobación, adjunto, observaciones.

### 11.6. Export CSV de ventas
- [ ] `/ventas` → **Exportar ventas**.
- [ ] Verificar columnas: fecha, sucursal, canal, medio pago, bruto, descuentos, comisiones, neto, IVA estimado, origen, observaciones.
- [ ] Comisión 22% aplicada en filas de PedidosYa.

### 11.7. Digest matutino (email)
- [ ] Disparar manualmente:
  ```bash
  curl -H "Authorization: Bearer $CRON_TOKEN" \
    https://app.tu-negocio.com/api/cron/digest
  ```
- [ ] Confirmar que llega al email del owner (revisar también spam).
- [ ] El digest incluye: ventas del día anterior, deudas próximas, alertas operativas.

### 11.8. Notificaciones
- [ ] Disparar checks:
  ```bash
  curl -H "Authorization: Bearer $CRON_TOKEN" \
    https://app.tu-negocio.com/api/cron/checks
  ```
- [ ] Ir a `/notificaciones`. Esperado:
  - Si cargaste un impuesto vencido → notificación **roja** "obligación fiscal vencida".
  - Si hay compras sin adjunto → notificación **amarilla**.
- [ ] Probar el dropdown de la campana en el topbar.

### 11.9. Auditoría + roles
- [ ] Loguearse con el rol **accountant** (otro browser / incógnito).
- [ ] Intentar entrar a `/marketing` → debe redirigir a `/sin-permisos`.
- [ ] Volver a logear como **owner** → ir a `/auditoria`.
- [ ] Confirmar que hay registro de:
  - `permission.denied` (el intento anterior del contador)
  - `invoice.approved`, `debt.created`, `purchases.exported`, etc.
- [ ] Exportar CSV de actividad → debe descargar el log completo del período.

---

## Checklist técnico post-deploy

Una vez en producción, verificar **todo lo siguiente** antes de entregar al cliente:

- [ ] El sitio carga en `https://app.tu-negocio.com` con HTTPS válido.
- [ ] `GET /api/cron/checks` con token devuelve `{"mode":"database"}` (no demo).
- [ ] `GET /api/cron/digest` con token devuelve `ok:true`.
- [ ] `POST /api/webhooks/whatsapp` con payload de prueba inserta en `whatsapp_messages` y crea entrada en `/inbox`.
- [ ] Bucket `invoices` en Supabase Storage no es público (`public=false`).
- [ ] RLS habilitado en todas las tablas core:
  ```sql
  select tablename from pg_tables
   where schemaname='public' and rowsecurity=false;
  -- Debe devolver 0 filas (todas con RLS).
  ```
- [ ] Cron de Vercel programado y visible en **Project → Settings → Crons**:
  - `/api/cron/checks` → `0 12 * * *` (9am ARG)
  - `/api/cron/digest` → `0 11 * * *` (8am ARG)
- [ ] En Vercel Hobby el plan acepta 1/día. Para `*/30` migrar a Pro o usar `pg_cron` desde Supabase.
- [ ] Variables `NEXT_PUBLIC_*` están definidas en Production.
- [ ] Variables sensibles (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `CRON_TOKEN`) **no están** en Preview ni Development pública.
- [ ] El último deploy de Vercel está en estado `Ready`.
- [ ] Los 5 invitados (paso 10) pudieron entrar al menos una vez.

---

## Checklist de uso para el dueño / encargado

> Lo que el dueño y el encargado tienen que aprender a hacer **antes** de
> que arranque el piloto. 30–45 min de capacitación.

### Diariamente (5–10 min)
- [ ] Revisar el **digest matutino** (email a las 8am ARG).
- [ ] Abrir `/inbox` y **aprobar / rechazar** los movimientos detectados por IA.
- [ ] Al cierre del día: cargar el **cierre** en `/cierres` (totales por canal).
- [ ] Revisar **notificaciones** (campana).

### Cuando entra una factura
- [ ] Mandar **foto o PDF por WhatsApp** al número del local.
- [ ] Esperar el OCR (~10 seg) → la factura aparece en `/facturas` en estado *Procesando* → *Revisión*.
- [ ] Abrir la factura → verificar ítems → **Ver adjunto** si hay dudas → **Aprobar** o **Editar campos**.
- [ ] Para mandar al contador: botón **Enviar al contador**.

### Cuando entra una compra sin factura
- [ ] Mandar audio o texto por WhatsApp: *"Compramos 10kg de queso a La Serenísima por 84mil"*.
- [ ] Aprobar desde `/inbox`.

### Cuando hay una deuda
- [ ] Si es **impuesto** (IVA, IIBB, Autónomos, Cargas): cargar en `/deudas` con categoría correspondiente y fecha de vencimiento.
- [ ] Si es **proveedor** o **alquiler**: igual, con su categoría.
- [ ] Pagos: botón **Pagar** en la fila → el saldo se recalcula solo.

### Fin de mes (para el contador)
- [ ] `/compras` → **Exportar compras Excel** → mandar al contador.
- [ ] `/ventas` → **Exportar ventas** → mandar al contador.
- [ ] `/empleados` → **Exportar novedades** → para liquidación de sueldos.
- [ ] `/deudas` → **Exportar deudas** → estado actual de obligaciones.
- [ ] `/auditoria` → exportar actividad si el contador la pide.

### Si algo se ve raro
- [ ] No borrar nada. Sacar captura.
- [ ] Mandar a soporte con: usuario, hora aproximada, ruta (`/...`) y qué esperaba ver.
- [ ] `/auditoria` muestra qué hizo cada usuario.

---

## Plan de prueba · 7 días

| Día | Foco | Tareas |
|---|---|---|
| **Día 1 — Lunes** | Setup completo | Pasos 1–10. Smoke tests 1, 2, 8. Dueño + encargado entrenados (45 min). |
| **Día 2 — Martes** | Inbox y WhatsApp | Mínimo 5 movimientos cargados por WhatsApp (compras + cierres). Smoke test 1 con datos reales. |
| **Día 3 — Miércoles** | Facturas reales | Subir 3+ facturas (smoke test 3) con archivos reales del proveedor. Validar OCR + matching de insumos. |
| **Día 4 — Jueves** | Deudas + impuestos | Cargar **todas** las deudas reales del negocio (smoke test 4). Confirmar filtros y vencimientos. |
| **Día 5 — Viernes** | Contador | Generar los 4 exportables (smoke tests 5, 6) y enviar al estudio contable. Recibir feedback. |
| **Día 6 — Sábado** | Volumen alto | Día de mucha venta. Probar la app en mobile durante el servicio. Cierre diario completo. |
| **Día 7 — Domingo** | Review semanal | Revisar `/auditoria` y `/reportes`. Anotar fricciones. Decidir si se continúa o se hace stop & fix. |

### Checkpoints del piloto
- **Día 3 — Checkpoint corto** (15 min con dueño): ¿el WhatsApp + facturas funcionan?
- **Día 7 — Checkpoint largo** (45 min con dueño + encargado + contador): ¿se ahorra tiempo? ¿el contador puede usar los exportables tal cual?
- **Día 14 — Decisión** (sólo si Día 7 fue positivo): continuar al segundo mes o terminar.

---

## Métricas a medir durante el piloto

### Métricas de adopción (medibles desde `/auditoria` y `activity_logs`)

| Métrica | Cómo medirla | Objetivo Día 7 |
|---|---|---|
| Movimientos cargados por WhatsApp | `count(*) from whatsapp_messages` | ≥ 20 |
| Movimientos aprobados desde Inbox | `action='inbox.purchase.approved'` en `activity_logs` | ≥ 15 |
| Facturas subidas | `count(*) from invoices` | ≥ 10 |
| Facturas aprobadas (no rechazadas) | % `status='approved'` sobre total | ≥ 80 % |
| Cierres diarios cargados | `count(*) from daily_closures` | 7 / 7 días |
| Deudas activas registradas | `count(*) from debts where status != 'settled'` | ≥ 5 |
| Exportables generados | `action like '%.exported'` | ≥ 3 |
| Usuarios activos | distinct `actor_id` en `activity_logs` últimos 7 días | ≥ 3 |

### Métricas de calidad

| Métrica | Cómo medirla | Objetivo |
|---|---|---|
| Confianza promedio del OCR | `avg(confidence) from invoices` | ≥ 0.80 |
| % de ítems matcheados con insumos | `count where match_status='matched' / total` | ≥ 70 % |
| Tiempo de procesamiento de factura (p95) | `processing_completed_at - processing_started_at` | < 30 seg |
| Notificaciones disparadas vs ruido | feedback del dueño en checkpoint Día 7 | "útil" en ≥ 80 % |

### Métricas de impacto contable

| Métrica | Cómo medirla | Objetivo |
|---|---|---|
| Tiempo en armar cierre mensual (vs antes) | Cronómetro del contador | -50 % |
| Compras sin adjunto al cierre del mes | filtro `storage_path is null` en invoices del mes | < 10 % |
| Impuestos vencidos sin alerta previa | revisión manual de `debts` categoría `tax` | 0 |
| Errores detectados por el contador | revisión manual | < 3 |

### Métricas técnicas (Vercel + Supabase)

- [ ] **Vercel → Analytics**: ningún error 5xx sostenido durante el piloto.
- [ ] **Supabase → Database → Performance**: queries más lentas < 500 ms p95.
- [ ] **Supabase → Storage**: bucket `invoices` < 80 % del límite del plan.
- [ ] **Vercel → Logs**: cron jobs ejecutándose a su hora todos los días.

---

## Stop & rollback

Si algo crítico se rompe durante el piloto:

- [ ] **Plan A:** revertir el último deploy desde **Vercel → Deployments → Promote a deployment anterior**.
- [ ] **Plan B:** cambiar `NEXT_PUBLIC_APP_MODE=demo` en Vercel y redeploy. La app sigue funcionando con datos mock, los datos reales en Supabase quedan intactos.
- [ ] **Plan C (extremo):** restaurar backup de Supabase desde **Settings → Database → Backups** (las free tier guardan 7 días).

Antes de ejecutar cualquiera de los planes anteriores, asegurarse de que:
- [ ] Hay backup reciente (Supabase los hace diarios, verificar fecha).
- [ ] El dueño está avisado.
- [ ] Se documenta qué se rompió, qué se hizo y qué hay que arreglar antes del próximo intento.

---

## Referencias

- Arquitectura por sprint: `docs/backend-sprint-0.md` → `docs/backend-sprint-3.md`
- OCR + facturas: `docs/ocr-smart-invoices.md`
- Notificaciones / auditoría / permisos: `docs/notifications-audit-permissions.md`
- Realtime / roles: `docs/realtime-roles-multiuser.md`
- Filtrado por sucursal + crons: `docs/branch-filtering-guards-cron.md`
- Checklist resumido legacy: `docs/pilot-checklist.md`
- Página dentro de la app: `/ayuda/piloto`
