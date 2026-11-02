---
name: nexodg-feature-delivery
description: Diseñar e implementar funcionalidades completas en sistemas NexoDG, desde criterios de aceptación hasta verificaciones técnicas.
---
# Entrega de funcionalidades

Usar para nuevas funcionalidades o modificaciones funcionales con impacto real. No usar para un cambio puramente cosmético.

1. Descubrir la arquitectura relevante, modelos de datos, roles, componentes, contratos de API y pruebas existentes. Inspeccionar solo lo necesario.
2. Definir el flujo de usuario, criterios de aceptación observables y los casos felices, de error y de acceso denegado.
3. Marcar las fronteras del cambio: UI, servidor, datos, validación, permisos, auditoría y proveedor externo cuando aplique.
4. Implementar la solución mínima completa y consistente con el proyecto. No dejar funcionalidades aparentes ni mocks silenciosos en recorridos productivos.
5. Agregar o actualizar pruebas al nivel apropiado. Si no hay infraestructura de test, crear una prueba reproducible básica cuando sea viable y documentar lo faltante.
6. Verificar resultados reales: comandos ejecutados, evidencia, estados de error, persistencia y roles relevantes.
7. Entregar resumen con estados separados: implementado, probado, desplegado y validado en producción.

## Guía de aceptación
- ¿El usuario correcto puede completar el recorrido sin ayuda de un desarrollador?
- ¿Los datos se guardan y persisten entre sesiones?
- ¿Un usuario incorrecto está bloqueado por backend y no solo por la UI?
- ¿Se comporta bien ante datos faltantes, cortes de red y errores del proveedor?
- ¿Se mantiene el funcionamiento existente?

**No inventar** comandos, rutas, evidencias de test o capturas. No cambiar producción sin evaluar riesgo.
