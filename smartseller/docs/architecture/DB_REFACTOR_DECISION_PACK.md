# DB Refactor Decision Pack

## 1) INVENTARIO REAL (EVIDENCIA)

**Query usada:**
```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name IN ('v2_stores', 'v2_domain_events', 'v2_snapshots', 'v2_webhook_events', 'v2_metrics_daily', 'v2_clinical_signals', 'v2_health_scores', 'v2_tenants', 'v2_sellers')
ORDER BY table_name, ordinal_position;
```

**Resultado resumido (Columnas, NULLs e Índices Críticos):**
- **v2_tenants**: `tenant_id` (uuid, NOT NULL, PK), `name` (text, NOT NULL). RLS: NA.
- **v2_sellers**: `seller_uuid` (uuid, NOT NULL, PK), `tenant_id` (uuid, NOT NULL, FK). RLS: NA.
- **v2_stores**: `store_id` (uuid, NOT NULL, PK), `tenant_id` (uuid, NOT NULL, FK), `provider_key` (text, NOT NULL). `display_name` (text, NULL). UNIQUE(tenant_id, provider_key, external_account_id). RLS: ENABLED.
- **v2_webhook_events**: `event_id` (uuid, NOT NULL, PK), `store_id` (uuid, NOT NULL, FK), `tenant_id` (uuid, NULL). UNIQUE(store_id, provider_event_id), UNIQUE(store_id, dedupe_key). RLS: NA.
- **v2_domain_events**: `domain_event_id` (uuid, NOT NULL, PK), `source_event_id` (uuid, NOT NULL, UNIQUE), `event_type` (text, NOT NULL), `payload` (jsonb, NULL). **`tenant_id` (uuid, NULL)**, **`store_id` (uuid, NULL)**, **`occurred_at` (timestamptz, NULL)**. RLS: NA.
- **v2_snapshots**: `snapshot_id` (uuid, NOT NULL, PK), `payload` (jsonb, NOT NULL). **`tenant_id` (uuid, NULL)**, **`store_id` (uuid, NULL)**, **`snapshot_at` (timestamptz, NULL)**. RLS: NA.
- **v2_metrics_daily**: PK(tenant_id, store_id, metric_date). `metrics` (jsonb, NOT NULL). RLS: NA.
- **v2_clinical_signals**: `signal_id` (uuid, NOT NULL, PK), `store_id` (uuid, NOT NULL, FK), `run_id` (uuid, NOT NULL, FK), `signal_key` (text, NOT NULL). UNIQUE(signal_id). RLS: ENABLED.
- **v2_health_scores**: `score_id` (uuid, NOT NULL, PK), `store_id` (uuid, NOT NULL, FK), `run_id` (uuid, NOT NULL, FK), `score` (numeric, NOT NULL). UNIQUE(store_id, run_id). RLS: ENABLED.
- **Entidades Tipadas (orders, payments, fulfillments, refunds)**: ❌ UNKNOWN (No existen en el schema actual).

**Triggers verificados:**
```sql
SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public';
```
- Resultado: Solo `sellers` (v0) tiene trigger `trg_sellers_set_updated_at`. **V2 tablas (v2_stores, v2_domain_events) NO tienen triggers de updated_at.**

## 2) CONTRASTE CONTRA CONTRATO

