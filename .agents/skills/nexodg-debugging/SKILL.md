---
name: nexodg-debugging
description: Investigar bugs, accesos rotos y regresiones en proyectos NexoDG hasta encontrar causa, corrección y prueba de no repetición.
---
# Debugging orientado a causa raíz

Usar cuando un usuario reporta error, flujo bloqueado, regresión o comportamiento errático.

1. Escribir la expectativa y el comportamiento observado; recopilar evidencia accesible (URL, consola, respuestas, logs, commit, navegador y entorno).
2. Intentar reproducir con cuenta de prueba y secuencia mínima. No usar contraseñas reales en logs o scripts.
3. Formar hipótesis y verificarlas de una en una. Revisar redirecciones, auth, cookies, RLS, reglas, API y configuración si son relevantes.
4. Identificar causa raíz o, si no es posible, registrar hipótesis priorizadas y limitación exacta.
5. Corregir el punto causante, no ocultar el error ni introducir redirecciones o permisos inseguros para que 'entre'.
6. Agregar prueba regresiva de la secuencia reportada y una comprobación del camino alternativo más cercano.
7. Ejecutar verificación focalizada y reportar evidencia. Si persiste, no repetir el mismo arreglo sin nueva información.

## Atención especial para accesos
Distinguir login, verificación de email, recuperación, invitación, autorización a empresa, sesión y redirección. Un enlace que termina en la página de login no demuestra por sí solo que la invitación ni el acceso a datos estén bien.

## Reporte
Síntoma → causa confirmada o hipótesis → cambio → prueba observada → riesgo/paso pendiente. Nunca usar "resuelto" sin evidencia del recorrido real.
