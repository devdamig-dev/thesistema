# Integración Fudo — piloto GastroPilot

## Decisión
Fudo será inicialmente un **proveedor externo de datos/operación**. GastroPilot debe tratarlo como adaptador intercambiable, no como dependencia estructural.

## Fuente oficial verificada (2026-11-02)
Fudo publica una API Pública General autogestionada para Plan Pro. La documentación de soporte indica acceso a clientes, descuentos, gastos, ingredientes, ítems, cocinas, pagos, métodos de pago, pedidos, categorías/modificadores/productos, proveedores, roles, salones, ventas, subítems, mesas y usuarios. La API usa OpenAPI 3 y las credenciales pertenecen a un usuario de Fudo con permisos específicos.

Documentación técnica indicada por Fudo: https://dev.fu.do/api
Centro de ayuda: https://soporte.fu.do/es/articles/11939789-api-publica-de-proposito-general

## Fase 1 — discovery y contrato
- Confirmar auth exacta contra documentación OpenAPI.
- Confirmar endpoints, paginación, filtros de fecha, rate limits y renovación de token.
- Definir conjunto mínimo para piloto: products, ingredients, suppliers, orders/sales.
- Clasificar endpoints read-only vs mutaciones.
- No implementar escrituras en esta fase.

## Fase 2 — conexión
Ruta propuesta: `/ajustes/integraciones/fudo`.

La configuración debe:
- requerir owner/admin;
- ser server-side;
- asociar credenciales a `business_id`;
- permitir rotación/revocación;
- nunca devolver secret completo;
- registrar estado: disconnected / validating / connected / error / expired.

## Fase 3 — sincronización read-only
Crear mapeos externos con:
- provider = fudo
- resource_type
- external_id
- business_id
- local_id nullable
- last_seen_at
- source_updated_at nullable
- sync_hash/version

La primera importación no debe escribir movimientos financieros ni de stock propios. Debe poder repetirse sin duplicar.

## Fase 4 — piloto
1. El cliente habilita API Pública General en Fudo (Plan Pro).
2. Crea usuario API de permisos mínimos.
3. Las credenciales se cargan por canal seguro, nunca por chat/issue.
4. Test de conexión.
5. Sync read-only.
6. Comparar conteos/totales de una ventana acordada.
7. Habilitar dashboard/IA sobre datos importados.
8. Documentar discrepancias y go/no-go.

## Riesgos
- Token por defecto con vencimiento de 24h: confirmar renovación oficial antes de automatizar.
- Permisos del usuario Fudo determinan visibilidad.
- Cambios de schema/API requieren adapter versionado.
- No asumir que un 200 significa datos completos; reconciliar conteos y rangos.
- No mezclar IDs Fudo con IDs internos.
- Integridad de IDs: si Fudo devuelve un ID numérico JSON fuera del rango entero seguro de JavaScript o fraccionario, rechazar la página con error sanitizado antes de hacer upsert o avanzar el cursor. Los IDs largos son válidos **como strings**. Sin esto, dos IDs distintos podrían colisionar por redondeo. Requiere contraste con datos reales del piloto.


## Invariante de importación: página y paginación válidas antes de staging

Una respuesta HTTP 200 no es una página importable por sí sola. El test inicial de conexión y el diagnóstico por recurso también verifican el `links.next` de la primera página, para no reportar un falso positivo que falle al importar. Antes de insertar snapshots o actualizar `last_seen_cycle_id`, el importador valida tanto los registros e IDs como los metadatos JSON:API de paginación (`links.next`, página actual, límites). Si el proveedor devuelve una página con registros válidos pero un siguiente enlace malformado, el recurso falla sin añadir staging ni avanzar su cursor. El resto de recursos puede cerrar sus lecturas iniciadas; la ejecución global queda en estado fallido con un código sanitizado y **no modifica el proveedor ni ventas/stock nativos**. Repetir el intento no debe duplicar datos. Esta garantía se verifica con fixtures y aún necesita contraste en el piloto con Fudo real.

## O1 — Integridad del enlace de continuación de paginación

