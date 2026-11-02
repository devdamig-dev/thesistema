# GastroPilot — puerta de calidad

Consultar `docs/ENGINEERING_STANDARDS_ADOPTION.md` y `docs/gastropilot-ai-pilot-qa-20261029.md`. Una pantalla operativa no equivale a un flujo funcional validado.

## Por cada cambio
- [ ] Criterio de aceptación explícito y verificable.
- [ ] Test/s apropiados al área modificada; regressión para bugs.
- [ ] `npm run typecheck`, `npm run lint` y `npm run build` ejecutados si el cambio lo requiere, o bloqueo justificado.
- [ ] Considerar `npm test` y suites SQL/Playwright existentes; evidencia en el PR.
- [ ] Auth, sesión, invitación, membresía, roles y RLS entre organizaciones/sucursales verificados cuando aplique.
- [ ] Movimientos de stock/dinero/ventas protegidos frente a doble envío, error y concurrencia.
- [ ] Integraciones IA/WhatsApp verificadas con entorno de test o etiquetadas claramente no probadas.
- [ ] Responsive y estados vacíos/error revisados si hay UI.
- [ ] Seguridad, migración y rollback evaluados antes de publicación.

## Entrega
| Estado | Confirmación | Evidencia |
| --- | --- | --- |
| IMPLEMENTADO | | |
| PROBADO | | |
| DESPLEGADO | | |
| VALIDADO EN PRODUCCIÓN | | |

Los tests declarados aquí no se consideran corridos. No solicitar credenciales en texto plano ni fabricar un E2E con datos reales de clientes.
