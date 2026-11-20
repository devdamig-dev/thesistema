# Prioridad actual para agentes

## Entrega solicitada por el propietario — 10/11/2026

**Foco inmediato: planes de IA e integración de pagos, issue #164.** El propietario pidió avanzar fuertemente este circuito; no volver a detener esta entrega por la falta de credenciales Fudo.

Seguir `docs/ai-billing-rollout.md`: primero créditos realmente consumibles y checkout/verificación sandbox; después habilitación comercial, renovaciones y conciliación con evidencia. No activar cobros reales ni aplicar migraciones a clientes sin el gate de publicación. Un pago sandbox jamás habilita créditos reales.

**O1 de `ROADMAP.md` sigue abierto:** integración Fudo para piloto. No declararlo terminado ni modificar su operación. Mantener Fudo read-only; la falta de cuenta autorizada no bloquea el trabajo independiente de billing solicitado.

Todo agente que trabaje en GastroPilot debe:
- leer `AGENTS.md`, `QUALITY_GATE.md`, `ROADMAP.md` y el issue del objetivo elegido;
- inspeccionar código real y continuar desde el último criterio incompleto;
- implementar en rama/PR y registrar evidencia, sin duplicar revisiones vacías;
- distinguir IMPLEMENTADO / PROBADO / DESPLEGADO / VALIDADO EN PRODUCCIÓN;
- no usar credenciales de clientes en texto, commits, logs o fixtures;
- conservar roles, aislamiento por negocio, idempotencia y hard caps de consumo;
- mantener Fudo read-only hasta autorización expresa de otro alcance.

## Norte del producto
El destino final NO es convivir con Fudo. GastroPilot debe reemplazarlo como sistema gastronómico todo-en-uno dentro del alcance definido. Toda integración con Fudo es transitoria y debe facilitar migración, aprendizaje y continuidad operativa mientras se construyen módulos nativos.
