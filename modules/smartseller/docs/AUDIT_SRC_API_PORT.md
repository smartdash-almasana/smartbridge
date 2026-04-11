# Auditoría y Plan de Migración de src/api a SmartSeller V2
**Fecha/Hora:** 2026-02-26 12:00:00

## Resumen
Se auditó el directorio `src/api` copiado de versiones anteriores del proyecto. Se determinó que el proyecto actual utiliza Next.js App Router (ubicado en `src/app/(v2)/api`). Las rutas en `src/api` no están expuestas como endpoints reales de Next.js. El plan es mover/reubicar las funcionales según prioridad (PORT_NOW, PORT_LATER) y descartar las duplicadas o irrelevantes (DROP).

## Inventario `src/api`
| Archivo | Exportaciones | Dependencias |
| --- | --- | --- |
| `src/api/clientes/[clienteId]/casos/route.ts` | GET | Supabase: No, Env: No, Fetch: No |
| `src/api/cron/clinical/route.ts` | dynamic, GET | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/engine/auth-debug/route.ts` | GET | Supabase: No, Env: Sí, Fetch: No |
| `src/api/engine/health/route.ts` | GET | Supabase: No, Env: No, Fetch: No |
| `src/api/engine/ops-health/route.ts` | GET | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/engine/outbox/route.ts` | GET | Supabase: No, Env: Sí, Fetch: No |
| `src/api/engine/run/route.ts` | POST, GET | Supabase: No, Env: Sí, Fetch: No |
| `src/api/engine/run-cron/route.ts` | GET | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/engine/system-health/route.ts` | GET | Supabase: Sí, Env: Sí, Fetch: Sí |
| `src/api/engine/system-health-sampler/route.ts` | GET | Supabase: No, Env: Sí, Fetch: Sí |
| `src/api/health/clinical/route.ts` | GET | Supabase: Sí, Env: No, Fetch: No |
| `src/api/internal/clinical/dashboard/route.ts` | dynamic, GET | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/internal/clinical/reval/route.ts` | POST | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/internal/health-score/run/route.ts` | dynamic, POST | Supabase: No, Env: Sí, Fetch: No |
| `src/api/internal/meli/clinical-ui/route.ts` | POST | Supabase: Sí, Env: Sí, Fetch: Sí |
| `src/api/internal/meli/diagnostics/discovery/route.ts` | POST | Supabase: Sí, Env: Sí, Fetch: Sí |
| `src/api/internal/meli/diagnostics/route.ts` | POST | Supabase: Sí, Env: Sí, Fetch: Sí |
| `src/api/internal/onboarding/meli/route.ts` | dynamic, POST, GET | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/internal/webhook-worker/route.ts` | dynamic, POST | Supabase: No, Env: Sí, Fetch: No |
| `src/api/jobs/process-meli-webhooks/route.ts` | GET | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/mcp/mercadolibre/health/route.ts` | dynamic, GET | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/mcp/mercadolibre/route.ts` | GET, POST | Supabase: Sí, Env: Sí, Fetch: Sí |
| `src/api/meli/notifications/route.ts` | dynamic, POST, GET | Supabase: No, Env: No, Fetch: No |
| `src/api/meli/oauth/callback/route.ts` | dynamic, GET | Supabase: Sí, Env: Sí, Fetch: Sí |
| `src/api/meli/oauth/start/route.ts` | dynamic, GET | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/meli/oauth/status/route.ts` | GET | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/meli/webhook/route.ts` | dynamic, POST | Supabase: No, Env: No, Fetch: No |
| `src/api/token-refresh/cleanup/route.ts` | GET | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/token-refresh/dlq/route.ts` | GET | Supabase: No, Env: Sí, Fetch: No |
| `src/api/token-refresh/scanner/route.ts` | GET | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/token-refresh/urgent/route.ts` | GET | Supabase: Sí, Env: Sí, Fetch: No |
| `src/api/token-refresh/worker/route.ts` | POST | Supabase: No, Env: Sí, Fetch: No |

## Decisiones Clínicas (PORT_NOW / PORT_LATER / DROP)
| Directorio / Endpoint | Decisión | Razón |
| --- | --- | --- |
| `src/api/clientes` | DROP | Legacy de SmartSeller v1 sin uso actual. |
| `src/api/cron` | PORT_LATER | Cron jobs útiles, no bloqueantes para UI local. |
| `src/api/engine` | PORT_NOW | Contiene flujos core y health-checks del engine. |
| `src/api/health` | PORT_NOW | Necesario para monitoring de V2. |
| `src/api/internal` | PORT_NOW | Requerido por Onboarding UI y Meli logic. |
| `src/api/jobs` | PORT_LATER | Tareas en batch, posponer después del core real. |
| `src/api/mcp` | DROP | Herramientas dev/Claude, no pertenecen al router V2 prod. |
| `src/api/meli` | PORT_NOW (Reubicar) | Vital (oauth/webhook), colisión: `meli/oauth/start` ya existe en `app/(v2)/api/auth/meli/start`. |
| `src/api/token-refresh`| PORT_LATER | Procesos asíncronos importantes pero no UI blockers. |

## Plan de Reubicación (Moves sugeridos)
- `src/api/engine/*` -> Mover a `src/app/(v2)/api/engine/*` (Excepto `engine/run` que debe unificarse o si ya está en `(v2)/api/engine/[store_id]`).
- `src/api/health/*` -> Mover a `src/app/(v2)/api/health/clinical/route.ts`
- `src/api/internal/*` -> Mover a `src/app/(v2)/api/internal/*`
- `src/api/meli/*` -> Mover a `src/app/(v2)/api/webhook` / `(v2)/api/auth/meli/*` (Nota: `oauth/start` y `oauth/callback` marcar como DUPLICADO si existen).
- `src/api/cron/*` -> Mover a `src/app/(v2)/api/cron/*`
- `src/api/jobs/*` -> Mover a `src/app/(v2)/api/jobs/*`
- `src/api/token-refresh/*` -> Mover a `src/app/(v2)/api/token-refresh/*`
