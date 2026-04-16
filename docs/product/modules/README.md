# Modules — SmartPyME / SmartCounter

## Propósito

Este directorio concentra la documentación canónica de los módulos comerciales de entrada del sistema.  
Cada módulo representa una solución concreta a un dolor PyME y se define como un contrato declarativo enchufable al core existente.

## Documentos del directorio

### 1. Schema general
- **Archivo:** `module_schema_v1.md`
- **Rol:** define el contrato base que debe cumplir cualquier módulo nuevo.

### 2. Registro de módulos
- **Archivo:** `modules_registry_v1.json`
- **Rol:** lista oficial de módulos activos, su versión, inputs mínimos, outputs y catálogos asociados.

### 3. Módulos activos

#### `cobranzas_vencidas`
- **Archivo:** `cobranzas_vencidas_v1.md`
- **Dolor que resuelve:** falta de claridad sobre deuda vencida y prioridad de cobro.

#### `stock_roto`
- **Archivo:** `stock_roto_v1.md`
- **Dolor que resuelve:** pérdida de ventas por quiebre de stock y capital inmovilizado.

#### `conciliacion_ventas_ml`
- **Archivo:** `conciliacion_ventas_ml_v1.md`
- **Dolor que resuelve:** falta de visibilidad sobre margen neto real en ventas de Mercado Libre.

## Regla de incorporación de nuevos módulos

Todo módulo nuevo debe cumplir este orden:

1. definirse con `module_schema_v1.md`
2. registrarse en `modules_registry_v1.json`
3. tener su documento de contrato implementable propio
4. respetar el shape de output canónico
5. no exigir cambios en la arquitectura core

## Estado actual

### Módulos activos v1
- `cobranzas_vencidas`
- `stock_roto`
- `conciliacion_ventas_ml`

### Estado del catálogo
- schema base: definido
- registry base: definido
- contratos individuales: definidos

## Regla de gobierno

- el core del sistema permanece estable
- los módulos crecen por contrato declarativo
- cada módulo nuevo debe entrar como extensión, no como excepción
- cambios de contrato deben versionarse explícitamente

## Próximo paso natural

El siguiente documento a consolidar es la especificación de:
- validación automática del schema
- loader del registry
- convención de versionado de módulos