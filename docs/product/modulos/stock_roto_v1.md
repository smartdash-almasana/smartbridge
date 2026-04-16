# Stock Roto / Quiebre de Stock — Contrato Implementable v1

## 1. Identificación del módulo

* **module_id:** `stock_roto`
* **module_version:** `1.0`
* **nombre:** Stock roto / quiebre de stock
* **categoría:** `commercial_entry_module`
* **propósito:** Detectar riesgo de quiebre, identificar productos con cobertura insuficiente y señalar capital inmovilizado en stock de baja rotación.
* **dolor que resuelve:** La PyME pierde ventas por falta de mercadería y, al mismo tiempo, inmoviliza dinero en productos que no rotan.
* **entidad primaria:** `product`
* **complejidad técnica relativa:** Media
* **enchufe en el sistema:** módulo declarativo que usa ingesta tabular, normalización, reglas de evaluación, findings y acciones sin alterar el core.

## 2. Alcance del módulo

Este módulo trabaja sobre inventario disponible, umbrales de reposición y consumo reciente.

### Incluye

* detección de riesgo de quiebre
* estimación de días de cobertura
* detección de stock inmovilizado
* priorización por criticidad comercial
* sugerencia de acciones de reposición o liquidación

### No incluye

* optimización avanzada de compras
* forecast estacional complejo
* simulación financiera completa
* integración automática con proveedores
* ejecución automática de órdenes de compra

## 3. Input mínimo requerido

### Campos obligatorios

* `sku`
* `producto`
* `stock_actual`
* `stock_minimo`

### Campos opcionales

* `ventas_30_dias`
* `ventas_90_dias`
* `costo_unitario`
* `precio_venta`
* `lead_time_dias`
* `categoria`
* `proveedor`
* `estado_producto`
* `fecha_ultima_venta`

### Regla importante

Si existe `ventas_30_dias`, tiene prioridad sobre `ventas_90_dias` para estimar consumo reciente.
Si no existe ninguno, el módulo puede detectar desvíos estructurales, pero pierde precisión en cobertura.

## 4. Alias aceptados por campo

### `sku`

* sku
* codigo
* codigo_producto
* product_code
* item_id

### `producto`

* producto
* descripcion
* nombre_producto
* product_name
* item_name

### `stock_actual`

* stock_actual
* stock
* existencia
* disponible
* current_stock

### `stock_minimo`

* stock_minimo
* minimo
* punto_pedido
* reorder_point
* min_stock

### `ventas_30_dias`

* ventas_30_dias
* sales_30d
* consumo_30_dias
* rotacion_30_dias

### `ventas_90_dias`

* ventas_90_dias
* sales_90d
* consumo_90_dias
* rotacion_90_dias

### `costo_unitario`

* costo_unitario
* costo
* unit_cost
* costo_promedio

### `precio_venta`

* precio_venta
* precio
* sale_price
* unit_price

### `lead_time_dias`

* lead_time_dias
* lead_time
* dias_reposicion
* reposicion_dias

### `categoria`

* categoria
* rubro
* family
* category

### `proveedor`

* proveedor
* supplier
* vendor

### `estado_producto`

* estado_producto
* estado
* product_status

### `fecha_ultima_venta`

* fecha_ultima_venta
* ultima_venta
* last_sale_date

## 5. Tipos esperados y nulabilidad

| Campo              | Tipo   | Requerido | Nullable |
| ------------------ | ------ | --------: | -------: |
| sku                | string |        Sí |       No |
| producto           | string |        Sí |       No |
| stock_actual       | number |        Sí |       No |
| stock_minimo       | number |        Sí |       No |
| ventas_30_dias     | number |        No |       Sí |
| ventas_90_dias     | number |        No |       Sí |
| costo_unitario     | number |        No |       Sí |
| precio_venta       | number |        No |       Sí |
| lead_time_dias     | number |        No |       Sí |
| categoria          | string |        No |       Sí |
| proveedor          | string |        No |       Sí |
| estado_producto    | string |        No |       Sí |
| fecha_ultima_venta | date   |        No |       Sí |

## 6. Reglas de normalización

* trim de strings
* lowercase para `categoria`, `proveedor`, `estado_producto`
* conversión numérica de campos de stock, ventas, costo y precio
* normalización de fechas a `YYYY-MM-DD`
* equivalentes nulos:

  * `""`
  * `null`
  * `n/a`
  * `-`
  * `s/d`

