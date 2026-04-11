Objetivo del sprint
Entregar pipeline V2 operativo y automatizable de punta a punta en producción, y dejar Score V0 implementado en la API de score con trazabilidad completa. Esto sigue el flujo canónico y los invariantes clínicos documentados. 

Prioridades (en orden)
P0 — Desbloqueo operativo: publicar y validar endpoint worker /api/worker/v2-webhook-to-domain (hoy reportado 404 en prod). 

P0 — Validación real E2E: correr runbook oficial con evidencia de idempotencia. 

P1 — Implementación funcional: completar Score V0 en src/v2/api/score.ts (compute metrics + signals + persist score/snapshot + gate 1h). 

P1 — Conformidad de reglas: alinear implementación con contrato de señales y penalidades. 

Plan diario (5 días)
Día 1 — Deploy y smoke del worker (P0)
Verificar que la ruta worker esté efectivamente desplegada en entorno objetivo.

Confirmar auth por x-cron-secret y CRON_SECRET.

Ejecutar curl de smoke y validar respuesta esperada (no 404).
DoD: endpoint responde 200/401 según corresponda; 404 eliminado. 

Día 2 — Runbook E2E completo en entorno real (P0)
Ejecutar pasos 1→5 del runbook.

Guardar evidencia en doc (IDs, counts, run_id, score, signals).

Re-ejecución para validar no duplicación de domain events.
DoD: domain_count=1 tras segunda corrida + engine_runs.status='done' + score generado. 

Día 3 — Implementación Score V0: métricas + señales (P1)
Añadir en src/v2/api/score.ts la capa de cómputo:

agregación diaria de métricas desde v2_domain_events,

evaluación de señales V0,

persistencia de señales.

Mantener determinismo sin APIs externas.
DoD: métricas y señales persistidas con base en DB solamente. 

Día 4 — Score final + snapshot + recompute gate 1h (P1)
Aplicar fórmula de score y persistir v2_health_scores.

Persistir snapshot auditable con payload.

Implementar/validar gate de recomputo 1h.
DoD: segunda llamada dentro de 1h reutiliza score persistido; fuera de 1h recalcula. 

Día 5 — Hardening, QA y documentación (P1/P2)
Ejecutar suite mínima automática documentada.

Actualizar evidencia E2E y docs de operación.

Checklist final de invariantes multi-tenant y trazabilidad (run_id, snapshot_id).
DoD: evidencia actualizada + criterios de aceptación firmados. 

Backlog sugerido (tickets)
T1 (P0): “Deploy worker route en producción + verificación CRON_SECRET”.

T2 (P0): “Ejecutar runbook E2E y adjuntar evidencia operativa”.

T3 (P1): “Implementar computeScoreV0 y upsert v2_metrics_daily”.

T4 (P1): “Implementar evaluateSignals y persistencia v2_clinical_signals”.

T5 (P1): “Persistir v2_health_scores + v2_snapshots + recompute gate 1h”.

T6 (P2): “Actualizar documentación técnica/operativa y ADR si cambia arquitectura”. 

Criterios de aceptación del sprint
Worker HTTP disponible y protegido por secreto (sin 404). 

Runbook E2E completo aprobado con evidencia SQL/curl. 

Score endpoint ya no “solo lee”; calcula y persiste V0 según contrato. 

Trazabilidad garantizada (run_id, snapshot_id) en outputs clínicos. 

Riesgos y mitigación
Riesgo: desalineación entre docs antiguas y estado real de deploy.
Mitigación: usar runbook como fuente de verificación y registrar evidencia de ejecución real.

Riesgo: reglas de score ambiguas entre plan y contrato.
Mitigación: tratar V2_SCORE_V0_CONTRACT.md como fuente normativa y documentar cualquier cambio.

Riesgo: regresiones de idempotencia.
Mitigación: repetir validación de segunda corrida (inserted=0, domain_count=1). 

Comandos usados para armar esta propuesta
✅ rg --files docs

✅ sed -n '1,220p' docs/README.md

✅ sed -n '1,260p' docs/V2_SCORE_V0_PLAN.md

✅ sed -n '1,320p' docs/runbook-v2-e2e.md

✅ sed -n '1,260p' docs/e2e-execution-evidence.md

✅ sed -n '1,260p' docs/audit-v2-worker-webhook-to-domain-hardening.md

✅ sed -n '1,240p' docs/V2_SCORE_V0_CONTRACT.md

✅ nl -ba docs/README.md | sed -n '1,220p'

✅ nl -ba docs/V2_SCORE_V0_PLAN.md | sed -n '1,300p'

✅ nl -ba docs/runbook-v2-e2e.md | sed -n '1,280p'

✅ nl -ba docs/e2e-execution-evidence.md | sed -n '1,260p'

✅ nl -ba docs/audit-v2-worker-webhook-to-domain-hardening.md | sed -n '1,260p'

✅ nl -ba docs/V2_SCORE_V0_CONTRACT.md | sed -n '1,240p'