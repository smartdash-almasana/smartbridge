SmartSeller V2.1 — QA Checklist (Dev Tester)
Objetivo

Validar que:

El pipeline es determinístico

La idempotencia funciona

El DLQ reintenta correctamente

El cron corre autónomamente

El score es reproducible

No hay contaminación multi-tenant

La observabilidad es consistente

1️⃣ Ingesta — Webhook → Domain Event
1.1 Insert manual webhook

Insertar 1 webhook de prueba en v2_webhook_events.

Validar:

Se persiste correctamente

provider_event_id respeta UNIQUE por store

1.2 Ejecutar worker normal

Llamar:

/api/worker/v2-webhook-to-domain?limit=50

Con header correcto.

Validar:

HTTP 200

scanned >= 1

inserted = 1

deduped = 0

1.3 Verificar normalización

Query:

SELECT *
FROM v2_domain_events
WHERE source_event_id = '<event_id>';

Validar:

Exactamente 1 fila

entity_type correcto

event_type correcto

normalized_at no null

2️⃣ Idempotencia

Ejecutar nuevamente el worker.

Validar:

inserted = 0

deduped >= 1

No se crea segundo domain_event

3️⃣ Observabilidad — Ingest Attempts

Query:

SELECT *
FROM v2_ingest_attempts
WHERE event_id = '<event_id>';

Validar:

Existe al menos 1 fila

worker correcto

status = ok o skipped

created_at consistente

4️⃣ DLQ — Reprocesamiento

Simular error forzado (ej: romper payload temporalmente o crear evento inválido).

Validar:

Se registra intento con status='error'

No se crea domain_event

Aparece como candidato DLQ

4.1 Ejecutar modo DLQ manual
/api/worker/v2-webhook-to-domain?mode=dlq&limit=50

Validar:

retried >= 1

errors controlados

Registro en ingest_attempts con worker='v2-webhook-to-domain-dlq'

5️⃣ Cron Autónomo

Validar que cron existe:

SELECT *
FROM cron.job
WHERE command ILIKE '%run_dlq_reprocessor%';

Validar:

schedule = */10 * * * *

active = true

5.1 Verificar ejecución automática

Query:

SELECT *
FROM v2_cron_runs
WHERE job_name = 'dlq_reprocessor_10m'
ORDER BY created_at DESC
LIMIT 5;

Validar:

Se insertan filas cada ~10 min

status mayormente 'ok'

No hay error streak

6️⃣ Engine — Score

Ejecutar:

SELECT public.v2_run_engine_for_store('<store_id>');

Validar:

run_id generado

status 'done'

score persistido

6.1 Señales clínicas
SELECT *
FROM v2_clinical_signals
WHERE run_id = '<run_id>';

Validar:

Al menos 1 señal

evidence JSON consistente

store_id correcto

6.2 Health score persistido
SELECT *
FROM v2_health_scores
WHERE run_id = '<run_id>';

Validar:

score coincide con retorno

computed_at no null

7️⃣ Multi-Tenant Safety

Validar:

No existen domain_events cuyo store_id no coincida con webhook original

No existen signals cruzadas entre stores

Query:

SELECT COUNT(*)
FROM v2_domain_events de
JOIN v2_webhook_events we
  ON de.source_event_id = we.event_id
WHERE de.store_id <> we.store_id;

Debe devolver 0.

8️⃣ Lag Operativo

Calcular p95:

SELECT percentile_disc(0.95)
WITHIN GROUP (ORDER BY (de.normalized_at - we.received_at))
FROM v2_webhook_events we
JOIN v2_domain_events de
  ON de.source_event_id = we.event_id
WHERE we.received_at > now() - interval '24 hours';

Validar:

p95 < 5 minutos

9️⃣ No Drift de Cardinalidad

Validar modelo 1:1:

SELECT source_event_id, COUNT(*)
FROM v2_domain_events
GROUP BY source_event_id
HAVING COUNT(*) > 1;

Debe devolver 0 filas.

10️⃣ Resiliencia bajo fallo parcial

Forzar error en 1 evento

Confirmar:

No se cae el batch

Se registra error

Cron DLQ lo reprocesa

Criterio de Aprobación QA

QA aprobado si:

No hay duplicación de domain_events

No hay contaminación multi-tenant

Cron corre automáticamente

Score es reproducible

Observabilidad es completa

DLQ reintenta correctamente

No hay error streak persistente

Resultado esperado

SmartSeller V2.1 debe comportarse como:

Sistema clínico determinístico, idempotente y resiliente.