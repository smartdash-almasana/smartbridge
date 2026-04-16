# Module Schema v1 — SmartPyME / SmartCounter

## 1. Propósito

Este documento define el contrato canónico que debe cumplir cualquier módulo comercial enchufable del sistema. Su objetivo es permitir que nuevos módulos se agreguen sin alterar la arquitectura core.

## 2. Principios del schema

- El core permanece estable.
- Cada módulo declara su contrato en forma explícita.
- El módulo define input, normalización, mapeo, reglas, hallazgos, acciones y output.
- La ejecución sigue siendo determinística.
- Agregar un módulo nuevo no debe requerir cambios en orquestación, findings engine ni action engine.

## 3. Estructura obligatoria del módulo

Todo módulo debe incluir estas secciones:

- `module_id`
- `module_version`
- `name`
- `description`
- `category`
- `input`
- `normalization`
- `entity_mapping`
- `evaluation`
- `findings`
- `actions`
- `output`

## 4. Definición de campos

### 4.1 `module_id`
Identificador único y estable del módulo.

**Reglas**
- string
- obligatorio
- snake_case
- único dentro del catálogo

**Ejemplo**
```json
"module_id": "cobranzas_vencidas"
4.2 module_version

Versión del contrato del módulo.

Reglas

string
obligatorio
formato recomendado: major.minor

Ejemplo

"module_version": "1.0"
4.3 name

Nombre visible del módulo.

Reglas

string
obligatorio
4.4 description

Descripción breve del propósito del módulo.

Reglas

string
obligatoria
4.5 category

Clasificación funcional del módulo.

Reglas

string
obligatoria
valor inicial recomendado: commercial_entry_module
5. Sección input

Define qué puede leer el módulo.

Campos obligatorios
source_types
required_fields
optional_fields
field_aliases
field_types
Reglas
required_fields no puede estar vacío
cada campo requerido debe tener alias definidos
field_types debe cubrir requeridos y opcionales
alias ambiguos deben rechazarse
Ejemplo
"input": {
  "source_types": ["csv", "xlsx", "google_sheet", "api"],
  "required_fields": ["cliente", "monto", "fecha_vencimiento", "estado"],
  "optional_fields": ["telefono", "email", "numero_factura"],
  "field_aliases": {
    "cliente": ["cliente", "razon_social", "customer"],
    "monto": ["monto", "importe", "amount"]
  },
  "field_types": {
    "cliente": "string",
    "monto": "number",
    "fecha_vencimiento": "date",
    "estado": "string"
  }
}
6. Sección normalization

Define cómo se limpian y estandarizan los datos antes de evaluar reglas.

Campos recomendados
trim_strings
lowercase_fields
uppercase_fields
numeric_fields
date_fields
null_equivalents
status_mapping
Reglas
no debe alterar semántica del dato
solo normalización declarativa
no debe contener lógica de negocio compleja
Ejemplo
"normalization": {
  "trim_strings": true,
  "lowercase_fields": ["estado", "email"],
  "numeric_fields": ["monto"],
  "date_fields": ["fecha_vencimiento"],
  "null_equivalents": ["", "null", "n/a", "-"]
}
7. Sección entity_mapping

Define qué entidades del negocio usa el módulo.

Campos obligatorios
primary_entity
related_entities
entity_fields
Reglas
debe existir una entidad primaria
los campos deben mapearse explícitamente
no se permiten entidades implícitas
Ejemplo
"entity_mapping": {
  "primary_entity": "client",
  "related_entities": ["invoice"],
  "entity_fields": {
    "client": ["cliente", "telefono", "email"],
    "invoice": ["numero_factura", "fecha_vencimiento", "monto", "estado"]
  }
}
8. Sección evaluation

Define las reglas de evaluación del módulo.

Campos obligatorios
rules
Campos recomendados
priority_formula
Reglas por item

Cada regla debe incluir:

rule_id
type
conditions

Cada condición debe incluir:

field
operator
value o value_field
Operadores permitidos v1
==
!=
>
>=
<
<=
in
empty
abs_gt
Regla

No se permiten operadores desconocidos.

Ejemplo
"evaluation": {
  "rules": [
    {
      "rule_id": "deuda_vencida",
      "type": "threshold",
      "conditions": [
        { "field": "estado", "operator": "in", "value": ["pendiente", "parcial", "vencida"] },
        { "field": "dias_vencido", "operator": ">=", "value": 1 }
      ]
    }
  ],
  "priority_formula": "dias_vencido_desc_then_monto_base_desc"
}
9. Sección findings

Define los hallazgos que el módulo puede emitir.

Campos obligatorios
templates
group_by
sort_by
Cada template debe incluir
finding_code
severity
title
message_template
Severidades permitidas v1
low
medium
high
critical
Regla

No puede existir una regla evaluable sin al menos un finding template asociado.

Ejemplo
"findings": {
  "templates": [
    {
      "finding_code": "deuda_vencida",
      "severity": "medium",
      "title": "Deuda vencida detectada",
      "message_template": "El cliente {cliente} registra deuda vencida por {monto_base}."
    }
  ],
  "group_by": ["cliente"],
  "sort_by": ["severity", "dias_vencido", "monto_base"]
}
10. Sección actions

Define acciones sugeridas, no ejecutadas automáticamente.

Campos obligatorios
templates
Cada template debe incluir
action_code
trigger
channel
requires_confirmation
priority
Regla

No puede existir finding crítico sin al menos una acción sugerida definida.

Ejemplo
"actions": {
  "templates": [
    {
      "action_code": "enviar_recordatorio",
      "trigger": ["deuda_vencida"],
      "channel": "whatsapp",
      "requires_confirmation": true,
      "priority": "medium"
    }
  ]
}
11. Sección output

Declara qué bloques produce el módulo.

Campos obligatorios
produce_normalized_rows
produce_findings
produce_suggested_actions
produce_summary
produce_validation_errors
Regla

El output debe ser consistente con la ejecución real del módulo.

Ejemplo
"output": {
  "produce_normalized_rows": true,
  "produce_findings": true,
  "produce_suggested_actions": true,
  "produce_summary": true,
  "produce_validation_errors": true
}
12. Validaciones obligatorias del schema
module_id obligatorio y único
module_version obligatoria
ausencia de required_fields => inválido
alias faltante para campo requerido => inválido
tipo no declarado en field_types => inválido
operador desconocido => inválido
regla sin condiciones => inválida
findings sin templates => inválido
actions sin templates => inválido
output incompleto => inválido
entity_mapping sin primary_entity => inválido
group_by o sort_by vacíos => inválido
13. Output canónico esperado de ejecución

Todo módulo debe ser capaz de emitir un output estructurado con esta forma general:

{
  "module_id": "string",
  "module_version": "string",
  "normalized_rows": [],
  "findings": [],
  "suggested_actions": [],
  "summary": {},
  "validation_errors": []
}
14. Ejemplo mínimo válido
{
  "module_id": "cobranzas_vencidas",
  "module_version": "1.0",
  "name": "Cobranzas vencidas",
  "description": "Detecta deuda vencida y prioriza acciones de cobro.",
  "category": "commercial_entry_module",
  "input": {
    "source_types": ["csv", "xlsx"],
    "required_fields": ["cliente", "monto", "fecha_vencimiento", "estado"],
    "optional_fields": ["telefono", "email"],
    "field_aliases": {
      "cliente": ["cliente", "razon_social"],
      "monto": ["monto", "importe"],
      "fecha_vencimiento": ["fecha_vencimiento", "vencimiento"],
      "estado": ["estado", "status"]
    },
    "field_types": {
      "cliente": "string",
      "monto": "number",
      "fecha_vencimiento": "date",
      "estado": "string",
      "telefono": "string",
      "email": "string"
    }
  },
  "normalization": {
    "trim_strings": true,
    "lowercase_fields": ["estado", "email"],
    "numeric_fields": ["monto"],
    "date_fields": ["fecha_vencimiento"],
    "null_equivalents": ["", "null", "n/a", "-"]
  },
  "entity_mapping": {
    "primary_entity": "client",
    "related_entities": [],
    "entity_fields": {
      "client": ["cliente", "telefono", "email"]
    }
  },
  "evaluation": {
    "rules": [
      {
        "rule_id": "deuda_vencida",
        "type": "threshold",
        "conditions": [
          { "field": "estado", "operator": "in", "value": ["pendiente", "vencida"] }
        ]
      }
    ],
    "priority_formula": "monto_desc"
  },
  "findings": {
    "templates": [
      {
        "finding_code": "deuda_vencida",
        "severity": "medium",
        "title": "Deuda vencida detectada",
        "message_template": "El cliente {cliente} tiene deuda vencida."
      }
    ],
    "group_by": ["cliente"],
    "sort_by": ["severity", "monto"]
  },
  "actions": {
    "templates": [
      {
        "action_code": "enviar_recordatorio",
        "trigger": ["deuda_vencida"],
        "channel": "whatsapp",
        "requires_confirmation": true,
        "priority": "medium"
      }
    ]
  },
  "output": {
    "produce_normalized_rows": true,
    "produce_findings": true,
    "produce_suggested_actions": true,
    "produce_summary": true,
    "produce_validation_errors": true
  }
}
15. Regla de evolución
un módulo nuevo debe nacer como archivo declarativo
el core no se modifica para agregar un módulo nuevo
una nueva versión del módulo debe incrementar module_version
si cambia el schema canónico, cambia module_schema_v1 a una nueva versión explícita
16. Conclusión

Este schema define el enchufe estándar para módulos comerciales en SmartPyME / SmartCounter. Su función es permitir crecimiento modular sin alterar la arquitectura central.

Nombre sugerido: module_schema_v1.md
Ubicación sugerida: docs/product/modules/module_schema_v1.md