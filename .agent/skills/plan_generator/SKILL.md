name: plan_generator

description:
Genera planes de implementación determinísticos a partir de requerimientos.

input:
- requerimiento en texto

output:
- Implementation Plan en JSON
- diagrama Mermaid

constraints:
- no asumir contexto no provisto
- no inventar datos
- output estructurado obligatorio

steps:
1. parse input
2. identificar módulos
3. definir contratos
4. generar plan paso a paso

fail_conditions:
- input ambiguo
- falta de datos críticos
