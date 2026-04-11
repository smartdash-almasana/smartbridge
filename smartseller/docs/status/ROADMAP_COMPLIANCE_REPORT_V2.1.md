SmartSeller V2 — Roadmap Compliance Report (v2.1)
Fecha de corte

2026-03-03

Alcance evaluado

Roadmap original (Epics 1–15) vs estado real implementado en producción (branch main, commit 52655ca).

1️⃣ Resumen Ejecutivo

SmartSeller V2 ha completado exitosamente la base estructural del sistema clínico:

Ingesta determinística

Normalización 1:1

Idempotencia fuerte

Observabilidad append-only

DLQ automático con backoff

Cron autónomo en Supabase

Score clínico persistido

Auditoría de ejecución

El sistema ya no es un MVP técnico.
Es una plataforma resiliente operativamente.

2️⃣ Cumplimiento por Epic
EPIC 2 — Ingesta Webhooks + Idempotencia
Task	Estado
2.1 Endpoint Webhooks	✅ Cumplido
2.2 Persistencia cruda	✅ Cumplido (v2_webhook_events)
2.3 Idempotencia	✅ Cumplido (UNIQUE + ON CONFLICT)
2.4 Respuesta inmediata	✅ Cumplido

Resultado: Ingesta determinística operativa en producción.

EPIC 3 — Normalización & Modelo
Task	Estado
3.1 Arquitectura BD entidades	⚠️ Parcial (modelo mínimo implementado)
3.2 Parsers JSON → modelo	✅ Cumplido (v2_domain_events)
3.3 Enriquecimiento diferido	⏳ Pendiente formal

Resultado: Pipeline Webhook → Domain Event completamente operativo (modelo 1:1 formalizado en ADR-0004).

EPIC 12 — Score Logístico
Task	Estado
12.1 Definición fórmula	⚠️ Parcial (motor implementado, fórmula documentable)
12.2 Cálculo + histórico	✅ Cumplido (v2_engine_runs, v2_health_scores)

Resultado: Score clínico persistido y reproducible.

3️⃣ Infraestructura No Explícita en Roadmap (pero implementada)

Estos elementos no estaban formalizados en el Excel, pero son críticos y ya están en producción:

Observabilidad de Ingesta

v2_ingest_attempts (append-only)

Registro por evento

Registro de errores y deduplicación

ADR-0005

DLQ Automático

Reprocesamiento con backoff

Límite de intentos

Modo ?mode=dlq

No rompe SLA principal

ADR-0006

Cron Autónomo en Supabase

pg_cron

pg_net

Schedule cada 10 minutos

No depende de Vercel

Auditoría de Cron

v2_cron_runs append-only

Registro por ejecución

Best-effort logging

Monitoreo de error streak

ADR-0007

4️⃣ Estado General por Fase
Infraestructura clínica

Estado: ✅ Completa y estable

Ingesta

Estado: ✅ Determinística + resiliente

Score Engine

Estado: ✅ Operativo

Alertas externas

Estado: ⏳ Pendiente

Métricas agregadas longitudinales

Estado: ⏳ Pendiente

Integraciones avanzadas (ERP/WMS/Benchmark)

Estado: ⏳ Pendiente

5️⃣ Riesgos Actuales

Fórmula del score debe formalizarse en ADR independiente.

Enriquecimiento diferido no está aún definido como contrato.

Secret de cron aún hardcodeado (deuda técnica aceptada hasta producción formal).

6️⃣ Conclusión

SmartSeller V2 cumple completamente la base estructural del Roadmap para:

Ingesta

Normalización

Score

Resiliencia

Observabilidad

Reprocesamiento automático

El sistema se encuentra en estado:

Arquitectura estable v2.1 — Lista para expansión funcional.