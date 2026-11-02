# GastroPilot IA — modelo comercial y metering

## Principio
El cliente compra **créditos GastroPilot**, no tokens del proveedor.

Los tokens de OpenAI, el modelo usado y el costo real en USD son métricas internas de operación. El cliente ve únicamente:
- plan;
- créditos incluidos;
- créditos consumidos;
- créditos restantes;
- fecha de renovación;
- alertas de uso.

## Planes iniciales
| Plan | Precio | Créditos mensuales |
| --- | ---: | ---: |
| Sin IA | USD 0 | 0 |
| Starter | USD 10 | 5.000 |
| Growth | USD 25 | 15.000 |
| Pro | USD 49 | 35.000 |
| Business | USD 99 | 80.000 |

Estos valores son de lanzamiento y deben revisarse con costo real/margen después de medir pilotos.

## Packs
| Pack | Precio | Créditos | Vigencia |
| --- | ---: | ---: | ---: |
| 5K | USD 10 | 5.000 | 90 días |
| 15K | USD 25 | 15.000 | 90 días |
| 40K | USD 50 | 40.000 | 90 días |

## Consumo
La cuota pertenece al negocio. `actor_id` permite atribuir consumo por usuario para analítica y futuros límites internos.

## Regla de producto
El usuario no elige modelo. GastroPilot selecciona el motor según tarea/costo/calidad.

## Seguridad comercial
`cost_usd_micros`, tokens de proveedor y margen NO deben mostrarse a usuarios normales. Esa información queda para observabilidad/administración interna de NexoDG.

## Flujo de activación
1. Owner/admin elige plan.
2. Checkout/pago.
3. Webhook de pago activa `ai_business_plans.plan_code` y `monthly_credits`.
4. Gateway reserva créditos antes de inferencia.
5. Al 80/90/100% se generan alertas.
6. Sin crédito: se bloquea IA, no el resto del producto.
7. Puede mejorar plan o comprar pack.

## Pendiente de integración de pagos
Todavía no se implementa checkout en esta fase. El catálogo, metering y modelo de datos quedan preparados para conectar Stripe/Mercado Pago u otro proveedor después.
