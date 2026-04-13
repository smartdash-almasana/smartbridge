name: invariant_validator

description:
Valida invariantes críticas del sistema antes de procesamiento.

input:
- payload
- metadata

output:
- validation_result

invariants:
- existencia de ID único
- timestamp válido
- schema completo
- no duplicados

checks:
- schema_valid
- id_present
- timestamp_valid
- idempotency_possible

fail_conditions:
- falta ID
- timestamp inválido
- schema incompleto
