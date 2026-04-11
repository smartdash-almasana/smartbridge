# Schema Audit: Realidad Productiva vs Repo V2

## 1. Schema Real (Supabase MCP)
Las tablas clave confirmadas (con sus columnas y constraints) son:

*   **`v2_domain_events`**
    *   `source_event_id` (uuid, NOT NULL, **UNIQUE**)
    *   `tenant_id` y `store_id` (ambas **uuid, NULLABLE**)
    *   `occurred_at` (timestamptz, **NULLABLE**)
    *   `payload` (jsonb, NULLABLE)
*   **`v2_snapshots`**
    *   `snapshot_id` (uuid, PK)
    *   `snapshot_at` (timestamptz, **NULLABLE**)
    *   `payload` (jsonb, NOT NULL)
*   **`v2_metrics_daily`**
    *   PK compuesta: `(tenant_id, store_id, metric_date)`
    *   Ambos ids son **NOT NULL**. `metrics` (jsonb, NOT NULL).
*   **`v2_clinical_signals` / `v2_health_scores`**
    *   `store_id`, `run_id` (**NOT NULL**)
    *   Índices compuestos presentes (ej. `(store_id, run_id)`).

## 2. Gaps respecto a un diseño ideal (Codex propuesto)
1.  **Tablas relacionales ausentes**: No existen las tablas relacionales de negocio de V0 como `orders`, `payments` o `fulfillments`. El sistema V2 ha migrado a un patrón 100% basado en Eventos y Documentos (`v2_domain_events.payload` y `v2_snapshots.payload` jsonb).
2.  **Laxitud de tipado (Nullability)**: En `v2_domain_events`, los `store_id`, `tenant_id` y crucialmente `occurred_at` son de libre inserción (NULL permitidos). Esto genera riesgo de eventos huérfanos o sin tiempo. Lo mismo ocurre con `snapshot_at` en `v2_snapshots`.
3.  `source_event_id` en `v2_domain_events` está validado como UUID estricto y tiene constaint UNIQUE global, lo que ratifica la fuerte **idempotencia** del pipeline en la ingesta.

## 3. Recomendación Práctica
**Recomendación B: Implementar "Soft Governance" a través de QA.**

Dado que intentar migraciones (`ALTER TABLE ... SET NOT NULL`) en tablas de runtime en una arquitectura event-driven con tablas ya pobladas acarrea un alto riesgo de romper el motor clínico:
*   Mantenemos la DB relajada (tolerante a fallos inyectables o estructuras legadas).
*   Utilizamos el archivo **`QA_AUTOMATION_SYSTEM.sql`** implementado recientemente como nuestro semáforo de integridad, ya que sus tests como `orphan_domain_events` controlan los vacíos (NULLs) de `store_id`/`tenant_id` de manera activa sin necesidad de alterar el DDL original que podría impactar a los workers de terceros (Shopify, webhook parsers legados). No modificar y permitir bloqueos rígidos en Base de Datos.
