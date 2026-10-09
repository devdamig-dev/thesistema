# QA local de gestión: Stock, Clientes y Proveedores

## Estado de esta entrega

Se validaron la sintaxis, el lint, los tests de contrato de los fixtures y la compilación de los tres bundles con `BUNDLE_ONLY=1`. No se abrió un servidor ni se ejecutó Chromium u otro navegador en este entorno. Las secuencias de interacción y las comprobaciones de layout están preparadas, pero **no constituyen QA visual ni pruebas browser aprobadas** hasta ejecutarlas en un entorno compatible.

## Comandos seguros sin navegador

Desde la raíz del repositorio, con las dependencias ya instaladas:

```sh
npm run build # Emite los assets locales de Inter requeridos por los fixtures
node --test tests/management-ui-fixtures.test.mjs
BUNDLE_ONLY=1 node scripts/run-customers-ui.mjs
BUNDLE_ONLY=1 node scripts/run-suppliers-ui.mjs
BUNDLE_ONLY=1 node scripts/run-stock-ui.mjs
```

Cada comando de bundle genera `app.js`, `index.html`, el CSS real de `app/globals.css` mediante Tailwind, `bundle-metafile.json` y `bundle-result.json`. La salida confirma `browserExecuted: false`. La rama `BUNDLE_ONLY` termina antes de crear servidor o importar/lanzar Playwright.

## Ejecución browser pendiente

Sólo en un entorno que permita servidor loopback y el Chromium provisto por Playwright:

```sh
node scripts/run-customers-ui.mjs
node scripts/run-suppliers-ui.mjs
node scripts/run-stock-ui.mjs
```

No se define `executablePath`, no se instala un navegador desde los scripts y no se usan opciones para evadir restricciones del entorno. Si falta Chromium, usá el mecanismo autorizado del entorno; no intentés ejecutarlo donde el acceso ya fue denegado.

Cada harness ejecuta sus secuencias a 1440×1000 y 390×844. Guarda capturas locales y `browser-result.json` bajo `.test-artifacts/customers-ui/`, `.test-artifacts/suppliers-ui/` o `.test-artifacts/stock-ui/`. Una nueva ejecución limpia sus propios artefactos previos para no confundir un resultado viejo con el actual. Los artefactos están ignorados por Git.

El reporte browser sólo marca éxito cuando concluyeron todas sus comprobaciones. Un `pageerror`, una solicitud de red fuera de los assets loopback, una aserción o un error de lanzamiento provoca salida no exitosa. El bloque `finally` cierra contexto, browser y servidor, incluso ante fallo. Las capturas no sustituyen la inspección visual humana.

## Cobertura preparada

- Clientes: alta, datos ficticios, edición con versión vigente, archivo reversible, restauración, cancelación/reapertura limpia, doble activación, cierre bloqueado durante guardado, respuesta incierta con verificación y acceso de lectura.
- Proveedores: alta con ID estable, edición con versión, archivo/restauración, compras visibles de un proveedor archivado, cancelar/reabrir, doble activación, cierre bloqueado y recuperación de alta incierta desde `sessionStorage` sin duplicar. Lectura conserva consulta de compras y oculta mutaciones.
- Stock: motivo obligatorio, kg/g, l/ml y unidades sin conversión incompatible; cancelar/reabrir limpia borrador; doble activación, cierre durante guardado, rechazo por existencias insuficientes, corrección a cero y respuesta incierta después de persistir. Historial comprueba cantidad original, variación, saldos, origen, responsable, legacy sin datos inventados, filtros, páginas, vacío y recuperación de error. Lectura impide registrar y permite consultar.
- Layout: documento/body y editor sin desborde horizontal en desktop y 390 px. Se permite scroll horizontal interno en tablas diseñadas para eso; no se oculta el overflow mediante CSS de prueba.

## Aislamiento y alcance

Se montan componentes reales: `CustomersClient`, la página de Proveedores con `SupplierForm` y `StockPage`, más sus componentes UI reales. Sólo las acciones de servidor y `next/link` se sustituyen. Los mocks viven en `scripts/ui-fixtures/`; nombres, contactos `example.invalid`, UUID y movimientos son ficticios y no salen del proceso/browser local.

No se leen `.env`, no se necesitan credenciales y no se invocan Supabase, Meta, endpoints externos ni producción. El bundle falla si incluye acciones de producción o módulos Supabase; cualquier acción nueva sin fixture falla al compilar. El servidor sólo entrega assets conocidos por GET, y el contexto bloquea otras solicitudes. `sessionStorage` se limita a un contexto Playwright temporal.

Los fixtures simulan permisos y persistencia para comprobar decisiones del cliente. No reemplazan tests de RLS, RPC, transacciones, autenticación ni rutas Next completas. Los tests Node agregados validan los propios fixtures; una pasada de éstos no demuestra que las interacciones Playwright hayan corrido.

## QA conjunta de integración

La rama `qa/management-integrated-20261009` reúne los incrementos exclusivamente
para comprobar su compatibilidad. No reemplaza los PR separados ni autoriza un
merge o migraciones. El commit de QA tiene como único padre el main oficial; no
publica el historial local de integración ni el documento de seguimiento privado.

El workflow `Quality` ejecuta los tests TypeScript, los 11 contratos de fixtures,
typecheck, lint, build y seis suites UI: Catálogo, Clientes, Proveedores, Stock,
Deudas e Inbox de deudas. Todas usan Inter del build actual y sólo assets loopback.
Los bundles rechazan acciones de servidor y módulos Supabase reales; el fixture
Inbox reemplaza el hook de presencia por uno que falla si se intenta ejecutar.
Esto no valida presencia, autenticación ni comunicaciones con proveedores reales.

Las cinco suites SQL aplican las 59 migraciones reales tanto en PGlite como en
PostgreSQL 17. El segundo job resuelve el digest de la imagen oficial postgres:17,
crea contenedores efímeros con red `none`, sin puertos ni montajes de datos del
host, con TCP apagado y socket privado. El cliente Docker usa sólo el socket local
y configuración temporal; no hereda contextos, credenciales ni conexiones libpq.
Deudas y pendientes WhatsApp ejercitan sesiones independientes y exigen observar
que la segunda sesión esperó un lock, además de comprobar el resultado final.

Las capturas de drawers fijos usan el viewport; las tablas pueden tener scroll
interno. GitHub conserva capturas y reportes JSON durante siete días. Inspeccionar
los píxeles además de las aserciones antes de declarar aprobada la QA visual.
`npm run test:ui:bundle` no ejecuta browser. `npm run test:db:native` requiere Docker
local compatible y nunca debe intentarse en un entorno donde fue denegado.