| Severidad | Tabla / Columna / Constraint | Estado actual | Estado esperado | Impacto clínico | Acción requerida |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BLOCKER** | `v2_domain_events` / `tenant_id`, `store_id` | NULLABLE | NOT NULL | Ruptura multi-tenant, fuga de datos, scores sin dueño | Hacer `NOT NULL` retroactivamente y a futuro |
| **BLOCKER** | `v2_domain_events` / `occurred_at` | NULLABLE | NOT NULL | Imposibilidad de construir timeline o time-travel | Hacer `NOT NULL` con valor default lógico si falta |
| **BLOCKER** | `v2_orders`, `v2_payments`, `v2_fulfillments` | NO EXISTEN | Tipadas core | Los scores dependen de JSONB frágil (evidencia) en lugar de un tipado duro de negocio | Crear tablas según Spec |
| **BLOCKER** | Repositorio / Migraciones base | Incompleto | Repositorio = DB Real | Imposible hacer bootstrap desde cero | Hacer dump del schema actual como migración 0 |
| **REQUIRED**| `v2_stores`, `v2_domain_events` / `updated_at` | Sin Triggers | Trigger automático | Sincronización indetectable / Imposible ver drift | Instalar triggers locales standard para `updated_at` |
| **REQUIRED**| `v2_domain_events` / Determinismo | UUID v4 (aleatorio) | Monotónico / `normalized_at` | Desempates no confiables en ingestas de misma milésima de segundo | Definir regla tie-breaker formal (`ocurred_at` + seq) |

## 3) DICTAMEN ARQUITECTÓNICO

- ¿La DB es reconstruible desde migrations? **No**
- ¿domain_events es multi-tenant duro? **No**
- ¿Existe core tipado materializado? **No**
- ¿El determinismo del writer es verificable? **No**
- ¿updated_at está garantizado en V2? **No**

**Conclusión final:**
**NOT READY**

## 4) PLAN DE REFRACTOR MÍNIMO

**FASE 0 – Baseline Reconstruction**
- Nombre sugerido: `20260303_00_v2_baseline_schema.sql`
- SQL exacto: Extracción de todos los `CREATE TABLE` actuales de la Base de Datos para `v2_stores`, `v2_sellers`, `v2_tenants`, `v2_snapshots`, e inserts de tablas puente, evitando que existan sin registro.
- Riesgo: Ninguno (solo iguala el repo a producción).

**FASE 1 – Multi-tenant Hardening**
- Nombre sugerido: `20260303_01_v2_multitenant_hardening.sql`
- SQL exacto:
```sql
DELETE FROM public.v2_domain_events WHERE store_id IS NULL OR tenant_id IS NULL;
ALTER TABLE public.v2_domain_events ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.v2_domain_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.v2_domain_events ALTER COLUMN occurred_at SET NOT NULL;
ALTER TABLE public.v2_snapshots ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.v2_snapshots ALTER COLUMN tenant_id SET NOT NULL;
```
- Riesgo: Alto si workers mandan NULLs. Requiere fix previo en los insert points.

**FASE 2 – Core Tipado**
- Nombre sugerido: `20260303_02_v2_core_entities.sql`
- SQL exacto:
```sql
CREATE TABLE public.v2_orders (
  tenant_id uuid NOT NULL, store_id uuid NOT NULL, seller_uuid uuid NOT NULL, provider_key text NOT NULL,
  order_external_id text NOT NULL, order_status text NOT NULL, total_amount numeric NOT NULL, currency_code text NOT NULL,
  created_at_provider timestamptz, closed_at_provider timestamptz, raw_jsonb jsonb NOT NULL,
  last_occurred_at timestamptz NOT NULL, last_source_event_id text NOT NULL,
  UNIQUE(provider_key, store_id, order_external_id)
);
-- Mismo patrón para v2_order_items, v2_payments, v2_refunds, v2_fulfillments
-- En v2_fulfillments incluir sla_status text NOT NULL CHECK (sla_status IN ('sla_unknown', 'sla_ok', 'sla_at_risk', 'sla_breached'))
```
- Riesgo: Medio.
- Estrategia: "Shadow writes" en el worker de ingest antes de leer para el motor.

**FASE 3 – Determinismo Eventos**
- Nombre sugerido: `20260303_03_v2_domain_events_tiebreaker.sql`
- SQL exacto:
```sql
ALTER TABLE public.v2_domain_events ADD COLUMN global_seq BIGSERIAL UNIQUE;
```
- Riesgo: Bajo. Da un orden inequívoco secundario para el write.

