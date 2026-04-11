# Operaciones de Ingesta (Runbook Consolidado)

**Objetivo:** Instrucciones detalladas de diagnóstico y mitigación de problemas para el pipeline de ingesta (`webhook_events` -> `domain_events`).

## Arquitectura Actual

El flujo de datos de ingesta atraviesa los siguientes pasos y sistemas:

1. `webhook_events` (Recpción Meli/Shopify -> DB bruta)
2. `Worker API` (Procesamiento y normalización a Domain)
3. `domain_events` (Fuente de Verdad de la Plataforma)
4. `ingest_attempts` (Observabilidad Append-Only de Procesamiento, éxitos y errores)
5. `v2_cron_runs` (Auditoría Append-Only de Jobs de Cron)
6. `pg_cron` (Scheduler Interno cada 10m para Auto-Retry)
7. `pg_net` (Extensión BD que llama a nuestra API `api/worker/v2-webhook-to-domain?mode=dlq&limit=50`)
8. `engine` (Ejecución y Normalización Clínica a Señales) -> `clinical_signals` -> `health_scores`

## 1. Monitor: ¿El Cron DLQ está corriendo?

Verifica si el reintentador automático DLQ (cada 10 min) ha tenido éxito en invocar a Vercel.

**Query de estado del cron DLQ:**
```sql
SELECT job_name, status, pg_net_request_id, created_at, error_message
FROM public.v2_cron_runs
WHERE job_name = 'dlq_reprocessor_10m'
ORDER BY created_at DESC
LIMIT 5;
```

**Si no corre:** 
1. Revisa que el job `dlq_reprocessor_10m` exista en `cron.job`.
2. Verifica si las requests `net.http_get()` fallan localmente. Reintenta manualmente (ver 4).

## 2. Monitor: ¿Qué hay en la DLQ pendiente por reintentar?

Extrae eventos atorados que fallaron `< 10` veces y no tienen un Domain Event asociado.

**Query de Pendientes Muestra DLQ (Candidatos DLQ Activos):**
```sql
WITH stats AS (
  SELECT event_id, COUNT(*) AS total_attempts, MAX(created_at) AS last_attempt_at, bool_or(status = 'error') AS has_error
  FROM public.v2_ingest_attempts
  WHERE event_id IS NOT NULL
  GROUP BY event_id
)
SELECT we.event_id, we.store_id, s.total_attempts, s.last_attempt_at
FROM public.v2_webhook_events we
INNER JOIN stats s ON s.event_id = we.event_id
WHERE s.has_error = true
  AND NOT EXISTS (SELECT 1 FROM public.v2_domain_events de WHERE de.source_event_id = we.event_id)
  AND s.total_attempts < 10
ORDER BY s.last_attempt_at ASC;
```

## 3. Monitor: ¿Problemas de Latencia? (Lag P95 y Error Streaks)

Verifica todos los errores recientes en una ventana dada para identificar si estamos en una falla sistémica (spikes de errores 500 o fallos de red hacia Vercel / DB):

**Query P95 de Error Streak en Attempts:**
```sql
SELECT worker, status, COUNT(*) AS count_recent
FROM public.v2_ingest_attempts
WHERE created_at > now() - interval '1 hour'
GROUP BY worker, status;
```

Si el ratio `error` a `ok` sube drásticamente para el worker `v2-webhook-to-domain`:
1. Verifica los Next.js Server Logs en Vercel.
2. Identifica si es un problema de conectividad o limitación por Supabase Pools.

## 4. Mitigación: Forzando un Reintento (Invocación directa DLQ)

Si decides reintentar el encolado y procesamiento del DLQ de inmediato sin esperar al cron, hay dos formas. Ninguna rompe idempotencia, y ambas registran un log de attempt por diseño.

### Opción A (Vía Supabase DB):
```sql
-- Forzará a pg_net a disparar un HTTP call. Revisa el valor de request id en cron_runs.
SELECT public.run_dlq_reprocessor();
```

### Opción B (Vía Terminal CLI o Curl):
*(Requiere acceso al token `x-cron-secret` válido `dev-123-57`)*

```bash
curl -s -i -H "x-cron-secret: dev-123-57" "https://smartsellerv2.vercel.app/api/worker/v2-webhook-to-domain?mode=dlq&limit=50"
```

## 5. Validación de Integridad Post-Mitigación

1. Selecciona un `event_id` del resultado de la Query #2.
2. Comprueba la inserción de Evento en dominio:
```sql
SELECT domain_event_id, event_type, entity_id 
FROM public.v2_domain_events 
WHERE source_event_id = '<EVENT_ID>';
```
3. (Opcional) Si en general el sistema parece al día, verifica que la cola "Abandonada" no está creciendo (Intentos fallidos = 10 persistentes):
```sql
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
Eventos listados arriba requerirán atención en código fuente o son irrevocablemente corruptos desde origen.
