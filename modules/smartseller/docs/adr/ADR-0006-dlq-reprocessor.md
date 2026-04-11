# ADR-0006: DLQ Reprocessor — Reintentos Controlados para Ingest Fallido

**Estado:** Aceptado  
**Fecha:** 2026-03-03  
**Autor:** Arquitectura SmartSeller V2  
**Refs:** ADR-0004 (cardinalidad 1:1), ADR-0005 (observabilidad ingest)

---

## Contexto

El pipeline `webhook_events → domain_events` puede fallar por razones transitorias:

- Errores de red hacia Supabase
- Violaciones de constraint temporales (race conditions en upserts)
- Exceso de rate-limit en el DB connection pool

Con ADR-0005 instrumentamos `v2_ingest_attempts` para tener trazabilidad de cada intento.
Sin embargo, no existía mecanismo de **reintento automático** para los eventos que quedaron en
`status = 'error'` sin un `domain_event` correspondiente.

### Evidencia del problema

Un evento con `status = 'error'` en `v2_ingest_attempts` y sin registro en `v2_domain_events`
es un **gap de cobertura clínica**: el motor no lo verá al calcular signals/score.
El estado quedaba "silent" hasta que alguien lo revisara a mano.

---

## Decisión

Implementar un **modo DLQ** opcional en el worker existente `/api/worker/v2-webhook-to-domain`.

Invocado con `?mode=dlq`, el worker sustituye su fuente de eventos habituales por una
**query de candidatos fallidos** directamente sobre Postgres, sin infraestructura adicional.

### Query canónica de candidatos DLQ

```sql
WITH attempt_stats AS (
  SELECT
    event_id,
    COUNT(*)                         AS total_attempts,
    MAX(created_at)                  AS last_attempt_at,
    bool_or(status = 'error')        AS has_error
  FROM public.v2_ingest_attempts
  WHERE event_id IS NOT NULL
  GROUP BY event_id
)
SELECT
  we.event_id,
  we.store_id,
  we.tenant_id,
  ast.total_attempts,
  ast.last_attempt_at
FROM public.v2_webhook_events we
INNER JOIN attempt_stats ast ON ast.event_id = we.event_id
WHERE
  ast.has_error     = true
  AND NOT EXISTS (
    SELECT 1 FROM public.v2_domain_events de
    WHERE de.source_event_id = we.event_id
  )
  AND ast.total_attempts < 10
  AND ast.last_attempt_at < now() - interval '10 minutes'
ORDER BY ast.last_attempt_at ASC
LIMIT <max_per_run>;
```

### Invariantes del reprocessor

| Invariante | Valor | Justificación |
|---|---|---|
| **Máximo intentos** | 10 | Evita loops infinitos; eventos con bugs permanentes se auto-abandonan |
| **Backoff mínimo** | 10 minutos | Evita retry storms; tolera flapping de DB/red |
| **Límite por corrida** | 50 (hard cap 200) | Acota el impacto en cada ejecución del worker |
| **Re-usa `insertDomainEvent`** | Sí | Garantiza idempotencia y observabilidad idénticas al path normal |
| **Registra en `v2_ingest_attempts`** | Sí | Todo reintento es auditable igual que un intento original |

---

## Consecuencias

### Positivas

- **Sin infraestructura nueva:** No se requiere Redis, SQS, ni tablas adicionales.
- **Zero-copy de lógica:** El DLQ reutiliza exactamente el mismo `insertDomainEvent` y
  `logIngestAttempt` que el path normal — garantizando consistencia de comportamiento.
- **Auto-abandono limpio:** Después de 10 intentos, el evento deja de ser candidato.
  No desaparece — queda en `v2_ingest_attempts` con historial auditable.
- **Backoff natural:** El cooldown de 10 minutos es suficiente para recuperar de la
  mayoría de errores transitorios de red y DB, sin retries agresivos.
- **Observabilidad completa:** La respuesta JSON del worker en modo DLQ incluye
  `retried`, `inserted`, `deduped`, `skipped`, `errors` — métricas independientes del modo normal.

### Negativas / Riesgos

- **No hay backoff exponencial:** El cooldown es lineal (10 minutos fijos). Si el error
  es sistémico, los intentos se acumularán uniformemente hasta el cap de 10.
  *Mitigación:* El hard cap de 10 intentos acota el daño total.

- **Eventos "non-retryable" no se distinguen automáticamente:** Un evento con un bug
  permanente (ej. payload inválido) será reintentado 10 veces antes de auto-abandonarse.
  *Mitigación:* `error_detail` en `v2_ingest_attempts` permite diagnóstico manual.

- **El modo DLQ compite con el modo normal en el mismo worker slot:**
  No deben ejecutarse simultáneamente. Si se orquestan por cron, deben tener horarios
  distintos o lógica de exclusión.
  *Mitigación:* `mode=dlq` es un parámetro explícito — el cron debe invocarlo separado.

---

## Plan de rollout

1. ✅ Implementar `loadDlqEvents()` en `webhook-to-domain-worker.ts`
2. ✅ Agregar rama `mode=dlq` en la route `/api/worker/v2-webhook-to-domain`
3. ✅ Extender `WorkerRunResult` con campos de resultado DLQ
4. ⬜ (Futuro) Agregar invocación periódica del DLQ vía cron (ej. cada 30 minutos)
5. ⬜ (Futuro) Alerta clínica si `total_attempts >= 7` en algún `event_id`

---

## Cómo monitorear

```sql
-- Eventos en DLQ activo (candidatos que aún pueden reintentarse)
WITH stats AS (
  SELECT
    event_id,
    COUNT(*) AS total_attempts,
    MAX(created_at) AS last_attempt_at,
    bool_or(status = 'error') AS has_error
  FROM public.v2_ingest_attempts
  WHERE event_id IS NOT NULL
  GROUP BY event_id
)
SELECT
  we.event_id,
  we.store_id,
  s.total_attempts,
  s.last_attempt_at
FROM public.v2_webhook_events we
INNER JOIN stats s ON s.event_id = we.event_id
WHERE
  s.has_error = true
  AND NOT EXISTS (SELECT 1 FROM public.v2_domain_events de WHERE de.source_event_id = we.event_id)
  AND s.total_attempts < 10
ORDER BY s.last_attempt_at ASC;

-- Eventos abandonados (>= 10 intentos, sin domain_event)
WITH stats AS (
  SELECT event_id, COUNT(*) AS total_attempts
  FROM public.v2_ingest_attempts WHERE event_id IS NOT NULL
  GROUP BY event_id HAVING COUNT(*) >= 10
)
SELECT we.event_id, we.store_id, s.total_attempts
FROM public.v2_webhook_events we
INNER JOIN stats s ON s.event_id = we.event_id
WHERE NOT EXISTS (SELECT 1 FROM public.v2_domain_events de WHERE de.source_event_id = we.event_id);
```

---

## Criterio de rollback

Si el modo DLQ causa un spike de errores en `v2_ingest_attempts` (ej. por un bug en la
query de candidatos), se puede desactivar simplemente dejando de invocar `?mode=dlq`
en el cron. El código de path normal (`?mode=normal` o sin parámetro) no es afectado.

---

**Firma:** Arquitectura SmartSeller V2 (ADR-0006, vivo)
