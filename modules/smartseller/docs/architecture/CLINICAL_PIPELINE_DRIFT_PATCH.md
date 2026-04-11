# Drift Patch: Clinical Pipeline (Phase 2 Prep)

**Fecha:** 2026-03-03
**Estatus:** ✅ EJECUTADO

## 1. Problema: Drift de registro y Multi-tenancy en Engine
Se detectó que la tabla `v2_metrics_daily` existía en la base de datos pero no estaba registrada en el sistema de migraciones del repositorio. Además, `v2_engine_runs` no aplicaba el invariante de `tenant_id` NOT NULL, lo que rompía con el diseño de aislamiento operativo.

## 2. Acciones Realizadas

### A. Registro de `v2_metrics_daily`
Se extrajo el DDL real de Supabase y se creó la migración de compatibilidad:
- Archivo: `supabase/migrations/20260303_14_drift_register_v2_metrics_daily.sql`
- PK: `(tenant_id, store_id, metric_date)`
- Constraints: `metrics` JSONB NOT NULL DEFAULT '{}'

### B. Refuerzo de `v2_engine_runs`
- Se agregó la columna `tenant_id` (UUID).
- Se ejecutó un backfill desde `v2_stores` para todos los registros existentes.
- Se impuso la constraint `NOT NULL`.
- Se agregó una FK compuesta `(tenant_id, store_id)` para garantizar la integridad de la unidad operativa (Store).

## 3. Evidencia de Ejecución (QA Gate)

| Check | Resultado Requerido | Valor Real | Estatus |
| :--- | :--- | :--- | :--- |
| `W.metrics_count` | > 0 | 4 | ✅ |
| `W.signals_total` | > 0 | 12 | ✅ |
| `W.scores_total` | > 0 | 8 | ✅ |
| `W.runs_with_null_tenant` | 0 | 0 | ✅ |

---
**Firmado:** Arquitecto Clínico SmartSeller.
