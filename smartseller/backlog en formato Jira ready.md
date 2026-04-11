EPIC
EPIC-001 — V2 Pipeline Operativo + Score V0 Productivo
Objetivo: dejar operativo en producción el pipeline webhook -> domain -> engine -> score, y completar Score V0 en API con recompute gate y evidencia auditable. 

Definition of Done (Epic):

Worker HTTP disponible (sin 404) y protegido por x-cron-secret. 

Runbook E2E ejecutado con evidencia completa e idempotencia validada. 

/api/score/[store_id] calcula y persiste Score V0 (no solo lectura). 

Reglas de score alineadas al contrato y con trazabilidad run_id/snapshot_id. 

STORIES (Jira ready)
STORY-001 — Publicar y validar Worker Webhook→Domain en producción
Prioridad: P0
Estimate: 5 SP (~1 día)

Descripción:
Habilitar en deployment productivo la ruta /api/worker/v2-webhook-to-domain y verificar comportamiento esperado con autorización por cron secret. 

Criterios de aceptación:

GET /api/worker/v2-webhook-to-domain?limit=50 deja de responder 404. 

Sin header/secret correcto responde 401.

Con secret válido responde 200 y payload de ejecución (scanned/inserted/deduped). 

Subtasks:

Verificar inclusión de route handler en build/deploy.

Validar variables CRON_SECRET en entorno.

Ejecutar smoke test con curl (autorizado/no autorizado).

Registrar evidencia en doc de ejecución.

STORY-002 — Ejecutar Runbook E2E real (DB + worker + engine)
Prioridad: P0
Estimate: 8 SP (~1.5 días)

Descripción:
Ejecutar runbook oficial completo y capturar evidencia de punta a punta. 

Criterios de aceptación:

Inserción de webhook de prueba exitosa.

Conversión a domain event por worker.

v2_run_engine_for_store ejecuta y genera run.

Verificaciones SQL: run done, signal events_last_24h, health_score creado.

Re-run sin duplicación (domain_count = 1). 

Subtasks:

Insertar webhook fake y guardar event_id.

Ejecutar worker HTTP (run 1).

Ejecutar engine RPC.

Correr queries de validación 4.1–4.4.

Ejecutar worker (run 2) y validar idempotencia.

Documentar evidencia final.

STORY-003 — Implementar computeScoreV0 (métricas diarias)
Prioridad: P1
Estimate: 8 SP (~1.5 días)

Descripción:
Agregar cómputo de métricas desde v2_domain_events y persistencia en v2_metrics_daily. 

Criterios de aceptación:

Se calculan claves mínimas JSONB (orders_*, messages_*, claims_*).

Upsert diario por identidad del contrato.

Determinismo: sin APIs externas. 

Subtasks:

Query agregada por store_id y DATE(occurred_at).

Mapper a contrato JSONB.

Upsert v2_metrics_daily.

Tests unitarios de agregación.

STORY-004 — Implementar evaluateSignals (reglas V0)
Prioridad: P1
Estimate: 5 SP (~1 día)

Descripción:
Evaluar señales clínicas V0 y persistir en v2_clinical_signals. 

Criterios de aceptación:

Se evalúan reglas contractuales (no_orders_7d, cancellation_spike, etc.).

Cada señal guarda severidad, active, penalty, evidence.

Datos enlazables por run_id/snapshot_id. 

Subtasks:

Implementar evaluador de ventanas 7d/14d.

Generar evidence JSON por señal.

Persistir señales por run.

Tests de reglas y umbrales.

STORY-005 — Persistir score + snapshot + recompute gate (1h)
Prioridad: P1
Estimate: 8 SP (~1.5 días)

Descripción:
Calcular score final, persistir v2_health_scores, crear snapshot de evidencia y aplicar gate de recomputo por 1 hora. 

Criterios de aceptación:

Fórmula score = clamp(100 - sum(penalidades), 0..100) aplicada.

Persistencia de score con run_id y snapshot_id.

Snapshot con payload auditable.

Dentro de 1h retorna score vigente; fuera de 1h recalcula. 

Subtasks:

Motor de score final y penalidades.

Persistencia v2_health_scores.

Persistencia v2_snapshots.payload.

Implementar gate 1h.

Tests de idempotencia temporal.

STORY-006 — Hardening final + documentación operativa
Prioridad: P2
Estimate: 3 SP (~0.5 día)

Descripción:
Cerrar sprint con evidencia reproducible y actualización documental para evitar drift. 

Criterios de aceptación:

Documentos de auditoría/evidencia actualizados.

Comandos de validación y resultados anexados.

Checklist de invariantes multi-tenant verificado. 

Subtasks:

Actualizar evidencia E2E.

Actualizar runbook si hubo ajustes.

Registrar decisiones en ADR (si aplica).

Publicar checklist de post-deploy.

Estimación total del sprint
Total: 37 SP

Capacidad sugerida: equipo pequeño (2 devs + apoyo QA/ops) en 5 días hábiles.

Dependencias y riesgos clave
Dependencia crítica: despliegue correcto del worker route en prod (hoy el riesgo principal). 

Riesgo funcional: divergencia entre implementación y contrato de score.

Mitigación: usar V2_SCORE_V0_CONTRACT.md como fuente normativa. 

Checks/comandos usados para construir este formato
✅ rg --files docs

✅ nl -ba docs/README.md | sed -n '1,220p'

✅ nl -ba docs/V2_SCORE_V0_PLAN.md | sed -n '1,300p'

✅ nl -ba docs/runbook-v2-e2e.md | sed -n '1,280p'

✅ nl -ba docs/e2e-execution-evidence.md | sed -n '1,260p'

nl -ba docs/audit-v2-worker-webhook-to-domain-hardening.md | sed -n '1,260p'

✅ nl -ba docs/V2_SCORE_V0_CONTRACT.md | sed -n '1,240p'