# Release Note: Token Refresh Worker (DoD Evidence Checklist)

**Objetivo:** Validar refresh automático, persistencia en cola y observabilidad.

### 1) Ejecución y Refresh Real (Cola y Tokens)
- [ ] Forzar expiración manual de un token para probar el enqueue (opcional):
  ```sql
  UPDATE public.v2_oauth_tokens SET expires_at = now() + interval '5 minutes' WHERE status = 'active' LIMIT 1;
  ```
- [ ] Disparar worker manualmente (requiere auth):
  ```bash
  curl -s -X GET "https://smartsellerv2.vercel.app/api/worker/token-refresh?limit=50" -H "x-cron-secret: <SECRET>"
  ```
- [ ] Evidencia Worker: *Pegar JSON de respuesta aquí.*
- [ ] Evidencia Token: Validar refresh persistido en la DB.
  ```sql
  SELECT t.store_id, t.expires_at, j.status AS job_status, j.attempts
  FROM public.v2_oauth_tokens t
  JOIN public.token_refresh_jobs j ON t.store_id = j.store_id
  WHERE j.status = 'done' LIMIT 1;
  ```
- [ ] Evidencia DB Refresh: *Pegar row resultante aquí (`status='done'`, `expires_at` actualizado).*

### 2) Observabilidad (Métricas & Heartbeat)
- [ ] Validar registro de actividad del worker.
  ```sql
  SELECT worker_instance, last_seen_at FROM public.v2_worker_heartbeats WHERE worker_name='token-refresh' ORDER BY last_seen_at DESC LIMIT 1;
  SELECT * FROM public.v2_runtime_metrics_minute WHERE worker_name='token-refresh' ORDER BY bucket_minute DESC LIMIT 1;
  ```
- [ ] Evidencia DB Meta: *Pegar rows resultantes de heartbeat y runtime metrics.*

### 3) Auditoría QA Automática (Invariantes)
- [ ] Ejecutar en Supabase SQL Editor script de validación total:
  ```text
  Pegar y correr bloque SQL de `docs/qa/QA_AUTOMATION_TOKEN_REFRESH.sql`
  ```
- [ ] Evidencia QA: *Pegar los 7 rows resultantes. Se esperan todos en estado `PASS`.*
