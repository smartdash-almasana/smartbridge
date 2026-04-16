# Module Loader & Validation v1 — SmartPyME / SmartCounter

## 1. Propósito

Este documento define cómo se cargan, validan y habilitan los módulos comerciales declarativos del sistema. Su objetivo es asegurar que un módulo nuevo pueda incorporarse sin alterar el core y sin romper consistencia operativa.

## 2. Alcance

Esta especificación cubre:

- carga del registry de módulos
- carga del documento declarativo de cada módulo
- validación estructural del schema
- validación semántica mínima
- reglas de rechazo
- reglas de activación del módulo

No cubre:

- ejecución de acciones
- UI de administración
- versionado de tenants
- marketplace externo de módulos

## 3. Objetos que intervienen

### 3.1 Registry
Archivo canónico:
- `docs/product/modules/modules_registry_v1.json`

Función:
- listar módulos activos
- declarar versión
- apuntar al documento fuente de cada módulo
- declarar inputs mínimos, outputs y catálogos esperados

### 3.2 Module contract
Archivo canónico por módulo:
- `docs/product/modules/<module_name>_v1.md`

Función:
- documentar contrato implementable
- fijar reglas de input, findings, acciones y output
- servir como fuente de verdad funcional

### 3.3 Module schema
Archivo canónico:
- `docs/product/modules/module_schema_v1.md`

Función:
- fijar estructura obligatoria para todos los módulos

## 4. Flujo de carga

### Paso 1 — cargar registry
El sistema lee `modules_registry_v1.json`.

### Paso 2 — validar estructura del registry
Se valida:
- presencia de `registry_version`
- presencia de `modules`
- unicidad de `module_id`
- unicidad de `doc_path`
- formato válido de cada entrada

### Paso 3 — resolver módulos activos
Se toman solo módulos con:
- `status = "active"`

### Paso 4 — cargar contrato de cada módulo
Para cada módulo activo:
- se resuelve `doc_path`
- se carga su definición operativa o representación estructurada derivada
- se verifica consistencia con el registry

### Paso 5 — validar contra `module_schema_v1`
Cada módulo debe cumplir el schema base.

### Paso 6 — validar consistencia semántica
Se valida:
- required fields
- aliases
- findings declarados
- actions declaradas
- output declarado
- compatibilidad con el registry

### Paso 7 — habilitar módulo
Si pasa todas las validaciones:
- el módulo queda disponible para ejecución

Si falla:
- queda rechazado
- se registra motivo
- no se expone al runtime

## 5. Contrato mínimo del loader

## Input del loader
- `registry_path`
- `schema_path`
- `module_paths[]`

## Output del loader
```json id="6uq7x4"
{
  "loaded_modules": [],
  "rejected_modules": [],
  "validation_errors": [],
  "registry_version": "1.0"
}