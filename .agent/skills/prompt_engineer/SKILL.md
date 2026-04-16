# SKILL: prompt_engineer

## Propósito
Generar prompts profesionales, específicos, ejecutables y seguros para agentes de implementación o revisión dentro de la factoría SmartPyme, evitando ambigüedad, deriva arquitectónica y gasto innecesario de contexto.

## Objetivo operativo
Transformar una necesidad concreta del frente activo en un prompt listo para usar, con:
- un solo objetivo
- contexto confirmado
- restricciones duras
- criterio de aceptación
- formato de salida verificable

Este skill no implementa código ni revisa diffs por sí mismo. Solo produce instrucciones de alta calidad para otros agentes.

## Cuándo usar este skill
Usar este skill cuando:
- ya existe una necesidad técnica concreta
- el estado del repo fue auditado o está confirmado
- se necesita delegar trabajo a Codex, Claude o Gemini
- hace falta comprimir contexto largo en una instrucción útil

No usar este skill para:
- brainstorming abierto
- roadmap general
- teoría de producto
- rediseño de arquitectura
- ejecutar cambios directamente

## Invariantes obligatorios
Todo prompt generado por este skill debe:
1. Tener un único objetivo
2. Basarse solo en contexto confirmado
3. Evitar teoría innecesaria
4. Limitar el radio de acción
5. Incluir archivos permitidos si aplica
6. Declarar restricciones duras
7. Definir criterio de aceptación
8. Exigir una respuesta estructurada y verificable

## Política de contexto
Antes de generar un prompt:
- eliminar historia no necesaria
- eliminar explicaciones teóricas
- conservar solo:
  - estado actual
  - problema puntual
  - archivos relevantes
  - restricciones
  - definición de done

Si algo no está confirmado, escribir:
- `no confirmado`

## Tipos de prompt que este skill puede producir

### 1. Prompt de implementación
Para cambios de código puntuales.

### 2. Prompt de auditoría
Para inspección de repo, módulos, riesgos o continuidad.

### 3. Prompt de validación
Para verificar un patch, contrato o comportamiento.

### 4. Prompt de revisión
Para revisar skills, prompts, diffs o decisiones arquitectónicas.

## Selección de agente objetivo

### Codex
Usar si la tarea requiere:
- editar código
- crear tests
- producir diff
- validar comportamiento localizado

### Claude
Usar si la tarea requiere:
- revisión crítica
- auditoría de consistencia
- dictamen arquitectónico
- análisis de riesgos

### Gemini
Usar si la tarea requiere:
- auditoría de contexto amplio
- lectura masiva
- compresión de contexto
- generar el siguiente handoff
- comparar docs y runtime

## Estructura obligatoria del prompt
Todo prompt generado debe contener estas secciones, en este orden:

1. Rol técnico explícito
2. Objetivo único
3. Contexto confirmado
4. Alcance o archivos permitidos
5. Restricciones duras
6. Criterio de aceptación
7. Formato de respuesta obligatorio

## Plantilla maestra

Actuá como [ROL TÉCNICO ESPECÍFICO].

OBJETIVO ÚNICO
[describir una sola misión]

CONTEXTO CONFIRMADO
- [hecho confirmado 1]
- [hecho confirmado 2]
- [hecho confirmado 3]

ARCHIVOS PERMITIDOS
- [archivo 1]
- [archivo 2]

RESTRICCIONES DURAS
- No rediseñar arquitectura
- No abrir frentes nuevos
- No tocar archivos fuera del alcance permitido
- No inventar contexto no confirmado
- Si detectás diferencias extra no necesarias para este cierre, ignorarlas

CRITERIO DE ACEPTACIÓN
- [condición objetiva 1]
- [condición objetiva 2]
- [condición objetiva 3]

FORMATO DE RESPUESTA OBLIGATORIO
Respondé SOLO con:

## RESULTADO
- estado:
- objetivo_cumplido:

## CAMBIOS / HALLAZGOS
- [ítem 1]&#58; - [ítem 2]&#58; 
## VALIDACIÓN
- evidencia:
- efectos_colaterales_detectados:

No agregues roadmap.
No agregues teoría.
No propongas pasos siguientes.

## Reglas de calidad del prompt
Un prompt es válido solo si:
- puede ejecutarse en una sola iteración
- no depende de interpretación libre del agente
- no mezcla más de un frente
- produce una salida fácil de auditar
- reduce el riesgo de respuestas vagas

## Reglas anti-deriva
Este skill no debe generar prompts que:
- pidan rediseño general sin justificación
- mezclen implementación con estrategia
- omitan restricciones
- omitan formato de respuesta
- dejen abierto el alcance del cambio
- pidan múltiples alternativas sin necesidad real

## Adaptación por agente

### Si el destinatario es Codex
Agregar siempre:
- archivos permitidos explícitos
- prohibición de refactor amplio
- exigencia de diff exacto
- tests o validación concreta

### Si el destinatario es Claude
Agregar siempre:
- criterio de revisión
- foco en riesgos y continuidad
- prohibición de roadmap amplio
- dictamen operativo final

### Si el destinatario es Gemini
Agregar siempre:
- foco en auditoría o compresión
- prohibición de escribir código si no se pidió
- necesidad de producir siguiente paso único
- resumen corto y accionable

## Criterio de compresión
Cuando el contexto original sea largo, reducirlo a:
- máximo 10 a 15 bullets
- solo hechos confirmados
- sin citas narrativas largas
- sin repetir decisiones ya consolidadas

## Ubicación recomendada en este repo
`.agent/skills/prompt_engineer/SKILL.md`

## Nota específica para SmartPyme / SmartBridge
En este proyecto, todo prompt generado debe respetar:
- continuidad estricta del frente activo
- findings con entidad específica, diferencia cuantificada y comparación explícita de fuentes
- separación entre:
  - core universal
  - policy/configuración por PyME
  - guía/copilotaje
- prohibición de avanzar a un nuevo frente sin cerrar el actual