### Normalización de `estado_producto`

Universo canónico:

* `activo`
* `inactivo`
* `descontinuado`

### Cálculos derivados

* `consumo_mensual = ventas_30_dias` si existe
* si no existe `ventas_30_dias` y existe `ventas_90_dias`, entonces `consumo_mensual = ventas_90_dias / 3`
* `consumo_diario = consumo_mensual / 30` si `consumo_mensual > 0`
* `dias_cobertura = stock_actual / consumo_diario` si `consumo_diario > 0`
* `capital_inmovilizado = stock_actual * costo_unitario` si existe `costo_unitario`

## 7. Validaciones

### Errores bloqueantes

1. archivo vacío
2. dataset sin filas válidas
3. falta de campo obligatorio
4. alias ambiguo o inválido
5. `stock_actual` no numérico
6. `stock_minimo` no numérico
7. `stock_actual < 0`
8. `stock_minimo < 0`

### Errores no bloqueantes

1. falta `ventas_30_dias` y `ventas_90_dias`
2. falta `costo_unitario`
3. falta `lead_time_dias`
4. falta `fecha_ultima_venta`
5. falta `proveedor`

### Regla de duplicados

Se marca fila duplicada si coincide:

* `sku`
  o, si no existe una clave estable:
* `producto + proveedor`

## 8. Reglas de evaluación

### Regla 1 — riesgo de quiebre

**Condición**

* `consumo_diario > 0`
* `dias_cobertura <= lead_time_dias` si existe `lead_time_dias`
* si no existe `lead_time_dias`, usar umbral base: `dias_cobertura <= 7`

### Regla 2 — stock por debajo del mínimo

**Condición**

* `stock_actual <= stock_minimo`

### Regla 3 — stock inmovilizado

**Condición**

* `stock_actual > 0`
* `consumo_mensual == 0`
  o
* `fecha_ultima_venta >= 90` días atrás

### Regla 4 — producto crítico sin cobertura

**Condición**

* riesgo de quiebre
* `consumo_mensual` dentro del percentil alto del dataset

### Regla 5 — capital inmovilizado alto

**Condición**

* stock inmovilizado
* `capital_inmovilizado >= umbral_capital_inmovilizado`

**Valor inicial sugerido**

* `200000` ARS

## 9. Findings esperados

### `riesgo_quiebre_stock`

* **condición:** riesgo de quiebre
* **severity:** `high`
* **unidad de agrupación:** `sku`
* **intención del mensaje:** alertar faltante probable en corto plazo
* **priorización:** por `dias_cobertura asc`, luego `consumo_mensual desc`

### `stock_bajo_minimo`

* **condición:** stock actual por debajo del mínimo
* **severity:** `high`
* **unidad de agrupación:** `sku`
* **intención del mensaje:** marcar reposición urgente
* **priorización:** por diferencia entre `stock_minimo - stock_actual`

### `stock_inmovilizado`

* **condición:** stock sin rotación
* **severity:** `medium`
* **unidad de agrupación:** `sku`
* **intención del mensaje:** señalar inventario estancado
* **priorización:** por `capital_inmovilizado desc`

### `producto_critico_sin_cobertura`

* **condición:** producto de alta salida con cobertura insuficiente
* **severity:** `high`
* **unidad de agrupación:** `sku`
* **intención del mensaje:** proteger ventas sobre productos clave
* **priorización:** por `consumo_mensual desc`

### `capital_inmovilizado_alto`

* **condición:** stock inmovilizado + alto valor
* **severity:** `high`
* **unidad de agrupación:** `sku`
* **intención del mensaje:** marcar costo de oportunidad relevante
* **priorización:** por `capital_inmovilizado desc`

## 10. Acciones sugeridas

### `adelantar_reposicion`

* **trigger:** `riesgo_quiebre_stock` o `stock_bajo_minimo`
* **channel:** `internal`
* **requires_confirmation:** `true`
* **priority intent:** proteger continuidad de venta

### `priorizar_compra_urgente`

* **trigger:** `producto_critico_sin_cobertura`
* **channel:** `internal`
* **requires_confirmation:** `true`
* **priority intent:** asegurar productos de alta rotación

### `liquidar_stock_estancado`

