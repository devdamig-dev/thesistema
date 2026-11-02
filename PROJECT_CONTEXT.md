# GastroPilot AI — contexto técnico verificado en el repositorio

- **Repositorio:** `devdamig-dev/thesistema`.
- **Producto:** plataforma SaaS de gestión gastronómica y canales operativos (pedidos, stock, compras, ventas, clientes, equipo, IA/WhatsApp según configuración).
- **Stack en main inspeccionado:** Next.js 16, React 19, TypeScript, Supabase (Auth/PostgreSQL/RLS); Playwright y Node test.
- **CI existente:** `.github/workflows/quality.yml`. Incluye lint, types, build, pruebas JS/TS, PostgreSQL y UI; verificar siempre ejecución y resultado del commit vigente.
- **Comandos observados:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:ui`, `npm run test:db:native` (requiere infraestructura adecuada).
- **Documentación existente:** `docs/gastropilot-ai-pilot-qa-20261029.md`, `docs/pilot-runbook.md`, `docs/pilot-checklist.md`, `docs/managed-ai-gateway.md`, `docs/whatsapp-agent-core.md`.
- **Riesgos principales a verificar:** alta y activación; roles/organizaciones/sucursales; reservas/pedidos/stock/ventas; integridad en concurrencia; conectividad de WhatsApp y fuentes pasivas; motor IA, costo y permisos.
- **Entorno de producción / deploy actual:** NO VERIFICADO POR ESTA ADOPCIÓN. No afirmar estado real sin inspección del proveedor.
- **Branch:** la rama `main` concentra cambios integrados recientes y el workflow CI hace push a main. Al adoptar el estándar se trabaja en PR contra main, pero la rama predeterminada de GitHub aparece configurada a `claude/saas-restaurant-management-ui-OVf0q`: revisar esa configuración por separado antes de cambiarla.

Actualizar esta ficha con los entornos, roles y rutas verificadas antes de planificar nuevas features. No pegar secretos.
