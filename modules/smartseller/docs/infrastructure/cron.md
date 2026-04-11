# Infrastructura: Tareas Programadas (Pg Cron)

SmartSeller V2 hace uso de la extensión `pg_cron` nativa de Supabase para disparar tareas asincrónicas sin depender de servicios de cómputo externos (como Vercel Cron, Trigger.dev u otras colas externas).
En sintonía con **ADR-0007**, todo cron_job dispara una función PL/pgSQL que audita su propia ejecución en `public.v2_cron_runs`.

## 1. Extensiones Requeridas

Para operar en cualquier base de datos nueva o entorno de pruebas:
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
```

## 2. Cron Jobs Activos

1. **Ingest Orchestrator (Flujo Normal)**
   * **Nombre (`job_name`)**: `ingest_orchestrator_2m`
   * **Schedule**: `*/2 * * * *` (Cada 2 Minutos)
   * **Función que lo lanza**: `SELECT public.run_ingest_orchestrator();`
   * **Dependencia**: Usa `net.http_get()` (extensión `pg_net`) para invocar el endpoint público en Vercel con API Key.
   * **Destino Real**: `GET https://smartsellerv2.vercel.app/api/worker/v2-webhook-to-domain?limit=50`
   * **Propósito**: Consumir continuamente nuevos `v2_webhook_events` y generar `v2_domain_events` en el camino normal.
   * **Secret**: Autorizado usando payload `x-cron-secret` leído desde `current_setting('app.settings.cron_secret', true)` (sin hardcode en SQL versionado).
   * **Idempotencia de Job**: la migración hace `unschedule` por `job_name` y luego `schedule` del mismo nombre para evitar duplicados.

2. **Reprocesador Cola de Eventos Muertos (DLQ Reprocessor)**
   * **Nombre (`job_name`)**: `dlq_reprocessor_10m`
   * **Schedule**: `*/10 * * * *` (Cada 10 Minutos)
   * **Función que lo lanza**: `SELECT public.run_dlq_reprocessor();`
   * **Dependencia**: Usa `net.http_get()` (extensión `pg_net`) para invocar el endpoint público en Vercel con API Key.
   * **Destino Real**: `GET https://smartsellerv2.vercel.app/api/worker/v2-webhook-to-domain?mode=dlq&limit=50`
   * **Propósito**: Reintentar automáticamente eventos fallidos (DLQ) respetando cooldown y límites de intento definidos por el worker.
   * **Secret**: Autorizado usando payload `x-cron-secret` (se inyecta en la función PL/pgSQL; no expuesto en logs *por diseño*).

## 3. Comandos Útiles de Administración

Ver los cron activos:
```sql
SELECT jobid, schedule, command, nodename, active
FROM cron.job
ORDER BY jobid DESC;
```

Detener manualmente un Job (o re-configurarlo):
```sql
SELECT cron.unschedule(job_id);
```

> **Verificación Operativa:** Para comprobar si PG Cron ejecutó la tarea, y si la web-request salió bien:
```sql
SELECT job_name, status, pg_net_request_id, created_at, error_message
FROM public.v2_cron_runs
ORDER BY created_at DESC;
```
