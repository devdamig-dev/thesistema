---
name: nexodg-release
description: Preparar y verificar publicaciones seguras a staging y producción de sistemas NexoDG, con puertas de calidad y rollback.
---
# Release controlado

Usar para publicar, preparar pilotos, desplegar ramas o cerrar entregas.

1. Precisar destino (preview/staging/producción), versión/commit y diferencias de configuración.
2. Revisar changelog, migraciones, variables, permisos, dependencias y compatibilidad de datos.
3. Ejecutar controles configurados; bloquear el avance si faltan verificaciones críticas o hay defectos P0/P1.
4. Para producción: preparar reversión y respaldo si hay cambios de esquema/datos; evitar ejecutar migraciones destructivas sin aprobación.
5. Hacer deploy mediante el pipeline o integración autorizada y guardar ID/URL verificable. No inventar métricas.
6. Hacer smoke tests desde el entorno realmente desplegado: carga, login, sesión, lectura/escritura mínima de prueba, permisos y flujo clave del cambio.
7. Registrar estado por separado: implementado, probado, desplegado, validado en producción.

## Entrega
Ambiente; versión; controles ejecutados; resultado de smoke tests; rollback disponible; pendientes y decisión go/no-go. Si no hay acceso para desplegar, dejar artefacto listo y marcar DESPLIEGUE PENDIENTE.
