SmartSeller V2.1 — QA Report Template
Información General

Fecha de ejecución:

Tester:

Entorno (Prod / Staging):

Commit SHA validado:

Store_id utilizado:

Tenant_id utilizado:

1️⃣ Ingesta — Webhook → Domain Event
1.1 Inserción de Webhook

Webhook insertado manualmente: ☐ Sí ☐ No

event_id generado:

provider_event_id:

Evidencia SQL adjunta: ☐ Sí ☐ No

Resultado:
☐ PASS
☐ FAIL

Observaciones:

1.2 Ejecución Worker

HTTP 200: ☐ Sí ☐ No

scanned:

inserted:

deduped:

Resultado esperado:

inserted = 1

deduped = 0

Resultado:
☐ PASS
☐ FAIL

Observaciones:

1.3 Validación Domain Event

1 sola fila creada: ☐ Sí ☐ No

entity_type correcto: ☐ Sí ☐ No

event_type correcto: ☐ Sí ☐ No

normalized_at no null: ☐ Sí ☐ No

Resultado:
☐ PASS
☐ FAIL

2️⃣ Idempotencia

Re-ejecución del worker:

inserted = 0: ☐ Sí ☐ No

deduped >= 1: ☐ Sí ☐ No

No se creó segunda fila: ☐ Sí ☐ No

Resultado:
☐ PASS
☐ FAIL

3️⃣ Observabilidad — Ingest Attempts

Existe registro en v2_ingest_attempts: ☐ Sí ☐ No

worker correcto: ☐ Sí ☐ No

status consistente: ☐ Sí ☐ No

created_at consistente: ☐ Sí ☐ No

Resultado:
☐ PASS
☐ FAIL

4️⃣ DLQ Reprocessor

Simulación de error realizada: ☐ Sí ☐ No

Validaciones:

Se registró status='error': ☐ Sí ☐ No

No se creó domain_event inválido: ☐ Sí ☐ No

Evento aparece como candidato DLQ: ☐ Sí ☐ No

Ejecución modo DLQ manual:

HTTP 200: ☐ Sí ☐ No

retried >= 1: ☐ Sí ☐ No

Se creó domain_event luego del reproceso: ☐ Sí ☐ No

Resultado:
☐ PASS
☐ FAIL

5️⃣ Cron Autónomo
5.1 Cron activo

Job existe en cron.job: ☐ Sí ☐ No

schedule = */10 * * * *: ☐ Sí ☐ No

active = true: ☐ Sí ☐ No

Resultado:
☐ PASS
☐ FAIL

5.2 Ejecución automática

Existen filas recientes en v2_cron_runs (<15 min): ☐ Sí ☐ No

status mayormente 'ok': ☐ Sí ☐ No

No hay 3 errores consecutivos: ☐ Sí ☐ No

Resultado:
☐ PASS
☐ FAIL

6️⃣ Engine — Score

v2_run_engine_for_store ejecuta sin error: ☐ Sí ☐ No

run_id generado: ☐ Sí ☐ No

status = 'done': ☐ Sí ☐ No

Score persistido en v2_health_scores: ☐ Sí ☐ No

Resultado:
☐ PASS
☐ FAIL

7️⃣ Señales Clínicas

Señales creadas: ☐ Sí ☐ No

evidence JSON consistente: ☐ Sí ☐ No

store_id correcto: ☐ Sí ☐ No

Resultado:
☐ PASS
☐ FAIL

8️⃣ Multi-Tenant Safety

No existen domain_events cruzados entre stores: ☐ Sí ☐ No

No existen signals cruzadas entre stores: ☐ Sí ☐ No

Resultado:
☐ PASS
☐ FAIL

9️⃣ Cardinalidad 1:1

No existen duplicados por source_event_id: ☐ Sí ☐ No

Resultado:
☐ PASS
☐ FAIL

🔟 Lag Operativo

p95 < 5 minutos: ☐ Sí ☐ No

Resultado:
☐ PASS
☐ FAIL

Resultado Global QA

☐ QA APROBADO
☐ QA APROBADO CON OBSERVACIONES
☐ QA RECHAZADO

Incidentes detectados
Recomendaciones del Tester
Criterio Final de Aprobación

El sistema se considera aprobado si:

No hay duplicación

No hay contaminación multi-tenant

El cron corre automáticamente

El DLQ reintenta correctamente

El score es reproducible

Observabilidad completa