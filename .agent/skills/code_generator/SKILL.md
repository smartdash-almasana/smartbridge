name: code_generator

description:
Genera código determinista a partir de Implementation Plans estructurados, acotado estrictamente a la estructura de la aplicación (`app/`).

input:
- plan JSON
- módulos
- contracts

output:
- archivos de código
- estructura de carpetas (solo subdirectorios dentro de app/)

constraints:
- no inventar lógica
- no modificar archivos fuera del scope
- respetar naming existente
- output reproducible
- NO escribir en `modules/`
- NO escribir en `ai_factory/`
- NO crear paths arbitrarios

path_rules:
- no escribir fuera de app/
- base structure obligatoria (module types → paths):
  - entrypoint → app/main.py
  - service → app/services/{module}.py
  - adapter → app/adapters/{module}.py
  - domain → app/domain/{module}.py
- respetar estructura existente
- no sobrescribir archivos sin instrucción explícita

steps:
1. parse plan
2. map modules → files (aplicar rules obligatorias)
3. pre_validation:
   - verificar si archivo objetivo existe (abortar si sobrescribe sin permiso o causa conflicto de naming)
4. generar código por módulo
5. validar contratos post-generación

fail_conditions:
- plan inválido
- contratos incompletos
- conflicto con estructura existente
- módulo no mapeable a las reglas estrictas (app/*)
- conflicto de paths (archivo existente)
