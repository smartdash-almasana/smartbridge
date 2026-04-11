# ADR-0004: Semántica canónica de v2_domain_events — 1 webhook → 1 domain_event

- **Status:** Accepted
- **Date:** 2026-03-03
- **Autores:** Arquitecto clínico SmartSeller V2

---

## Contexto

Durante la prueba E2E real del pipeline `webhook → worker → domain → engine → score`
se descubrió un conflicto entre los constraints de `v2_domain_events` y el código del worker.

### Writers identificados (con evidencia de código)

| Archivo | ON CONFLICT usado | Modelo implícito |
|---|---|---|
| `src/v2/ingest/webhook-to-domain-worker.ts:98` | `onConflict: 'source_event_id'` | **1:1** |
| `src/v2/ingest/normalizer.ts:76` | `.insert()` sin ON CONFLICT (comentario asume `source_event_id, event_type`) | **ambiguo** |
| `src/app/(v2)/api/meli/sync/[store_id]/route.ts:179` | `onConflict: 'source_event_id,event_type'` | **1:N** |

### Estado de constraints en DB (evidencia SQL real, 2026-03-03)

```
uq_v2_domain_events_source_event_id   → UNIQUE (source_event_id)          [añadido para fix worker]
uq_v2_domain_events_source_type       → UNIQUE (source_event_id, event_type) [constraint original]
```

### Cardinalidad real en producción

```sql
SELECT source_event_id, COUNT(*) AS n, COUNT(DISTINCT event_type) AS types
FROM public.v2_domain_events
GROUP BY source_event_id
HAVING COUNT(*) > 1 OR COUNT(DISTINCT event_type) > 1;
-- Resultado: 0 filas. Cardinalidad 100% 1:1 en datos reales.
```

### Consumo del engine

`src/v2/api/score.ts:80-103` lee `v2_domain_events` agrupando por `event_type`.
Es agnóstico a la cardinalidad (1:1 o 1:N); simplemente cuenta rows. Ambos modelos son
compatibles hacia arriba.

---

## Problema / Tensión

Los tres writers tienen ON CONFLICT distintos, creando una **semántica ambigua**:
- El worker principal usa `UNIQUE(source_event_id)` → modelo 1:1.
- El sync manual usa `UNIQUE(source_event_id, event_type)` → modelo 1:N.
- Los datos reales muestran exclusivamente 1:1.

Esta ambigüedad produce:
1. Dos constraints UNIQUE redundantes con semánticas diferentes, que pueden colisionar.
2. Idempotencia no uniforme: comportamiento distinto según qué writer toca la fila.
3. Riesgo de duplicados en un futuro writer que asuma 1:N.

---

## Decisión

**Se adopta Opción A: 1 webhook_event → exactamente 1 domain_event.**

### Justificación clínica

1. **Mercado Libre emite 1 notificación de webhook por recurso**: `orders_v2` → 1 resource
   path → 1 event_type derivado. No hay razón operativa para mapear 1 push en N eventos
   de dominio distintos en el momento de ingestión.

2. **Idempotencia fuerte simplificada**: `source_event_id` = PK lógico del pipeline.
   Saber que un webhook ya fue procesado es equivalente a saber que su domain_event existe.
   Con 1:N, el conteo de "procesados" requiere un conjunto adicional de `(source_event_id, event_type)`.

3. **Trazabilidad directa**: La cadena de auditoría `webhook_event_id → domain_event_id`
   es una bijección. El engine puede remontar al origen sin ambigüedad.

4. **Los datos reales lo confirman**: 0 filas con más de 1 domain_event por webhook
   en producción desde el inicio del sistema.

5. **La granularidad semántica no se pierde**: `event_type` sigue existiendo como campo
   clasificatorio en el domain_event. Si en el futuro un webhook requiriera ser
   descompuesto (ej. un pago con múltiples estados), eso debe modelarse como múltiples
   webhooks_events (uno por notificación de canal), no como 1 webhook → N domain_events.

### Pros del modelo A
- Idempotencia trivial: `ON CONFLICT (source_event_id) DO NOTHING` en cualquier writer.
- FK semánticamente correcta: `source_event_id → v2_webhook_events(event_id)`.
- Engine sin riesgo de doble-conteo por variantes de `event_type`.
- Reconciliación directa: si `domain_events.count = webhook_events.count` para un store → pipeline sin drift.

