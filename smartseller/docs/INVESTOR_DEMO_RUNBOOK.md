# Investor Demo Runbook (2-3 min)

## 1) Purpose
Este demo muestra, en una sola corrida, que SmartSeller V2 puede:
1. Conectar una cuenta de Mercado Libre por OAuth.
2. Sincronizar eventos y recalcular score clinico.
3. Exponer evidencia auditable (`run_id`, `snapshot_id`, signals).
4. Persistir politicas de alertas por store.

## 2) Preconditions
1. Branch en `main` y cambios pusheados.
2. Build/tests en verde (local o CI): `npm run build` y `npx playwright test`.
3. Variables minimas configuradas:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `MELI_APP_ID`
   - `MELI_CLIENT_SECRET`
   - `MELI_REDIRECT_URI`
4. Callback OAuth configurado en ML apuntando a: `/api/auth/meli/callback`.

## 3) Demo Flow
1. Abrir `/enter` y click en **Conectar ML** (redirige a `/api/auth/meli/start`).
2. Completar OAuth de ML.
   - Vuelta esperada: `/post-login`.
   - Si hay 1 store: redirige a `/dashboard/[store_id]`.
   - Si hay >1 store: `/choose-store` y seleccionar store.
3. En dashboard, click **Sincronizar ahora**.
   - Llama `POST /api/meli/sync/[store_id]`.
   - Esperar respuesta con resumen de sync (eventos procesados y score actualizado).
4. Ver bloque de score en dashboard.
   - Mostrar `score`, `computed_at`, `run_id`, `snapshot_id`.
   - Explicar: `run_id` identifica corrida; `snapshot_id` identifica evidencia persistida.
5. Ir a **Alertas y notificaciones**.
   - Editar un umbral (por ejemplo `no_orders_7d`) y presionar **Guardar**.
   - Recargar página.
   - Verificar persistencia del valor guardado.

## 4) What to Show (speech)
- Score determinista DB-only: no depende de APIs externas para calcular en runtime.
- Trazabilidad completa: `snapshot -> clinical_signals -> health_score` por `run_id/snapshot_id`.
- Configuracion fina por señal: umbrales, severidad y politica de notificacion por store.

## 5) Troubleshooting rapido
1. OAuth no vuelve al producto:
   - Revisar `MELI_REDIRECT_URI` y callback configurado en app ML.
   - Confirmar ruta activa: `/api/auth/meli/callback`.
2. Sync trae 0 eventos:
   - Cuenta ML sin actividad reciente (ej. 14d).
   - Token vencido/invalido o permisos incompletos.
3. Score no cambia:
   - Existe gate de 1h para recompute; si esta fresco devuelve ultimo score.
   - Para demo, usar otro store o esperar ventana.
4. Policies vacia:
   - Esperado antes del primer **Guardar**.
   - Luego de guardar, recargar y validar persistencia.

## 6) Evidence Hooks (opcional)
Endpoints utiles:
- `GET /api/me`
- `POST /api/meli/sync/[store_id]`
- `GET /api/score/[store_id]`
- `GET|POST /api/policies/[store_id]`

SQL checks (max 3):
```sql
-- 1) Ultimo score + trazabilidad
select store_id, score, computed_at, run_id, snapshot_id
from v2_health_scores
where store_id = :store_id
order by computed_at desc
limit 5;

-- 2) Senales clinicas del ultimo run
select store_id, run_id, snapshot_id, signal_key, severity, active, penalty
from v2_clinical_signals
where store_id = :store_id
order by created_at desc
limit 20;

-- 3) Politicas guardadas del store
select store_id, signal_key, threshold_value, enabled, updated_at
from v2_notification_policies
where store_id = :store_id
order by updated_at desc
limit 20;
```
