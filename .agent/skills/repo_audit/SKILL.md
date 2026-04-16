# SKILL: repo_audit

## Propósito
Auditar el estado real del repo para determinar con evidencia concreta:
- dónde está parado el frente activo
- qué módulos son realmente relevantes
- qué continuidad falta restaurar
- cuál es el siguiente punto correcto de reentrada

Este skill no implementa cambios. Solo inspecciona, sintetiza y fija el estado operativo real.

## Objetivo operativo
Responder con una auditoría breve, verificable y accionable del repo actual, priorizando continuidad exacta por encima de exhaustividad.

## Cuándo usar este skill
Usar este skill cuando:
- se retoma un frente después de una pausa
- hubo `git pull`, rebase o merge reciente
- existe duda entre lo “cerrado” y lo realmente presente en runtime
- se necesita preparar contexto para Codex o Claude
- hay que decidir el siguiente paso sin improvisar

No usar este skill para:
- escribir código
- rediseñar arquitectura
- revisar teoría de producto
- generar roadmap amplio
- validar un diff puntual ya acotado

## Invariantes obligatorios
Toda auditoría con este skill debe:
1. Basarse solo en evidencia del repo inspeccionado
2. Separar hechos confirmados de inferencias
3. Marcar `no confirmado` cuando falte evidencia
4. Identificar solo riesgos reales y específicos
5. Detectar continuidad rota antes de proponer nuevas fases
6. Concluir con un único punto correcto de reentrada
7. No mezclar auditoría con implementación

## Qué debe inspeccionar
Este skill debe revisar, según el caso:
- branch actual
- commit actual
- estado del workspace
- diff respecto de otra rama o commit si aplica
- módulos runtime relevantes
- rutas API montadas o no montadas
- tests presentes o ausentes
- archivos de skills/reglas ya existentes
- deuda bloqueante previa al siguiente paso

## Qué no debe hacer
Este skill no debe:
- inventar cierres no presentes en `main`
- dar por válido un frente solo porque “se dijo” que estaba cerrado
- proponer 5 caminos alternativos si uno es claramente el correcto
- abrir otra fase sin cerrar continuidad
- convertir la auditoría en rediseño arquitectónico

## Preguntas que debe responder
Una auditoría útil debe responder con evidencia:
- ¿qué branch y commit están activos?
- ¿qué partes del frente activo sí están presentes en runtime?
- ¿qué delta falta respecto de lo validado previamente?
- ¿qué módulos son relevantes para el siguiente paso?
- ¿qué riesgo real impide avanzar?
- ¿cuál es el próximo paso único correcto?

## Plantilla maestra

Actuá como Senior Repository Auditor + Continuity Analyst.

OBJETIVO ÚNICO
Auditar el estado real del repo para determinar el punto exacto de reentrada del frente activo.

CONTEXTO CONFIRMADO
- [hecho confirmado 1]
- [hecho confirmado 2]
- [hecho confirmado 3]

TAREA
1. Inspeccionar branch, commit y estado del workspace
2. Identificar módulos runtime relevantes para el frente activo
3. Detectar si existe delta pendiente respecto del cierre previamente validado
4. Listar solo riesgos reales y específicos
5. Concluir con un único siguiente paso correcto

RESTRICCIONES DURAS
- No escribir código
- No rediseñar arquitectura
- No abrir roadmap amplio
- No inventar contexto no confirmado
- Si algo no puede verificarse, escribir “no confirmado”

FORMATO DE RESPUESTA OBLIGATORIO
Respondé SOLO con:

## AUDITORÍA
- branch_actual:
- commit_actual:
- estado_workspace:
- conclusion_general:

## MÓDULOS RELEVANTES
- [área 1]&#58; - [área 2]&#58; - [área 3]&#58; 
## DELTA / CONTINUIDAD
- continuidad_intacta:
- faltante_confirmado:
- evidencia_clave:

## RIESGOS REALES
1.
2.
3.
4.
5.

## PUNTO EXACTO DE REENTRADA
- siguiente_paso_unico:
- justificacion:

No agregues roadmap.
No agregues teoría.
No propongas implementación salvo que se pida explícitamente.

## Reglas de calidad
Una auditoría es válida solo si:
- confirma branch y estado real
- diferencia runtime de documentación
- detecta deltas pendientes concretos
- no exagera riesgos
- entrega una conclusión operativa única

## Reglas de continuidad
Si la auditoría detecta que el frente validado no está realmente en `main`:
- bloquear avance a nueva fase
- restaurar continuidad primero

Si la continuidad está intacta:
- habilitar siguiente fase con una sola recomendación concreta

## Ubicación recomendada en este repo
`.agent/skills/repo_audit/SKILL.md`

## Nota específica para SmartPyme / SmartBridge
En este proyecto, la auditoría debe verificar siempre:
- continuidad estricta del frente activo
- findings con entidad específica, diferencia cuantificada y comparación explícita de fuentes
- separación entre:
  - core universal
  - policy/configuración por PyME
  - guía/copilotaje
- prohibición de avanzar a una nueva capa con `main` desalineado respecto del cierre validado