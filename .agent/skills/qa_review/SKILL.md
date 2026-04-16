# SKILL: qa_review

## Propósito
Revisar cambios de código, diffs, validaciones y salidas de agentes para determinar si un slice está realmente listo para continuar, mergear o pasar a la siguiente fase, sin mezclar revisión con reimplementación.

## Objetivo operativo
Emitir un dictamen técnico breve, concreto y accionable sobre:
- continuidad del frente activo
- preservación de contratos
- efectos colaterales
- suficiencia de validación
- riesgos reales

Este skill no implementa cambios. Solo revisa y decide.

## Cuándo usar este skill
Usar este skill cuando:
- ya existe un diff o patch
- ya hubo una validación parcial o completa
- hace falta decidir si un cambio quedó cerrado
- se necesita auditar salida de Codex, Claude o Gemini
- se quiere verificar si se puede pasar al siguiente paso

No usar este skill para:
- escribir código nuevo
- rediseñar arquitectura
- hacer brainstorming
- abrir un roadmap amplio
- sustituir una auditoría de repo completa

## Invariantes obligatorios
Toda revisión con este skill debe:
1. Basarse en evidencia concreta
2. Separar hechos de inferencias
3. Identificar solo riesgos reales
4. Verificar contratos y continuidad antes de opinar
5. Cerrar con una conclusión operativa única
6. Escribir `no confirmado` cuando falte evidencia
7. No pedir cambios extra si el objetivo ya quedó cerrado

## Qué revisa
Este skill debe revisar:
- si el objetivo único fue cumplido
- si el radio del cambio quedó acotado
- si los contratos existentes fueron preservados
- si los tests o validaciones son suficientes para el slice
- si aparecieron efectos colaterales
- si el frente activo quedó realmente cerrado

## Qué no revisa
Este skill no debe:
- inventar deuda técnica no relacionada
- reabrir frentes cerrados sin evidencia
- pedir refactors cosméticos
- convertir una revisión en rediseño
- mezclar criterio de negocio con implementación si no corresponde

## Inputs esperados
Puede revisar cualquiera de estos artefactos:
- diff exacto
- lista de archivos modificados
- resultados de tests
- validación directa sin pytest
- skill o prompt generado
- resumen de auditoría

## Criterios de revisión

### 1. Continuidad
- ¿el cambio sigue el frente activo?
- ¿o abre un frente lateral no pedido?

### 2. Contratos
- ¿preserva contratos top-level y rutas esperadas?
- ¿hubo cambios implícitos no declarados?

### 3. Validación
- ¿la evidencia presentada alcanza para considerar cerrado el slice?
- ¿falta evidencia crítica?

### 4. Efectos colaterales
- ¿el cambio tocó módulos ajenos?
- ¿hay riesgo de regresión en otro flujo?

### 5. Listo para continuar
- ¿se puede seguir al siguiente paso sin volver atrás?

## Plantilla maestra

Actuá como Senior QA Reviewer + Continuity Validator.

OBJETIVO ÚNICO
Determinar si el cambio revisado quedó funcionalmente cerrado y listo para continuar.

CONTEXTO CONFIRMADO
- [hecho confirmado 1]
- [hecho confirmado 2]
- [hecho confirmado 3]

ARTEFACTO A REVISAR
- tipo: [diff | patch | test output | validation output | prompt | skill]
- alcance: [qué se revisa exactamente]

RESTRICCIONES DURAS
- No rediseñar arquitectura
- No pedir refactors cosméticos
- No abrir nuevos frentes
- No inventar contexto no confirmado
- Si algo no puede verificarse, escribir “no confirmado”

CRITERIOS DE REVISIÓN
- continuidad del frente activo
- preservación de contratos
- suficiencia de validación
- efectos colaterales
- riesgos reales

FORMATO DE RESPUESTA OBLIGATORIO
Respondé SOLO con:

## DICTAMEN
- estado:
- conclusion_principal:

## HALLAZGOS
1.
2.
3.
4.
5.

## RIESGOS REALES
1.
2.
3.
4.
5.

## VEREDICTO
- cerrar_slice:
- observacion_bloqueante:
- siguiente_decision_correcta:

No agregues roadmap.
No agregues teoría.
No propongas implementación salvo pedido explícito.

## Reglas de severidad para observaciones
Clasificar internamente las observaciones así:
- bloqueante: impide continuar
- importante: no bloquea, pero debe quedar visible
- menor: mejora futura, no frena cierre

No elevar una observación menor a bloqueante.

## Criterio de calidad
La revisión de QA es válida solo si:
- usa evidencia concreta
- no exagera riesgos
- no mezcla mejoras futuras con bloqueo real
- termina en una decisión clara
- ayuda a avanzar sin reabrir todo el trabajo

## Ubicación recomendada en este repo
`.agent/skills/qa_review/SKILL.md`

## Nota específica para SmartPyme / SmartBridge
En este proyecto, este skill debe verificar siempre:
- findings con entidad específica, diferencia cuantificada y comparación explícita de fuentes
- bloqueo bajo incertidumbre cuando corresponde
- continuidad estricta del frente activo
- separación entre:
  - core universal
  - policy/configuración por PyME
  - guía/copilotaje
- prohibición de pasar a un frente nuevo con continuidad rota