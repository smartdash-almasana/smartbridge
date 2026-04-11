# Auditoría Real de SmartSeller V2 (Repo y Base de Datos)
*Generado: 19 de Marzo, 2026*

Esta auditoría refleja el **estado factual y verificable** del proyecto **SmartSeller V2** inspeccionando el código fuente y la base de datos viva (`bewjtoozxukypjbckcyt`).

---

## 🚀 1. Mapa Real de Pantallas y Rutas (Frontend)

El ruteo se encuentra en `src/app/` y está dividido entre la interfaz pública y el **Dashboard modular** para stores.

### Interfaz del Dashboard (DashboardLayout)
Se rutea dinámicamente según el `store_id` bajo el wrapper de visualización:
- **Dashboard Principal (Home):** `src/app/(v2)/dashboard/[store_id]/page.tsx`
  - *Estado:* Totalmente implementado con diseño premium. Consume `/api/score/[store_id]`.
- **Centro de Alertas:** `src/app/(v2)/dashboard/[store_id]/alerts/page.tsx`
  - *Estado:* Vista premium para configuración de canales/políticas. Configura `v2_notification_policies`.
- **Signos Vitales:** `src/app/(v2)/dashboard/[store_id]/vital-signs/page.tsx`
  - *Estado:* Vista visual custom.
- **Evolución Clínica:** `src/app/(v2)/dashboard/[store_id]/evolution/page.tsx`
  - *Estado:* Gráfico SVG y línea de tiempo histórica custom de intervenciones.

### Flujo de Acceso
- `/post-login`: Manejo de sesión postauth.
- `/choose-store`: Selector centralizado de tenant-store.
- `/enter`: Gate login inicial.

---

## ⚙️ 2. Mapa Real del Backend (Rutas API y Funcionalidades)

### Endpoints de Servicio
- `GET /api/score/[store_id]`: Retorna el HealthScore y las señales activas. 
  - *Mecanismo:* **Cálculo On-The-Fly**. Si el caché es `< 1h`, usa `v2_health_scores`. Si no, re-calcula agregando `v2_domain_events` sobre `v2_metrics_daily` evaluando 5 reglas deterministas.
- `api/bootstrap/[store_id]`: Gatilla el bootstrap inicial para un store.
- `api/meli/webhook`: Recibe los webhooks del canal e inserta en `v2_webhook_events`.

### Worker Endpoints (Disparos Cron/Disparos Manuales)
- `/api/worker/run-daily-clinical`: Gatilla la secuencia de diagnóstico para refunds, pagos sin vínculos, y zero-price.
- `/api/worker/v2-webhook-to-domain`: Procesa `webhook_events` a `domain_events`.
- `/api/worker/meli-reconcile`: Reconciliador de Drift.
- `/api/worker/token-refresh`: Actualizaciones OAuth.

---

## 📊 3. Auditoría de Base de Datos (Estatica & Datos)

### Coexistencia Multi-Era
La base de datos tiene **3 capas estructurales**:
1.  **Tablas sin prefijo (V1/Legacy):** `webhook_events`, `engine_runs`, `health_scores`, `clinical_events`. *Todavía contienen data.*
2.  **Tablas V2 (SmartSeller V2 - Runtime Actual):** `v2_orders`, `v2_webhook_events`, `v2_domain_events`, `v2_clinical_signals`, `v2_health_scores`, `v2_engine_runs`, `v2_snapshots`, etc.
3.  **Tablas V3 (Draft/Desarrollo):** `v3_...`. Tienen RLS habilitado y poca data.

### Datos Vivos en V2
- `v2_webhook_events`: **17 filas** (Mayoría `orders_v2`).
- `v2_domain_events`: **17 filas**. Cardinalidad 1:1 con webhook_events.
- `v2_clinical_signals`: **30 registros**.
- `v2_health_scores`: **18 registros** calculados.
- `v2_oauth_installations`: **41 registros** creados.

---

## 🩺 4. Estado Real del Pipeline Clínico (Pipeline V2)

El pipeline **SÍ EXISTE y FLUYE** pero con **diseños duales** que deben considerarse:

### Flujo On-Demand (API `score.ts`)
Se gatilla al cargar el Dashboard si el score está *stale/vencido*.
1.  **Webhook Ingest:** handler escribe webhook.
2.  **Normalization Worker:** `v2-webhook-to-domain` escribe `v2_domain_events`.
3.  **Score Aggregate:** `score.ts` agrega `v2_domain_events` por fecha y escribe en `v2_metrics_daily`.
4.  **Signal Evaluation:** Evalúa 5 reglas: `no_orders_7d`, `cancellation_spike`, `unanswered_messages_spike`, `claims_opened`, `low_activity_14d`.
5.  **Audit:** Escribe `v2_snapshots`, `v2_clinical_signals`, y `v2_health_scores`.

### Flujo Batch Orchestrator (`run-daily-clinical-v0.ts`)
Gatilla análisis profundos secuenciales:
1.  Crea un `v2_engine_runs`.
2.  Llama secuencialmente a:
    -   `refund-metrics-worker`
    -   `payments-unlinked-worker`
    -   `zero-price-items-worker`
3.  Escribe las señales resultantes (e.g., `refund_spike_24h`, `zero_price_items_24h`).
4.  Cierra creando un `v2_snapshots` de consolidación.

---

## 🔗 5. Wiring Frontend - Backend - DB

-   **Dashboard Home UI** consume -> `GET /api/score/[store_id]`.
-   **API layer** consume -> `v2_health_scores`, `v2_clinical_signals` filtrando por `run_id` para garantizar que correspondan a la misma ejecución de diagnóstico.
-   **Configuración de Alertas** consume -> `v2_notification_policies`.

---

## 🎯 6. Integraciones Efectivas

-   **Mercado Libre OAuth**: Implementado. `v2_oauth_installations` (40+ registros) documentando disparos de token persistence y bootstrap flows.
-   **Webhook handlers**: Handshake y guardado en DB activo.
-   **Token Refresh:** Tiene tabla `token_refresh_jobs` pero solo registra 0 filas ejecutadas recientemente, indicando que el refresh es gatillado por demanda o polling directo no cronometrado.

---

## ⚠️ 7. Desalineaciones de Documentación vs Código

1.  **Pull vs Push Scoring:** Las docs a menudo refieren a un pipeline asíncrono puro (event-driven). El cálculo de `score.ts` opera con un **Query Aggregate** sobre `v2_domain_events` durante el GET, no por disparos secuenciales de triggers reactivos.
2.  **V3 Infra activa:** Existen rutas y tablas V3 ya montadas (`api/v3/worker/...`). Aún no son el motor de la V2 productiva, pero pueden causar confusión visual de "dos pipelines paralelos".

---

## 🚨 8. Top Riesgos Reales

1.  **Escalabilidad de Aggregate On-Demand:** `score.ts` sumando `v2_domain_events` hoy escala para demos. Si hay miles de órdenes diarias, el GET del dashboard se ralentizará exponencialmente si no se usan triggers secuenciales o Kafka/asynchronous state.
2.  **Drift entre Motores de Señales:** Tener señales creadas por `getLatestScore` (Pull API) y otras por `run-daily-clinical-v0` (Batch Orchestrator) escribiendo en la misma tabla (`v2_clinical_signals`) sin un consolidado reactivo que las unifique bajo un único snapshot.

---
**Firma Factual:** Auditoría Automatizada SmartSeller V2
