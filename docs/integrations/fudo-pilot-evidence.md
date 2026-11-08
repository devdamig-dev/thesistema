# GastroPilot O1 — Acta de evidencia y decisión GO/NO-GO para piloto Fudo

**Estado inicial: NO-GO.** Esta plantilla registra pruebas, no valida una instalación por sí sola. Fudo funciona exclusivamente como **origen read-only**; el objetivo final es reemplazar Fudo con los módulos nativos de GastroPilot, no depender de él.

Referencia canónica: [ROADMAP.md](../../ROADMAP.md), [issue O1 #162](https://github.com/devdamig-dev/thesistema/issues/162), [issue de conciliación #180](https://github.com/devdamig-dev/thesistema/issues/180) y [runbook Fudo](fudo-pilot.md).

## Preparación sin compartir secretos

1. Confirmar, fuera del repositorio, autorización del negocio piloto y acceso Fudo **Plan Pro con API Pública General habilitada**. El usuario técnico del proveedor debe tener permisos mínimos de lectura para `products`, `ingredients`, `providers`, `orders` y `sales`.
2. Usar una sesión owner/admin real en GastroPilot y acceder a `/ajustes/integraciones/fudo`. El negocio introduce API Key y Secret **en el formulario autenticado**, no por chat, captura, correo, ticket, logs, commit o fixture.
3. Tener dos negocios de QA segregados (**A/B**) y perfiles owner/admin y empleado. El gate read-only de PostgREST debe exigir **HTTP 403** para la denegación de tablas Fudo con token autenticado de A/B; un **HTTP 401** indica sesión/credencial no acreditada y **NO** pasa QA. Para la solicitud anónima se admite 401 o 403. Los tests sintéticos no sustituyen la ejecución manual del workflow con dos sesiones reales. No utilizar datos de otras empresas para fabricar una prueba positiva. No modificar ventas, stock, pedidos, caja ni información comercial nativa.
4. Conservar evidencias de ejecución en un almacenamiento interno restringido. En el issue público registrar solo fecha, ambiente, versión/commit, códigos de resultado, conteos agregados y enlaces a evidencia autorizada. **Nunca** incluir token, ciphertext, API Key, API Secret, payload bruto, datos personales, emails, teléfono ni external IDs de clientes.

## Secuencia verificable

| Paso | Acciones y condición de aprobación | Evidencia segura | Estado |
| --- | --- | --- | --- |
| 1. Acceso | Owner/admin de A ve Fudo; empleado y usuario de B no pueden administrar la conexión de A. Probar denegación de acciones del servidor, no solo ocultar botones. | Rol, resultado permitido/denegado, captura sin datos sensibles | **NO EJECUTADO** |
| 2. Conexión | Conectar Fudo desde A, probar credenciales y verificar que los secretos no aparecen en respuestas de navegador o logs. Confirmar rotación/retest sin exponer la clave. | Resultado sanitizado, hora y commit | **NO EJECUTADO** |
| 3. Cinco permisos | Ejecutar **Revisar permisos de importación**. Documentar el resultado individual de los cinco recursos y diferenciar `forbidden`, `invalid_credentials`, `api_unavailable`, `provider_unavailable`, `rate_limited` y `invalid_response`. Un 200 o check verde no certifica conciliación. | Tabla de estados por recurso, sin payload | **NO EJECUTADO** |
| 4. Primer ciclo | Ejecutar importación read-only, repetir las tandas hasta `next_page=0` para cada recurso y confirmar última ejecución `completed`. Revisar estados, errores, paginación y persistencia aislada por `business_id` + generación. No ejecutar ninguna operación mutante hacia Fudo. | Fecha, estado, cursores, cantidades y errores sanitizados | **NO EJECUTADO** |
| 5. Conciliación | Comparar fuente Fudo y staging de A para la **misma ventana y permisos**; registrar totales e IDs por vía interna segura, incluyendo diferencias explicadas. `importedCounts` histórico no equivale a cantidad actual de Fudo. | Cinco pares de conteos y diferencias agregadas | **NO EJECUTADO** |
| 6. Segundo ciclo | Repetir el escaneo completo con igual cuenta y alcance. Comprobar ausencia de duplicados por `business_id + generation + resource_type + external_id`; separar vistos y posibles ausencias. Un recurso parcial/fallido nunca acredita una baja. | Conteos primera/segunda pasada, anomalías | **NO EJECUTADO** |
| 7. Aislamiento y revocación | Verificar desde sesiones reales A y B: ningún reporte, cursor ni credencial cruza negocios; revocar rol/desactivar perfil durante lectura y constatar resultado denegado. Probar desconexión y rotación cuando no haya run en curso. | Casos positivos/negativos y resultado sin secretos | **NO EJECUTADO** |
| 8. Operación existente | Revisar con el responsable que Fudo conserva control de salón, pedidos, ventas, stock y caja. GastroPilot no genera escrituras a la API Fudo ni altera operaciones nativas como efecto de importación. | Confirmación operativa y auditoría permitida | **NO EJECUTADO** |

## Registro de conciliación — completar únicamente con datos agregados

| Recurso Fudo | Fuente (misma ventana) | Staging visto en ciclo | Histórico staging | Diferencia explicada | Resultado |
| --- | ---: | ---: | ---: | --- | --- |
| products | pendiente | pendiente | pendiente | pendiente | NO EJECUTADO |
| ingredients | pendiente | pendiente | pendiente | pendiente | NO EJECUTADO |
| providers | pendiente | pendiente | pendiente | pendiente | NO EJECUTADO |
| orders | pendiente | pendiente | pendiente | pendiente | NO EJECUTADO |
| sales | pendiente | pendiente | pendiente | pendiente | NO EJECUTADO |

Registrar internamente la zona horaria y ventanas comparadas, límites de API y permisos de cada recurso. La comparación no debe ocultar devoluciones, bajas, actualizaciones, cambios de paginación ni errores. Si un dato no está disponible, anotarlo como **no verificado**, nunca como cero.

## Salida y rollback

- **GO para piloto read-only**: todos los pasos aplicables ejecutados con evidencia, cinco recursos conciliados o discrepancias aceptadas explícitamente, segunda importación idempotente, roles A/B y no-mutations comprobados, UI de errores y recuperación funcionales. Aprobación explícita del negocio y responsable de QA.
- **NO-GO**: cuenta API no disponible, permiso incompleto, divergencia no explicada, falla de aislamiento, secretos expuestos, sync incongruente o QA no ejecutado. Mantener O1 activo y registrar bloqueo concreto en #162/#180.
- **Reversión segura**: si corresponde, desconectar desde la UI con owner/admin cuando no existe un run activo; verificar que se revocan las credenciales de GastroPilot pero se conserva el staging histórico para auditoría. No borrar registros ni revertir migraciones sobre datos reales sin plan aprobado.
- **Estados de entrega separados**: `IMPLEMENTADO` (código incorporado), `PROBADO` (CI/fixtures), `DESPLEGADO` (SHA de Vercel READY) y `VALIDADO EN PRODUCCIÓN` (sesiones y fuente Fudo reales verificadas). Nunca inferir el cuarto a partir de los tres anteriores.

Fecha de ejecución: **PENDIENTE**. Commit desplegado evaluado: **PENDIENTE**. Responsable del negocio/QA: **PENDIENTE**. Decisión: **NO-GO**.
