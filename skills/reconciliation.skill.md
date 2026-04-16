# SKILL: reconciliation

## Propósito
Definir cómo se ejecuta la reconciliación en SmartBridge / SmartCounter sin deriva arquitectónica, produciendo hallazgos accionables y trazables a partir de diferencias entre fuentes.

## Objetivo operativo
Convertir datos ya ingestados y normalizados en:
- comparaciones explícitas entre fuentes
- diferencias cuantificadas por entidad
- findings accionables listos para downstream

Este skill no resuelve ingesta, no reemplaza entity resolution y no ejecuta acciones.

## Cuándo usar este skill
Usar este skill cuando:
- las fuentes ya fueron cargadas o normalizadas
- existe entidad identificable o conjunto comparable
- el objetivo es comparar estado A vs estado B
- se necesita producir findings o señales de reconciliación

No usar este skill para:
- parsear archivos crudos
- resolver ambigüedad de identidad no cerrada
- comunicación al usuario final
- ejecución de acciones
- automatización operativa posterior

## Precondiciones obligatorias
Antes de ejecutar reconciliación, debe cumplirse al menos una de estas condiciones:
1. las entidades ya están validadas
2. la comparación no depende de ambigüedad identitaria
3. cualquier incertidumbre activa ya fue bloqueada y derivada a clarification

Si hay incertidumbre crítica activa, este skill no continúa.

## Invariantes del sistema
Este skill debe preservar siempre:
- no alucinación
- bloqueo ante incertidumbre
- trazabilidad completa
- findings con:
  - entidad específica
  - diferencia cuantificada
  - comparación explícita de fuentes
- separación entre:
  - core universal
  - policy/configuración PyME
  - guía/copilotaje

## Input esperado
El skill trabaja sobre estructuras ya comparables, por ejemplo:
- canonical_rows
- normalized rows
- validated entities
- records from source_a and source_b
- previous decisions if they are explicit and validated

## Contrato mínimo de entrada
```json
{
  "tenant_id": "string",
  "source_a": "string",
  "source_b": "string",
  "rows": [
    {
      "entity_ref": "string",
      "source": "string",
      "amount": 0,
      "attributes": {}
    }
  ]
}
```

## Contrato mínimo de salida
```json
{
  "status": "ok | blocked",
  "findings": [
    {
      "finding_id": "string",
      "entity_ref": "string",
      "metric": "string",
      "difference": 0,
      "source_a_value": 0,
      "source_b_value": 0,
      "severity": "LOW | MEDIUM | HIGH | CRITICAL",
      "message": "string",
      "traceable_sources": ["string"]
    }
  ],
  "uncertainties": []
}
```

## Reglas de ejecución
- Comparar solo registros que pertenezcan a la misma entidad o referencia comparable.
- Nunca comparar entidades no validadas si la identidad afecta el resultado.
- Nunca producir findings sin valores concretos de ambas fuentes, salvo regla explícita de ausencia comparativa.
- Toda diferencia debe poder reconstruirse desde inputs trazables.
- Si una diferencia requiere interpretación no confirmada, bloquear y derivar a clarification.
- Si no hay diferencia material, no generar finding.
- No emitir mensajes narrativos amplios: solo hallazgos estructurados.

## Tipos de reconciliación esperados
Este skill puede cubrir, según el slice:
- monto esperado vs monto pagado
- stock sistema A vs stock sistema B
- documento emitido vs documento registrado
- orden presente en una fuente y ausente en otra
- duplicados comparables
- drift entre realidad y registro documental

## Severidad
Usar severidad basada en impacto explícito y no en intuición.

Referencia general:
- `LOW`: diferencia menor y acotada
- `MEDIUM`: diferencia relevante pero no crítica
- `HIGH`: diferencia de impacto operativo o económico importante
- `CRITICAL`: diferencia con riesgo económico alto o bloqueo fuerte del proceso

Si el repo ya tiene una convención de severidad implementada, respetarla.

## Política de incertidumbre
Bloquear reconciliación si ocurre cualquiera de estos casos:
- identidad ambigua
- moneda no comparable sin tipo de cambio validado
- falta de dato crítico para calcular diferencia
- contradicción con decisión humana persistida
- conflicto entre fuentes sin prioridad definida y sin validación

En esos casos, devolver:
```json
{
  "status": "blocked",
  "findings": [],
  "uncertainties": [
    {
      "reason": "string",
      "entity_ref": "string"
    }
  ]
}
```

## Política de ausencia comparativa
Se permite producir hallazgo por ausencia solo cuando:
- la entidad o registro esperado existe claramente en una fuente
- la ausencia en la otra fuente es verificable
- no depende de inferencia abierta

Ejemplo válido: factura presente en fuente documental y ausente en sistema de pagos.

## Reglas anti-deriva
Este skill no debe:
- inventar reglas de negocio no confirmadas
- mezclar findings con actions
- generar guía al usuario
- crear capas nuevas de infraestructura
- tocar orchestrator o action_engine salvo pedido explícito

## Prompt de implementación recomendado
Usar este skill para pedir cambios a agentes de implementación con este patrón:

```
Actuá como Senior Reconciliation Engineer.

OBJETIVO ÚNICO
Implementar o corregir el slice de reconciliación requerido sin rediseñar arquitectura.

CONTEXTO CONFIRMADO
- [hecho 1]
- [hecho 2]
- [hecho 3]

ARCHIVOS PERMITIDOS
- [archivo 1]
- [archivo 2]

RESTRICCIONES DURAS
- No tocar ingesta salvo dependencia directa
- No tocar action_engine
- No abrir nuevos frentes
- No producir hallazgos sin trazabilidad
- No comparar entidades ambiguas

CRITERIO DE ACEPTACIÓN
- produce findings estructurados
- preserva contratos existentes
- bloquea correctamente ante incertidumbre
- sin efectos colaterales fuera del slice
```

## Casos mínimos de prueba
Todo slice de reconciliación debería validarse al menos contra:
- match correcto con diferencia cuantificada
- igualdad exacta sin finding
- ausencia verificable en una fuente
- entidad ambigua que bloquea
- dato crítico faltante que bloquea
- duplicado detectable
- moneda o unidad no comparable que bloquea

## Criterio de calidad
La implementación de reconciliación es válida solo si:
- no inventa contexto
- expresa diferencias con números
- conserva trazabilidad de fuentes
- bloquea bajo incertidumbre real
- no mezcla findings con ejecución

## Ubicación recomendada en este repo
`skills/reconciliation.skill.md`

## Nota específica para SmartPyme / SmartBridge
En este proyecto, reconciliación debe servir al objetivo mayor:
- reconstruir realidad operativa
- detectar desvíos entre realidad y registro
- alimentar findings accionables
- preparar después comunicación, guía y acción controlada

Nunca debe convertirse en:
- dashboard descriptivo
- resumen narrativo sin evidencia
- automatización ciega