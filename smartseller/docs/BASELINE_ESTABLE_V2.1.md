# SmartSeller --- BASELINE ESTABLE V2.1

**Fecha de consolidación:** 2026-03-03\
**Entorno validado:** Producción (Supabase + Vercel)\
**Alcance:** Fase 1 + Score V0 + Hardening + QA automatizado

------------------------------------------------------------------------

## 1. Estado del Sistema

### Ingesta (V2)

-   Worker `/api/worker/v2-webhook-to-domain` operativo.
-   Idempotencia validada.
-   Sin duplicados en `v2_domain_events`.
-   Índices de claim activos.
-   Dead Letter Queue preparada.

### Engine (Score V0)

-   `v2_engine_runs` ya no queda en estado zombie.
-   `finalizeEngineRun` valida error de update.
-   Cada run cierra correctamente en `done` o `failed`.
-   Gate de 1 hora funcional.
-   Señales clínicas persistidas correctamente.

### Integridad Operativa

-   0 `engine_runs` zombies.
-   Estados válidos estrictos (`running | done | failed`).
-   Score y señales generadas en las últimas 24 horas.
-   QA automatizado ejecutado en producción con PASS total.

------------------------------------------------------------------------

## 2. Invariantes Confirmados

✔ Idempotencia fuerte\
✔ Determinismo del score\
✔ Trazabilidad: run → snapshot → signals → score\
✔ Sin estados huérfanos\
✔ Sin duplicaciones\
✔ Sin dependencia externa en cálculo clínico\
✔ Reproducible únicamente desde base de datos

------------------------------------------------------------------------

## 3. Definición de "Baseline Estable V2.1"

Esta baseline implica que:

-   El sistema opera sin intervención manual.
-   No existe estado corrupto ni zombies.
-   El pipeline completo es verificable mediante un único script SQL.
-   Cualquier regresión futura será detectable automáticamente vía QA.

No implica sistema terminado. Implica sistema estable y clínicamente
consistente para evolucionar.

------------------------------------------------------------------------

## 4. Evidencia de QA Automatizado (Producción)

Resultado final:

-   A.idempotencia_domain_events: PASS\
-   B.no_engine_runs_zombies: PASS\
-   C.engine_run_status_validos: PASS\
-   D.health_scores_recientes_24h: PASS\
-   E.clinical_signals_recientes_24h: PASS

------------------------------------------------------------------------

## 5. Próxima Etapa Natural (V2.2)

-   Worker persistente con heartbeat continuo.
-   Reconciliación periódica automática.
-   Alertas si QA falla.
-   Observabilidad productiva extendida.

------------------------------------------------------------------------

**Estado Final:**\
SmartSeller V2.1 consolidado como baseline estable.