### Cons del modelo A (mitigados)
- Menos granularidad si ML emitiese distintos tipos desde 1 push. **Mitigación**: ML no lo hace; si cambia la API, se modela como nuevo evento de canal, no como fan-out interno.
- `normalizer.ts` actualmente no incluye ON CONFLICT explícito. **Mitigación**: change-set en PASO 5.

---

## Consecuencias del modelo A sobre el schema

| Constraint | Estado | Acción recomendada |
|---|---|---|
| `uq_v2_domain_events_source_event_id` → `UNIQUE(source_event_id)` | **Canónico oficial** | Mantener. Es el constraint correcto para el modelo 1:1. |
| `uq_v2_domain_events_source_type` → `UNIQUE(source_event_id, event_type)` | **Redundante + potencialmente confuso** | Eliminar en próxima maintenance window (ver Plan abajo). |

---

## Plan de migración / Change-set mínimo

### Cambio 1 — Alinear `normalizer.ts` (código, bajo riesgo)
`normalizer.ts:77-88` usa `.insert()` sin ON CONFLICT. Si hay un conflicto (reprocessing),
lanza error inesperado. Debe cambiarse a upsert con `source_event_id`:

```diff
// normalizer.ts líneas 74-88
-    const { data: inserted } = await supabaseAdmin
-        .from('v2_domain_events')
-        .insert({
-            source_event_id: webhookEvent.event_id,
-            event_type,
-            entity_type,
-            entity_id,
-            occurred_at,
-            payload: rawPayload,
-        })
-        .select('domain_event_id')
-        .throwOnError();
+    const { data: inserted } = await supabaseAdmin
+        .from('v2_domain_events')
+        .upsert(
+            {
+                source_event_id: webhookEvent.event_id,
+                event_type,
+                entity_type,
+                entity_id,
+                occurred_at,
+                payload: rawPayload,
+            },
+            { onConflict: 'source_event_id', ignoreDuplicates: true }
+        )
+        .select('domain_event_id')
+        .throwOnError();
```

### Cambio 2 — Alinear `meli/sync/[store_id]/route.ts` (código, bajo riesgo)
`route.ts:179` usa `onConflict: 'source_event_id,event_type'` (modelo B).
Dado que cada webhook_event ya es semánticamente único por su `provider_event_id`
(`sync:order:<id>:<status>`), el domain_event también es único por `source_event_id`.
Cambiar a:

```diff
// route.ts línea 179
-        { onConflict: 'source_event_id,event_type' }
+        { onConflict: 'source_event_id', ignoreDuplicates: true }
```

### Cambio 3 — DDL: eliminar constraint redundante (DB, reversible)
**No ejecutar hasta que los cambios de código estén en producción.**
**Precondición:** verificar que 0 filas violarían `UNIQUE(source_event_id)` (ya confirmado: 0 duplicados).

```sql
-- Reversible: si se necesita rollback, re-crear con mismo nombre
ALTER TABLE public.v2_domain_events
    DROP CONSTRAINT uq_v2_domain_events_source_type;
```

**Criterio de rollback:** Si algún writer futuro legítimamente necesita 1:N, recrear el constraint
y revisar ADR-0004 antes de hacer el cambio.

---

## Criterio de seguridad para aplicar Change-set

1. Los cambios 1 y 2 (código) deben ir en el mismo PR/deploy.
2. Verificar antes de merge:
   ```sql
   SELECT COUNT(*) FROM public.v2_domain_events;
   -- debe ser igual a:
   SELECT COUNT(DISTINCT source_event_id) FROM public.v2_domain_events;
   -- Si son iguales → 0 violaciones → seguro para eliminar el constraint compuesto.
   ```
3. El cambio 3 (DDL DROP CONSTRAINT) se aplica después del deploy de código, en maintenance window.
4. No requiere data cleanup porque los datos ya cumplen `UNIQUE(source_event_id)`.

---

## Referencias

- `src/v2/ingest/webhook-to-domain-worker.ts` (writer principal del cron)
- `src/v2/ingest/normalizer.ts` (writer del normalizer individual)
- `src/app/(v2)/api/meli/sync/[store_id]/route.ts` (writer del sync manual)
- `src/v2/api/score.ts` (consumer del engine)
- `docs/e2e-execution-evidence.md` (evidencia E2E de la sesión donde se detectó el bug)
- ADR-0002: Score V0 contract
- Migration aplicada: `add_unique_source_event_id_to_domain_events`
