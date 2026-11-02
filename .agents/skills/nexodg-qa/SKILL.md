---
name: nexodg-qa
description: Hacer QA funcional y de regresión en NexoDG, con prioridad a onboarding, roles, persistencia y flujos E2E reales.
---
# QA de sistemas reales

Usar para auditorías, pilotos, onboarding, cambios sensibles y validación de releases. Adaptar cobertura al riesgo.

1. Elaborar matriz compacta: recorrido, rol, datos, esperado, estado, evidencia.
2. Validar flujos críticos: alta y login, invitación, recuperación, selección de empresa, creación/edición, persistencia tras relogin y cierre de sesión.
3. Para multi-tenant, intentar acceso cruzado a objetos y APIs entre organizaciones usando identidades de prueba. Verificar RLS/autorización de servidor.
4. Probar errores: formulario inválido, sesión vencida, datos vacíos, API caída, duplicados y red lenta.
5. Validar en mobile cuando el flujo lo requiera. Comprobar navegación, legibilidad, foco y estados accesibles.
6. Ejecutar pruebas de proyecto: lint, tipos, build, unitarias/integración, E2E (Playwright si está configurado), y recopilar salidas.
7. Etiquetar cada caso: PASA, FALLA, BLOQUEADO o NO EJECUTADO. 'Sin prueba' nunca equivale a PASA.
8. Priorizar errores: P0 seguridad/datos/acceso general; P1 flujo crítico bloqueado; P2 operación parcial; P3 visual/menor.

## Salida
Tabla breve de casos, evidencia observada, defectos con pasos para reproducir, severidad y recomendación de go/no-go. No inventar porcentajes de cobertura ni afirmar haber usado navegador sin usarlo.
