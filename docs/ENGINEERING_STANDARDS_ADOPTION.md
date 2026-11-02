# NexoDG Engineering Standards v1.0 — GastroPilot

## Propósito
Aplicar la misma disciplina de ingeniería de Waneia, Gongo y Nexo Core **sin fusionar infraestructuras** ni modificar operativa en este PR. GastroPilot continúa en su propio repositorio y su propio stack.

## Orden de trabajo
1. Leer `AGENTS.md` y `PROJECT_CONTEXT.md`.
2. Inspeccionar el módulo, contratos SQL, APIs, roles y pruebas existentes. Definir resultado observable.
3. Elegir la Skill de ingeniería apropiada en `.agents/skills/`.
4. Implementar y verificar todos los niveles necesarios; incluir casos negativos y regresiones.
5. Ejecutar lo relevante de `.github/workflows/quality.yml` (no duplicar pipeline ni afirmar tests no ejecutados).
6. Abrir PR con resultados, riesgos, criterios y estado detallado; publicar solo con el gate correspondiente.

## Recorridos de aceptación por producto
- **Primer ingreso:** registro, confirmación, activación de empresa, invitación, roles y persistencia al cerrar/reabrir sesión.
- **Operación gastronómica:** creación de producto/receta, compra, ingreso/movimiento de stock, venta/pedido, ajuste y cierre; cantidades consistentes y sin cobros duplicados.
- **Negocio y sucursales:** probar usuarios de diferentes organizaciones y scopes de sucursal; acceso cruzado denegado en RLS/servidor.
- **WhatsApp:** distinguir integración Meta conectada, fuentes pasivas read-only, grupos soportados, chat interno y permisos reales. Webhooks/idempotencia y ausencia de ejecuciones de herramientas en fuentes pasivas.
- **IA:** confirmar proveedor, modelo, cuota/configuración, errores y respuestas con evidencia real, o marcar como NO CONFIGURADO/NO VERIFICADO.
- **Mobile:** navegación, inputs, estados de error y recuperación.

## Calidad automatizada existente
El repo ya cuenta con `.github/workflows/quality.yml` y tests para interfaz, lógica, PostgreSQL y PostgREST. Este PR no modifica esos tests ni runners. Consultar la ejecución del commit actual antes de decir que un cambio pasó QA. Si los workflows fallan por cuota/facturación, señalarlo y ejecutar verificaciones locales comprobables.

## Estado de esta adopción
Solo archivos de instrucciones, Skills, plantillas y criterios QA. No se modifica lógica de negocios, esquema de datos, frontend, deploy ni variables. **No implica que GastroPilot haya pasado QA productivo.**
