# SKILL: codex_handoff

## Propósito
Convertir contexto amplio ya auditado en una instrucción de implementación mínima, precisa y segura para Codex, evitando gasto innecesario de tokens y deriva arquitectónica.

## Cuándo usar este skill
Usar este skill solo cuando:
- ya existe una auditoría previa del repo o del frente activo
- el objetivo técnico está acotado
- se requiere editar código, tests o contratos concretos
- el cambio puede expresarse como una microtarea ejecutable

No usar este skill para:
- rediseñar arquitectura
- descubrir el estado general del repo
- brainstorming
- roadmap amplio
- abrir múltiples frentes a la vez

## Modelo operativo
- Gemini / agente auditor absorbe contexto grande
- este skill comprime el contexto
- Codex recibe solo el mínimo necesario para ejecutar
- salida esperada: diff verificable + validación + riesgos

## Invariantes obligatorios
1. Un solo objetivo por ejecución
2. No rediseñar arquitectura salvo instrucción explícita
3. No reauditar el repo completo si ya fue auditado
4. No tocar archivos fuera del alcance permitido
5. Preservar contratos existentes salvo pedido explícito
6. Si falta contexto no confirmado, escribir “no confirmado”, no inventar
7. Toda implementación debe cerrar con evidencia verificable

## Input requerido
El handoff a Codex debe incluir siempre:

- repo
- branch actual
- commit actual si está disponible
- objetivo único
- contexto confirmado
- archivos permitidos
- restricciones duras
- criterio de aceptación
- formato de respuesta obligatorio

## Estructura obligatoria del prompt a Codex

### 1. Rol
Siempre abrir con un rol técnico explícito y específico.
Ejemplos:
- `Actuá como Senior Backend Integrator.`
- `Actuá como Senior Contract Validator.`
- `Actuá como Senior FastAPI Test Engineer.`

### 2. Objetivo único
Definir una sola misión cerrada.
Ejemplo:
- restaurar un delta pendiente
- agregar un contrato faltante
- escribir un test de integración puntual
- validar un patch sin pytest

### 3. Contexto confirmado
Incluir solo hechos ya verificados por auditoría o evidencia.
Nunca pasar historia completa del proyecto si no es necesaria.

### 4. Restricciones duras
Siempre declarar explícitamente:
- qué no puede tocar
- qué frentes no debe abrir
- qué tipo de refactor está prohibido
- qué cambios colaterales no debe introducir

### 5. Criterio de aceptación
Definir condiciones objetivas de cierre:
- tests pasan
- contrato se preserva
- endpoint usa función correcta
- diff limitado
- sin efectos colaterales

### 6. Formato de respuesta
Forzar respuesta estructurada, breve y verificable.

## Plantilla maestra
Usar esta plantilla como base:

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
- No abrir nuevos frentes
- No tocar archivos fuera del alcance permitido
- No hacer refactors por prolijidad
- Si detectás diferencias extra no necesarias para este cierre, ignorarlas

CRITERIO DE ACEPTACIÓN
- [condición objetiva 1]
- [condición objetiva 2]
- [condición objetiva 3]

FORMATO DE RESPUESTA OBLIGATORIO
Respondé SOLO con:

## RESULTADO
- estado:
- archivos_modificados:
- objetivo_cumplido:

## CAMBIOS APLICADOS
- [archivo 1]&#58; - [archivo 2]&#58; 
## VALIDACIÓN
- tests_corridos:
- resultado_tests:
- efectos_colaterales_detectados:

## PATCH
```diff
[pegá acá el diff exacto]