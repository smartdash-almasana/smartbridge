name: test_validator

description:
Valida código generado contra contratos, determinismo y tests.

input:
- código generado
- contracts
- contexto

output:
- resultado de validación
- lista de errores

constraints:
- no modificar código
- evaluación determinista
- fail-fast obligatorio

checks:
- tests ejecutan sin errores
- estructura cumple contratos
- no hay duplicados
- outputs deterministas

fail_conditions:
- test falla
- contrato inválido
- output no determinista
