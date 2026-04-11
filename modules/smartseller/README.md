# SmartSeller

> **V3 es el active source of truth.** Pipeline clínico event-driven en producción.
> V2 permanece en soporte como legacy.

Runtime clínico-operativo para sellers de e-commerce (Mercado Libre → Shopify).
Pipeline: webhook → domain_event → snapshot → metrics → signals → health_score.

## Stack
- TypeScript · Next.js · Supabase (Postgres 17) · Arquitectura event-driven

## Setup
1. Completar `.env.local` con credenciales Supabase y Mercado Libre
2. `npm install`
3. `supabase db push`
4. `npm run dev`

## Documentación V3

| Documento | Descripción |
|---|---|
| [docs/README.md](docs/README.md) | Índice canónico de documentación |
| [docs/status/V3_PIPELINE_READY.md](docs/status/V3_PIPELINE_READY.md) | Estado del pipeline V3 |
| [docs/architecture/current-pipeline.md](docs/architecture/current-pipeline.md) | Pipeline activo (V3) |
| [docs/architecture/V3_READ_MODEL_PATTERN.md](docs/architecture/V3_READ_MODEL_PATTERN.md) | Patrón de read models V3 |

## Legacy V2
Migraciones en `supabase/migrations/`. ADR-0002: `docs/adr/0002-score-v0-contract.md`.