El importador continúa usando **únicamente GET al endpoint Fudo permitido**, sin seguir links del proveedor. Un `links.next` no vacío no es suficiente para acreditar continuidad: el adaptador solo soporta paginación por número, por lo que verifica que el enlace use HTTPS de `api.fu.do`, indique exactamente un parámetro `page[number]` (o `page`) y apunte a la página inmediatamente siguiente. Rechaza links malformados, de otra procedencia, de cursor, repetidos, saltos de página y credenciales embebidas; el error es fijo/sanitizado y no incluye la URL. Esta validación ocurre junto con la del cuerpo **antes** de modificar staging o cursor. Cuando Fudo use otro contrato de paginación, debe adaptarse expresamente y verificarse con una cuenta autorizada: no asumir una importación completa por un link no interpretable.

Pruebas del contrato: links absolutos/relativos válidos, salto/repetición, duplicados, cursor y origen ajeno. **No validado todavía contra una conexión Fudo real.**

### Parámetros de continuación no reproducibles (PR #195; publicado)

La sincronización construye su propio GET con `page[number]` y `page[size]`; no sigue la URL provista por Fudo. Un enlace `links.next` con filtros, cursores, offsets, fragmentos o cualquier parámetro extra no soportado **no puede interpretarse como continuidad válida**: esos criterios se perderían al pedir la siguiente página. El parser sólo admite `page[number]` o `page` y un `page[size]` opcional, sin duplicados. De lo contrario rechaza la página con error sanitizado antes de upsert de staging o avance de cursor. El control inicial de #195 aceptaba tamaños menores al solicitado aunque el importador seguía consultando con su tamaño fijo; el PR posterior de consistencia cierra esa brecha.