* **trigger:** `stock_inmovilizado`
* **channel:** `internal`
* **requires_confirmation:** `true`
* **priority intent:** liberar capital inmovilizado

### `priorizar_revision_manual`

* **trigger:** `capital_inmovilizado_alto`
* **channel:** `internal`
* **requires_confirmation:** `false`
* **priority intent:** revisar compras, pricing o discontinuación

## 11. Output estructurado

```json
{
  "module_id": "stock_roto",
  "module_version": "1.0",
  "normalized_rows": [],
  "findings": [],
  "suggested_actions": [],
  "summary": {
    "total_rows": 0,
    "valid_rows": 0,
    "invalid_rows": 0,
    "productos_en_riesgo": 0,
    "productos_inmovilizados": 0,
    "capital_inmovilizado_total": 0
  },
  "validation_errors": []
}
```

### Semántica de cada bloque

#### `normalized_rows`

Filas normalizadas y listas para evaluación.

#### `findings`

Lista de hallazgos accionables por producto.

#### `suggested_actions`

Lista de acciones propuestas, no ejecutadas.

#### `summary`

Resumen ejecutivo del módulo.

#### `validation_errors`

Errores detectados durante la ingesta y validación.

## 12. JSON plug-in ejemplo

```json
{
  "module_id": "stock_roto",
  "module_version": "1.0",
  "name": "Stock roto / quiebre de stock",
  "description": "Detecta riesgo de quiebre, identifica productos con cobertura insuficiente y señala capital inmovilizado.",
  "category": "commercial_entry_module",
  "input": {
    "source_types": ["csv", "xlsx", "google_sheet", "api"],
    "required_fields": ["sku", "producto", "stock_actual", "stock_minimo"],
    "optional_fields": [
      "ventas_30_dias",
      "ventas_90_dias",
      "costo_unitario",
      "precio_venta",
      "lead_time_dias",
      "categoria",
      "proveedor",
      "estado_producto",
      "fecha_ultima_venta"
    ],
    "field_aliases": {
      "sku": ["sku", "codigo", "codigo_producto", "product_code", "item_id"],
      "producto": ["producto", "descripcion", "nombre_producto", "product_name", "item_name"],
      "stock_actual": ["stock_actual", "stock", "existencia", "disponible", "current_stock"],
      "stock_minimo": ["stock_minimo", "minimo", "punto_pedido", "reorder_point", "min_stock"],
      "ventas_30_dias": ["ventas_30_dias", "sales_30d", "consumo_30_dias", "rotacion_30_dias"],
      "ventas_90_dias": ["ventas_90_dias", "sales_90d", "consumo_90_dias", "rotacion_90_dias"],
      "costo_unitario": ["costo_unitario", "costo", "unit_cost", "costo_promedio"],
      "precio_venta": ["precio_venta", "precio", "sale_price", "unit_price"],
      "lead_time_dias": ["lead_time_dias", "lead_time", "dias_reposicion", "reposicion_dias"],
      "categoria": ["categoria", "rubro", "family", "category"],
      "proveedor": ["proveedor", "supplier", "vendor"],
      "estado_producto": ["estado_producto", "estado", "product_status"],
      "fecha_ultima_venta": ["fecha_ultima_venta", "ultima_venta", "last_sale_date"]
    },
    "field_types": {
      "sku": "string",
      "producto": "string",
      "stock_actual": "number",
      "stock_minimo": "number",
      "ventas_30_dias": "number",
      "ventas_90_dias": "number",
      "costo_unitario": "number",
      "precio_venta": "number",
      "lead_time_dias": "number",
      "categoria": "string",
      "proveedor": "string",
      "estado_producto": "string",
      "fecha_ultima_venta": "date"
    }
  },
  "normalization": {
    "trim_strings": true,
    "lowercase_fields": ["categoria", "proveedor", "estado_producto"],
    "numeric_fields": [
      "stock_actual",
      "stock_minimo",
      "ventas_30_dias",
      "ventas_90_dias",
      "costo_unitario",
      "precio_venta",
      "lead_time_dias"
    ],
    "date_fields": ["fecha_ultima_venta"],
    "null_equivalents": ["", "null", "n/a", "-", "s/d"],
    "status_mapping": {
      "activo": ["activo", "active"],
      "inactivo": ["inactivo", "inactive"],
      "descontinuado": ["descontinuado", "discontinued"]
    }
  },
  "entity_mapping": {
    "primary_entity": "product",
    "related_entities": ["supplier"],
    "entity_fields": {
      "product": [
        "sku",
        "producto",
        "categoria",
        "stock_actual",
        "stock_minimo",
        "ventas_30_dias",
        "ventas_90_dias",
        "costo_unitario",
        "precio_venta",
        "lead_time_dias",
        "fecha_ultima_venta"
      ],
      "supplier": ["proveedor"]
    }
  },
  "evaluation": {
    "rules": [
      {
        "rule_id": "riesgo_quiebre_stock",
        "type": "coverage",
        "conditions": [
          { "field": "consumo_diario", "operator": ">", "value": 0 },
          { "field": "dias_cobertura", "operator": "<=", "value_field": "lead_time_dias", "fallback_value": 7 }
        ]
      },
      {
        "rule_id": "stock_bajo_minimo",
        "type": "threshold",
        "conditions": [
          { "field": "stock_actual", "operator": "<=", "value_field": "stock_minimo" }
        ]
      },
      {
        "rule_id": "stock_inmovilizado",
        "type": "stagnation",
        "conditions": [
          { "field": "consumo_mensual", "operator": "==", "value": 0 }
        ]
      },
      {
        "rule_id": "capital_inmovilizado_alto",
        "type": "threshold",
        "conditions": [
          { "field": "capital_inmovilizado", "operator": ">=", "value": 200000 }
        ]
      }
    ],
    "priority_formula": "dias_cobertura_asc_then_consumo_mensual_desc"
  },
  "findings": {
    "templates": [
      {
        "finding_code": "riesgo_quiebre_stock",
        "severity": "high",
        "title": "Riesgo de quiebre de stock",
        "message_template": "El producto {producto} tiene cobertura estimada de {dias_cobertura} días."
      },
      {
        "finding_code": "stock_bajo_minimo",
        "severity": "high",
        "title": "Stock por debajo del mínimo",
        "message_template": "El producto {producto} se encuentra por debajo del stock mínimo definido."
      },
      {
        "finding_code": "stock_inmovilizado",
        "severity": "medium",
        "title": "Stock inmovilizado",
        "message_template": "El producto {producto} tiene stock sin rotación reciente."
      },
      {
        "finding_code": "producto_critico_sin_cobertura",
        "severity": "high",
        "title": "Producto crítico sin cobertura",
        "message_template": "El producto {producto} tiene alta salida y cobertura insuficiente."
      },
      {
        "finding_code": "capital_inmovilizado_alto",
        "severity": "high",
        "title": "Capital inmovilizado alto",
        "message_template": "El producto {producto} inmoviliza {capital_inmovilizado} en stock de baja rotación."
      }
    ],
    "group_by": ["sku"],
    "sort_by": ["severity", "dias_cobertura", "capital_inmovilizado"]
  },
  "actions": {
    "templates": [
      {
        "action_code": "adelantar_reposicion",
        "trigger": ["riesgo_quiebre_stock", "stock_bajo_minimo"],
        "channel": "internal",
        "requires_confirmation": true,
        "priority": "high"
      },
      {
        "action_code": "priorizar_compra_urgente",
        "trigger": ["producto_critico_sin_cobertura"],
        "channel": "internal",
        "requires_confirmation": true,
        "priority": "high"
      },
      {
        "action_code": "liquidar_stock_estancado",
        "trigger": ["stock_inmovilizado"],
        "channel": "internal",
        "requires_confirmation": true,
        "priority": "medium"
      },
      {
        "action_code": "priorizar_revision_manual",
        "trigger": ["capital_inmovilizado_alto"],
        "channel": "internal",
        "requires_confirmation": false,
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
```

## 13. Riesgos remanentes

* si no existen ventas históricas, el cálculo de cobertura pierde precisión
* si no existe `lead_time_dias`, el módulo usa un umbral base y baja exactitud
* si no existe `costo_unitario`, no puede estimarse capital inmovilizado con confiabilidad
* si el stock físico no está actualizado, los findings pueden sobreestimar o subestimar el riesgo

**Nombre sugerido:** `stock_roto_v1.md`
**Ubicación sugerida:** `docs/product/modules/stock_roto_v1.md`