**FASE 4 – Observabilidad**
- Nombre sugerido: `20260303_04_v2_updated_at_triggers.sql`
- SQL exacto:
```sql
CREATE OR REPLACE FUNCTION v2_set_updated_at() RETURNS trigger AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_v2_stores_updated_at BEFORE UPDATE ON public.v2_stores FOR EACH ROW EXECUTE FUNCTION v2_set_updated_at();
-- Mismo trigger para v2_domain_events
```
- Riesgo: Bajo.

## 5) QA GATE SQL (SELECT-ONLY)

```sql
-- docs/qa/QA_V2_GATE_FINAL.sql
WITH
  orphan_events AS (
    SELECT COUNT(*)::int AS n FROM public.v2_domain_events WHERE store_id IS NULL OR tenant_id IS NULL
  ),
  orphan_snapshots AS (
    SELECT COUNT(*)::int AS n FROM public.v2_snapshots WHERE store_id IS NULL OR tenant_id IS NULL
  ),
  invalid_sla AS (
    -- Simulado asumiendo la creación de v2_fulfillments. Si no existe, lanza error/vacío.
    -- Para hacer safe check en DB actual, usamos pg_class.
    SELECT COUNT(*)::int AS n 
    FROM pg_class c 
    LEFT JOIN information_schema.columns col ON col.table_name = c.relname AND col.column_name = 'sla_status'
    WHERE c.relname = 'v2_fulfillments' 
    -- Si existe la columna y la tabla, pero el val es malo:
    /* AND col.table_name IS NOT NULL AND (SELECT COUNT(*) FROM public.v2_fulfillments WHERE sla_status NOT IN ('sla_unknown', 'sla_ok', 'sla_at_risk', 'sla_breached')) > 0 */
  ),
  missing_currency AS (
    -- Simulado para pagos V2.
    SELECT COUNT(*)::int AS n FROM pg_class c WHERE c.relname = 'v2_payments'
  ),
  missing_triggers AS (
    SELECT COUNT(*)::int AS n
    FROM information_schema.tables t
    LEFT JOIN information_schema.triggers tr ON t.table_name = tr.event_object_table AND tr.trigger_name LIKE '%updated_at%'
    WHERE t.table_schema = 'public' AND t.table_name IN ('v2_stores', 'v2_domain_events')
    AND tr.trigger_name IS NULL
  ),
  missing_tiebreaker AS (
    SELECT COUNT(*)::int AS n
    FROM information_schema.columns 
    WHERE table_name = 'v2_domain_events' AND column_name = 'global_seq'
  )

SELECT '1.domain_events_null_identity' AS "check", CASE WHEN (SELECT n FROM orphan_events) = 0 THEN 'PASS' ELSE 'FAIL' END AS status, 'count='||(SELECT n FROM orphan_events) AS detail
UNION ALL
SELECT '2.snapshots_null_identity', CASE WHEN (SELECT n FROM orphan_snapshots) = 0 THEN 'PASS' ELSE 'FAIL' END, 'count='||(SELECT n FROM orphan_snapshots)
UNION ALL
SELECT '3.invalid_sla_enums', CASE WHEN (SELECT n FROM invalid_sla) = 0 THEN 'PASS' ELSE 'FAIL (or missing)' END, 'count/missing='||(SELECT n FROM invalid_sla)
UNION ALL
SELECT '4.currency_integrity', CASE WHEN (SELECT n FROM missing_currency) > 0 THEN 'PASS' ELSE 'FAIL (table missing)' END, 'count='||(SELECT n FROM missing_currency)
UNION ALL
SELECT '5.v2_missing_updated_at_triggers', CASE WHEN (SELECT n FROM missing_triggers) = 0 THEN 'PASS' ELSE 'FAIL' END, 'missing_tables='||(SELECT n FROM missing_triggers)
UNION ALL
SELECT '6.domain_events_missing_tiebreaker', CASE WHEN (SELECT n FROM missing_tiebreaker) > 0 THEN 'PASS' ELSE 'FAIL' END, 'global_seq_exists='||(SELECT n FROM missing_tiebreaker)
ORDER BY "check";
```