La regla inicial está cubierta por fixtures sintéticos en [PR #195](https://github.com/devdamig-dev/thesistema/pull/195), integrado a main (`86d02e10`) con [Quality #41835366420](https://github.com/devdamig-dev/thesistema/actions/runs/41835366420) verde (verify/Playwright, PostgreSQL 17 y PostgREST), [Vercel Production READY](https://vercel.com/damians-projects-a45d01bf/thesistema/2WT9buSBnxLRFVMKvh4auiis9VJe) y alias `gastropilot.nexodg.com` confirmado. No se validó con Fudo real.

### Consistencia de `page[size]` entre páginas (PR de seguimiento; QUALITY pendiente)

El adaptador solicita un tamaño fijo de 100 para la sincronización y 1 para el test y el diagnóstico. No basta con que el `page[size]` de `links.next` sea numérico y menor que 100: si ese tamaño es distinto al solicitado, la siguiente petición con el tamaño fijo podría saltear registros o afirmar una importación completa falsa. El parser lo rechaza **antes de persistir la página o el cursor**, comparándolo con el tamaño realmente solicitado en cada flujo. El error es sanitizado y no incluye el enlace.

Esto es conservador: si Fudo limita el tamaño efectivo y devuelve un enlace con tamaño menor al solicitado, la sincronización quedará bloqueada para ese recurso hasta implementar, persistir y probar un tamaño efectivo estable por ciclo y por `business_id`. No normalizar ni aceptar silenciosamente hints de tamaño contradictorio. Pruebas sintéticas positivas/negativas; CI y proveedor real aún pendientes.

No afirmar compatibilidad real hasta importar una cuenta autorizada; si Fudo emite parámetros legítimos adicionales, extender expresamente el adaptador y sus pruebas.


### Continuación vinculada al recurso (CI y despliegue publicados; piloto real pendiente)

Los enlaces `links.next` de un recurso solo pueden apuntar a **ese mismo recurso**. Estar en `api.fu.do` no es suficiente: un enlace de productos a pedidos, aunque contenga la siguiente página numérica, se rechaza como `invalid_fudo_page` **antes de guardar staging o cursor**. El cliente sigue leyendo únicamente la URL fija del recurso solicitado; jamás sigue el enlace externo. La comprobación se aplica a conexión, preflight y sincronización. Soporta rutas `/v1alpha1/<recurso>` o `/<recurso>` (y continuaciones relativas `?page=`). Otros formatos deben evaluarse con una cuenta real y un cambio de adaptador explícito, sin desactivar el modo fail-closed.

Estado a 04/11/2026: [PR #192](https://github.com/devdamig-dev/thesistema/pull/192) fusionado a main (`93bb5269`) y [Quality #41816442684](https://github.com/devdamig-dev/thesistema/actions/runs/41816442684) `completed/success`. El intento directo de publicar #192 fue bloqueado temporalmente por la cuota gratuita de Vercel (HTTP 402), **pero la versión final que incorpora el cambio ya se encuentra en producción**: [PR #193](https://github.com/devdamig-dev/thesistema/pull/193) integrado (`29f6dded`), [Quality #41825488817](https://github.com/devdamig-dev/thesistema/actions/runs/41825488817) verde (verify con Playwright, PostgreSQL 17 y PostgREST) y [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/D7L1RqtXkEBPX8FfoR92ENm47FQ8) `READY` con alias `gastropilot.nexodg.com` confirmado. #193 estabilizó además el test AES-GCM modificando un byte real del tag, en lugar de caracteres finales de base64url que podrían no modificar los bytes. No se cambiaron las funciones criptográficas, esquema, secretos ni datos operativos. **VALIDADO CON FUDO REAL: NO**: aún faltan sesión autenticada, cuenta autorizada, sincronización de cinco recursos, conciliación y aislamiento multiempresa E2E.



## O1 — Diagnóstico de permisos previo al piloto (03/11/2026)
- Acción **Revisar permisos de importación**: sólo owner/admin con membresía activa puede ejecutarla; las credenciales se recuperan cifradas del servidor, ligadas al `business_id`.
- Ejecuta GET de muestra (página 1, tamaño 1) en productos, ingredientes, proveedores, pedidos y ventas, sin persistir datos de proveedor, registrar resultados crudos ni crear movimientos nativos.
- Para cada recurso indica solamente `available`, `forbidden`, `invalid_credentials`, `api_unavailable`, `rate_limited`, `provider_unavailable` o `invalid_response`. Un HTTP 200 con esquema incompatible no acredita acceso utilizable.
- La autenticación se inicia una vez por diagnóstico; la consulta de cinco recursos es paralela para respetar límites de duración del servidor.
- El cliente Fudo usa `redirect: "error"` tanto en el POST de autenticación como en GETs de lectura, para no redirigir secretos/tokens a otro destino.
- Si un segundo administrador rota o desconecta Fudo durante las cinco lecturas, la comprobación del `connection_generation` actual invalida el diagnóstico anterior, devuelve cero checks y pide repetirlo sobre la conexión vigente. No se leen secretos para verificar la generación ni se reportan permisos obsoletos. Esto requiere QA de regresión y todavía no prueba un proveedor real.
- Ningún resultado del diagnóstico equivale a conciliación completa, permisos de otras operaciones o validación con datos reales. La aplicación no realiza ninguna escritura en la API Fudo.
- QA requerida: owner/admin, denegación por rol y membresía, A/B con distintas claves, caso 403/404/error temporal, redirecciones y esquema inválido. Validar en la cuenta piloto real una vez que se conecte.

## O1 — Avance visible de la importación (03/11/2026)

- El resumen owner/admin incorpora estado de cursor para cada recurso de la conexión actual: **Sin iniciar**, **Pendiente: página N** o **Ciclo leído**.
- Los cursores se leen únicamente en el servidor, filtrados por `business_id` y `connection_generation`; el cliente no recibe identificadores externos, registros crudos ni credenciales.
- **Ciclo leído** sólo indica que el cursor de esa importación llegó al final; todavía se deben comparar totales, integridad y permisos con la cuenta Fudo del piloto.
- La interfaz no hace nuevas llamadas al proveedor ni modifica Fudo; el reporte ayuda a detectar cuál de los cinco recursos necesita otra tanda.

## O1 — Conciliación de presencia por ciclo (publicada; pendiente de piloto real)

La tabla de staging conserva IDs vistos en importaciones anteriores. Un nuevo escaneo de Fudo no demuestra que los registros históricos sigan presentes en origen; tampoco permite concluir que hayan sido eliminados si un recurso sólo se leyó parcialmente.

- `fudo_sync_progress.cycle_id` identifica con UUID estable la lectura completa por `business_id`, `connection_generation` y recurso; `cycle_started_at` queda como fecha informativa. Cada snapshot almacena `last_seen_cycle_id`. Se conserva el UUID al continuar páginas y reintentos. Ante cursores históricos sin UUID, el estado se trata como **no verificable**, sin inventar identidad. El criterio por UUID evita falsos positivos por desfases de reloj entre funciones serverless.
- La pantalla separa **Guardados** (histórico), **Vistos en ciclo** y **Posibles ausencias**. Una ausencia sólo se informa cuando el recurso tiene cursor completo (`next_page=0`) **y la última ejecución finalizó como `completed` o `partial`**. Si sigue `running`, terminó `failed` o no existe una ejecución verificable, la comparación queda **Pendiente** aunque exista un cursor en página 0 (por ejemplo, ante un cierre serverless incompleto). Significa *no fue visto en ese escaneo*, NO una baja definitiva del proveedor.
- No se borra staging, ni se ejecutan escrituras sobre Fudo, ventas, stock o pedidos de GastroPilot. Los conteos sirven para preparar una conciliación manual con el negocio piloto, no para certificar paridad.
- Al iniciar un nuevo ciclo, la comparación debe volver a estar pendiente hasta completar la paginación. La primera sincronización real del piloto debe contrastar fuente, ventana, permisos y conteos por recurso.
- La migración aditiva `20261103230000_fudo_cycle_reconciliation.sql` fue aplicada a Supabase antes del despliegue de la app el 04/11/2026; columnas y ACL verificadas. El importador necesita este esquema para habilitar los nuevos conteos.
- Rollback: revert de la app; conservar columna nullable e índice hasta una migración de rollback separada y revisada. No efectuar cambios sobre datos de cliente durante el rollback.

Estado: **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN / FUDO REAL NO VALIDADO**. PR [#181](https://github.com/devdamig-dev/thesistema/pull/181); [Quality](https://github.com/devdamig-dev/thesistema/actions/runs/41758111534) y [Vercel READY](https://vercel.com/damians-projects-a45d01bf/thesistema/DgsjpVyP9amJ2FZtiZa4XRuJa7BA). Ver issue O1 [#180](https://github.com/devdamig-dev/thesistema/issues/180).

## O1 — Protección del reporte ante rotación concurrente (publicada; 04/11/2026)

Un segundo owner/admin puede rotar o desconectar Fudo mientras se consultan el historial y los conteos de staging. Una lectura inicial de `connection_generation` no basta para garantizar que el resumen mostrado corresponde a la conexión todavía vigente.

El resumen revalida `business_id + connection_generation` al terminar las consultas de agregados. Si cambió la generación, desapareció la conexión o falló la revalidación, devuelve un estado no verificable en lugar de presentar historial de credenciales anteriores como actual. No consulta ciphertext en la revalidación, no altera datos, no invoca Fudo y conserva el alcance owner/admin.

Pruebas sintéticas agregadas: rotación y desconexión durante la lectura de cursores, además de los casos existentes de datos del tenant y generación actual. Estado: **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO / NO VALIDADO CON FUDO REAL**. [PR #184](https://github.com/devdamig-dev/thesistema/pull/184) integrado a main `04d212edaeb6118d511870248e01d90b65d1265a`; [Quality](https://github.com/devdamig-dev/thesistema/actions/runs/41771404982) completo en verde (verify, PostgreSQL 17 y PostgREST), [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/6uzLDUNh4vgwf3Hsh47hCQCpLTGc) READY con alias `gastropilot.nexodg.com`. Sin migración, sin escrituras hacia Fudo. Sigue pendiente la cuenta autorizada y la conciliación E2E.
