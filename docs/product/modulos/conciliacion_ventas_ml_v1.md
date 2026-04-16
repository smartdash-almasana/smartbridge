# Conciliación de Ventas / Mercado Libre — Contrato Implementable v1

## 1. Identificación del módulo

* **module_id:** `conciliacion_ventas_ml`
* **module_version:** `1.0`
* **nombre:** Conciliación de ventas / Mercado Libre
* **categoría:** `commercial_entry_module`
* **propósito:** Conciliar ventas, acreditaciones, comisiones, envíos, retenciones, reclamos y devoluciones para calcular el margen neto real y detectar desvíos.
* **dolor que resuelve:** La PyME vende, pero no sabe con claridad cuánto ganó realmente después de descuentos, costos del canal, logística, retenciones y reclamos.
* **entidad primaria:** `sale_order`
* **complejidad técnica relativa:** Alta
* **enchufe en el sistema:** módulo declarativo que usa ingesta tabular o integración externa, normalización, matching transaccional, findings y acciones sin alterar el core.

## 2. Alcance del módulo

Este módulo trabaja sobre ventas y liquidaciones del canal, con foco en conciliación económica y detección de desvíos.

### Incluye

* conciliación entre venta y acreditación
* cálculo de margen neto estimado por operación o publicación
* detección de diferencias entre bruto, descuentos y neto cobrado
* identificación de costos ocultos o no previstos
* señalamiento de fondos retenidos por reclamos o devoluciones

### No incluye

* contabilidad general completa
* liquidación impositiva formal
* conciliación bancaria integral
* pricing automático
* ejecución automática de cambios de precio o pauta

## 3. Input mínimo requerido

### Campos obligatorios

* `order_id`
* `sku`
* `monto_venta_bruta`
* `monto_acreditado`
* `comision_ml`

### Campos opcionales

* `costo_envio`
* `retenciones`
* `devolucion`
* `reclamo_abierto`
* `fecha_venta`
* `fecha_acreditacion`
* `publicacion_id`
* `cantidad`
* `costo_producto`
* `moneda`
* `estado_operacion`
* `campaign_cost`

### Regla importante

Si existe `costo_producto`, el módulo puede calcular margen neto más completo. Si no existe, devuelve conciliación económica del canal y margen parcial.

## 4. Alias aceptados por campo

### `order_id`

* order_id
* venta_id
* sale_id
* operation_id
* id_operacion

### `sku`

* sku
* codigo_producto
* item_sku
* product_code

### `monto_venta_bruta`

* monto_venta_bruta
* venta_bruta
* gross_amount
* gross_sale
* total_venta

### `monto_acreditado`

* monto_acreditado
* acreditado
* net_received
* received_amount
* cobro_neto

### `comision_ml`

* comision_ml
* comision
* ml_fee
* marketplace_fee

### `costo_envio`

* costo_envio
* envio
* shipping_cost
* logistics_cost

### `retenciones`

* retenciones
* impuestos
* withholdings
* tax_withholding

### `devolucion`

* devolucion
* refund
* returned_amount

### `reclamo_abierto`

* reclamo_abierto
* claim_open
* dispute_open
* mediacion

### `fecha_venta`

* fecha_venta
* sale_date
* fecha_operacion

### `fecha_acreditacion`

* fecha_acreditacion
* settlement_date
* payout_date

### `publicacion_id`

* publicacion_id
* listing_id
* item_id

### `cantidad`

* cantidad
* qty
* units

### `costo_producto`

* costo_producto
* costo_unitario
* product_cost
* unit_cost

### `moneda`

* moneda
* currency

### `estado_operacion`

* estado_operacion
* status
* sale_status

### `campaign_cost`

* campaign_cost
* costo_publicidad
* ads_cost

## 5. Tipos esperados y nulabilidad

| Campo              | Tipo   | Requerido | Nullable |
| ------------------ | ------ | --------: | -------: |
| order_id           | string |        Sí |       No |
| sku                | string |        Sí |       No |
| monto_venta_bruta  | number |        Sí |       No |
| monto_acreditado   | number |        Sí |       No |
| comision_ml        | number |        Sí |       No |
| costo_envio        | number |        No |       Sí |
| retenciones        | number |        No |       Sí |
| devolucion         | number |        No |       Sí |
| reclamo_abierto    | bool   |        No |       Sí |
| fecha_venta        | date   |        No |       Sí |
| fecha_acreditacion | date   |        No |       Sí |
| publicacion_id     | string |        No |       Sí |
| cantidad           | number |        No |       Sí |
| costo_producto     | number |        No |       Sí |
| moneda             | string |        No |       Sí |
| estado_operacion   | string |        No |       Sí |
| campaign_cost      | number |        No |       Sí |

## 6. Reglas de normalización

* trim de strings
* lowercase para `moneda`, `estado_operacion`
* conversión numérica de importes y costos
* normalización de fechas a `YYYY-MM-DD`
* equivalentes nulos:

  * `""`
  * `null`
  * `n/a`
  * `-`
  * `s/d`

### Normalización de `estado_operacion`

Universo canónico:

* `cerrada`
* `cancelada`
* `devuelta`
* `retenida`
* `en_reclamo`

### Cálculos derivados

* `costos_canal = comision_ml + costo_envio + retenciones + campaign_cost`
* `margen_parcial = monto_acreditado - costos_canal`
* `margen_neto = monto_acreditado - costos_canal - costo_producto` si existe `costo_producto`
* `diferencia_conciliacion = monto_venta_bruta - monto_acreditado`
* `dias_a_acreditar = fecha_acreditacion - fecha_venta` si ambas existen

## 7. Validaciones

### Errores bloqueantes

1. archivo vacío
2. dataset sin filas válidas
3. falta de campo obligatorio
4. alias ambiguo o inválido
5. importes no numéricos
6. `order_id` vacío
7. `monto_venta_bruta < 0`
8. `monto_acreditado < 0`
9. `comision_ml < 0`
10. moneda no soportada si existe

### Errores no bloqueantes

1. falta `costo_producto`
2. falta `fecha_acreditacion`
3. falta `publicacion_id`
4. falta `campaign_cost`
5. falta `estado_operacion`

### Regla de duplicados

Se marca fila duplicada si coincide:

* `order_id`
  o, en su defecto:
* `sku + fecha_venta + monto_venta_bruta`

### Moneda

* si `moneda` no existe, asumir moneda base del tenant
* monedas soportadas v1:

  * `ars`
  * `usd`

## 8. Reglas de evaluación

### Regla 1 — venta no conciliada

**Condición**

* `abs(diferencia_conciliacion) > umbral_diferencia`
* valor inicial sugerido: `1000` ARS o equivalente

### Regla 2 — margen neto negativo

**Condición**

* existe `costo_producto`
* `margen_neto < 0`

### Regla 3 — margen parcial crítico

**Condición**

* no existe `costo_producto`
* `margen_parcial <= umbral_margen_parcial_critico`
* valor inicial sugerido: `0`

### Regla 4 — fondos retenidos por reclamo

**Condición**

* `reclamo_abierto == true`
* `monto_acreditado == 0` o estado `retenida`

### Regla 5 — costo logístico desproporcionado

**Condición**

* `costo_envio / monto_venta_bruta >= 0.20`

### Regla 6 — retención relevante no absorbida

**Condición**

* `retenciones / monto_venta_bruta >= 0.10`

### Regla 7 — acreditación demorada

**Condición**

* existe `fecha_venta` y `fecha_acreditacion`
* `dias_a_acreditar > 7`

## 9. Findings esperados

### `venta_no_conciliada`

* **condición:** diferencia material entre venta bruta y acreditación
* **severity:** `high`
* **unidad de agrupación:** `order_id`
* **intención del mensaje:** señalar desvío económico entre lo vendido y lo cobrado
* **priorización:** por `abs(diferencia_conciliacion) desc`

### `margen_neto_negativo`

* **condición:** margen neto menor a cero
* **severity:** `high`
* **unidad de agrupación:** `sku` o `order_id`
* **intención del mensaje:** alertar pérdida real por venta
* **priorización:** por `margen_neto asc`

### `margen_parcial_critico`

* **condición:** margen parcial muy bajo o nulo
* **severity:** `medium`
* **unidad de agrupación:** `sku`
* **intención del mensaje:** marcar operación de baja rentabilidad aun sin costo de producto
* **priorización:** por `margen_parcial asc`

### `fondos_retenidos_reclamo`

* **condición:** reclamo abierto con fondos retenidos
* **severity:** `high`
* **unidad de agrupación:** `order_id`
* **intención del mensaje:** alertar dinero detenido por gestión incompleta
* **priorización:** por `monto_venta_bruta desc`

### `costo_logistico_desproporcionado`

* **condición:** costo de envío excesivo sobre la venta
* **severity:** `medium`
* **unidad de agrupación:** `sku` o `publicacion_id`
* **intención del mensaje:** señalar publicaciones o productos con logística inviable
* **priorización:** por `% costo_envio sobre venta desc`

### `retencion_relevante`

* **condición:** retención alta sobre venta
* **severity:** `medium`
* **unidad de agrupación:** `sku` o `order_id`
* **intención del mensaje:** hacer visible el peso de retenciones sobre la operación
* **priorización:** por `% retención sobre venta desc`

### `acreditacion_demorada`

* **condición:** demora anormal entre venta y acreditación
* **severity:** `medium`
* **unidad de agrupación:** `order_id`
* **intención del mensaje:** alertar demoras de liquidación
* **priorización:** por `dias_a_acreditar desc`

## 10. Acciones sugeridas

### `revisar_conciliacion`

* **trigger:** `venta_no_conciliada`
* **channel:** `internal`
* **requires_confirmation:** `false`
* **priority intent:** revisión administrativa inmediata

### `ajustar_precio_publicacion`

* **trigger:** `margen_neto_negativo` o `margen_parcial_critico`
* **channel:** `internal`
* **requires_confirmation:** `true`
* **priority intent:** corrección de pricing

### `revisar_logistica`

* **trigger:** `costo_logistico_desproporcionado`
* **channel:** `internal`
* **requires_confirmation:** `true`
* **priority intent:** revisar reglas de envío o condiciones comerciales

### `seguir_reclamo`

* **trigger:** `fondos_retenidos_reclamo`
* **channel:** `internal`
* **requires_confirmation:** `false`
* **priority intent:** destrabar fondos retenidos

### `priorizar_revision_manual`

* **trigger:** `retencion_relevante` o `acreditacion_demorada`
* **channel:** `internal`
* **requires_confirmation:** `false`
* **priority intent:** validar impacto financiero y operativo

## 11. Output estructurado

```json id="ka9nqx"
{
  "module_id": "conciliacion_ventas_ml",
  "module_version": "1.0",
  "normalized_rows": [],
  "findings": [],
  "suggested_actions": [],
  "summary": {
    "total_rows": 0,
    "valid_rows": 0,
    "invalid_rows": 0,
    "ventas_no_conciliadas": 0,
    "margen_negativo_count": 0,
    "fondos_retenidos_count": 0,
    "diferencia_total_conciliacion": 0
  },
  "validation_errors": []
}
```

### Semántica de cada bloque

#### `normalized_rows`

Filas normalizadas y listas para evaluación.

#### `findings`

Lista de hallazgos accionables por orden, SKU o publicación.

#### `suggested_actions`

Lista de acciones propuestas, no ejecutadas.

#### `summary`

Resumen ejecutivo del módulo.

#### `validation_errors`

Errores detectados durante la ingesta y validación.

## 12. JSON plug-in ejemplo

```json id="95gisu"
{
  "module_id": "conciliacion_ventas_ml",
  "module_version": "1.0",
  "name": "Conciliación de ventas / Mercado Libre",
  "description": "Conciliar ventas, acreditaciones, comisiones, envíos, retenciones, reclamos y devoluciones para calcular margen neto real y detectar desvíos.",
  "category": "commercial_entry_module",
  "input": {
    "source_types": ["csv", "xlsx", "google_sheet", "api"],
    "required_fields": [
      "order_id",
      "sku",
      "monto_venta_bruta",
      "monto_acreditado",
      "comision_ml"
    ],
    "optional_fields": [
      "costo_envio",
      "retenciones",
      "devolucion",
      "reclamo_abierto",
      "fecha_venta",
      "fecha_acreditacion",
      "publicacion_id",
      "cantidad",
      "costo_producto",
      "moneda",
      "estado_operacion",
      "campaign_cost"
    ],
    "field_aliases": {
      "order_id": ["order_id", "venta_id", "sale_id", "operation_id", "id_operacion"],
      "sku": ["sku", "codigo_producto", "item_sku", "product_code"],
      "monto_venta_bruta": ["monto_venta_bruta", "venta_bruta", "gross_amount", "gross_sale", "total_venta"],
      "monto_acreditado": ["monto_acreditado", "acreditado", "net_received", "received_amount", "cobro_neto"],
      "comision_ml": ["comision_ml", "comision", "ml_fee", "marketplace_fee"],
      "costo_envio": ["costo_envio", "envio", "shipping_cost", "logistics_cost"],
      "retenciones": ["retenciones", "impuestos", "withholdings", "tax_withholding"],
      "devolucion": ["devolucion", "refund", "returned_amount"],
      "reclamo_abierto": ["reclamo_abierto", "claim_open", "dispute_open", "mediacion"],
      "fecha_venta": ["fecha_venta", "sale_date", "fecha_operacion"],
      "fecha_acreditacion": ["fecha_acreditacion", "settlement_date", "payout_date"],
      "publicacion_id": ["publicacion_id", "listing_id", "item_id"],
      "cantidad": ["cantidad", "qty", "units"],
      "costo_producto": ["costo_producto", "costo_unitario", "product_cost", "unit_cost"],
      "moneda": ["moneda", "currency"],
      "estado_operacion": ["estado_operacion", "status", "sale_status"],
      "campaign_cost": ["campaign_cost", "costo_publicidad", "ads_cost"]
    },
    "field_types": {
      "order_id": "string",
      "sku": "string",
      "monto_venta_bruta": "number",
      "monto_acreditado": "number",
      "comision_ml": "number",
      "costo_envio": "number",
      "retenciones": "number",
      "devolucion": "number",
      "reclamo_abierto": "bool",
      "fecha_venta": "date",
      "fecha_acreditacion": "date",
      "publicacion_id": "string",
      "cantidad": "number",
      "costo_producto": "number",
      "moneda": "string",
      "estado_operacion": "string",
      "campaign_cost": "number"
    }
  },
  "normalization": {
    "trim_strings": true,
    "lowercase_fields": ["moneda", "estado_operacion"],
    "numeric_fields": [
      "monto_venta_bruta",
      "monto_acreditado",
      "comision_ml",
      "costo_envio",
      "retenciones",
      "devolucion",
      "cantidad",
      "costo_producto",
      "campaign_cost"
    ],
    "date_fields": ["fecha_venta", "fecha_acreditacion"],
    "null_equivalents": ["", "null", "n/a", "-", "s/d"],
    "status_mapping": {
      "cerrada": ["cerrada", "closed"],
      "cancelada": ["cancelada", "cancelled"],
      "devuelta": ["devuelta", "returned"],
      "retenida": ["retenida", "withheld"],
      "en_reclamo": ["en_reclamo", "claim_open", "dispute"]
    }
  },
  "entity_mapping": {
    "primary_entity": "sale_order",
    "related_entities": ["product", "listing"],
    "entity_fields": {
      "sale_order": [
        "order_id",
        "fecha_venta",
        "fecha_acreditacion",
        "monto_venta_bruta",
        "monto_acreditado",
        "comision_ml",
        "costo_envio",
        "retenciones",
        "devolucion",
        "reclamo_abierto",
        "estado_operacion",
        "moneda"
      ],
      "product": ["sku", "cantidad", "costo_producto"],
      "listing": ["publicacion_id", "campaign_cost"]
    }
  },
  "evaluation": {
    "rules": [
      {
        "rule_id": "venta_no_conciliada",
        "type": "threshold",
        "conditions": [
          { "field": "diferencia_conciliacion", "operator": "abs_gt", "value": 1000 }
        ]
      },
      {
        "rule_id": "margen_neto_negativo",
        "type": "threshold",
        "conditions": [
          { "field": "margen_neto", "operator": "<", "value": 0 }
        ]
      },
      {
        "rule_id": "margen_parcial_critico",
        "type": "threshold",
        "conditions": [
          { "field": "margen_parcial", "operator": "<=", "value": 0 }
        ]
      },
      {
        "rule_id": "fondos_retenidos_reclamo",
        "type": "logical",
        "conditions": [
          { "field": "reclamo_abierto", "operator": "==", "value": true }
        ]
      },
      {
        "rule_id": "costo_logistico_desproporcionado",
        "type": "ratio",
        "conditions": [
          { "field": "shipping_ratio", "operator": ">=", "value": 0.20 }
        ]
      },
      {
        "rule_id": "retencion_relevante",
        "type": "ratio",
        "conditions": [
          { "field": "withholding_ratio", "operator": ">=", "value": 0.10 }
        ]
      },
      {
        "rule_id": "acreditacion_demorada",
        "type": "threshold",
        "conditions": [
          { "field": "dias_a_acreditar", "operator": ">", "value": 7 }
        ]
      }
    ],
    "priority_formula": "abs_diferencia_desc_then_margen_neto_asc"
  },
  "findings": {
    "templates": [
      {
        "finding_code": "venta_no_conciliada",
        "severity": "high",
        "title": "Venta no conciliada",
        "message_template": "La operación {order_id} presenta una diferencia de conciliación de {diferencia_conciliacion}."
      },
      {
        "finding_code": "margen_neto_negativo",
        "severity": "high",
        "title": "Margen neto negativo",
        "message_template": "La operación o SKU {sku} presenta margen neto negativo."
      },
      {
        "finding_code": "margen_parcial_critico",
        "severity": "medium",
        "title": "Margen parcial crítico",
        "message_template": "La operación {order_id} deja un margen parcial crítico o nulo."
      },
      {
        "finding_code": "fondos_retenidos_reclamo",
        "severity": "high",
        "title": "Fondos retenidos por reclamo",
        "message_template": "La operación {order_id} tiene fondos retenidos por reclamo abierto."
      },
      {
        "finding_code": "costo_logistico_desproporcionado",
        "severity": "medium",
        "title": "Costo logístico desproporcionado",
        "message_template": "La operación {order_id} o el SKU {sku} tienen costo logístico excesivo sobre la venta."
      },
      {
        "finding_code": "retencion_relevante",
        "severity": "medium",
        "title": "Retención relevante",
        "message_template": "La operación {order_id} tiene un peso relevante de retenciones sobre la venta."
      },
      {
        "finding_code": "acreditacion_demorada",
        "severity": "medium",
        "title": "Acreditación demorada",
        "message_template": "La operación {order_id} tardó más de lo esperado en acreditarse."
      }
    ],
    "group_by": ["order_id"],
    "sort_by": ["severity", "diferencia_conciliacion", "margen_neto"]
  },
  "actions": {
    "templates": [
      {
        "action_code": "revisar_conciliacion",
        "trigger": ["venta_no_conciliada"],
        "channel": "internal",
        "requires_confirmation": false,
        "priority": "high"
      },
      {
        "action_code": "ajustar_precio_publicacion",
        "trigger": ["margen_neto_negativo", "margen_parcial_critico"],
        "channel": "internal",
        "requires_confirmation": true,
        "priority": "high"
      },
      {
        "action_code": "revisar_logistica",
        "trigger": ["costo_logistico_desproporcionado"],
        "channel": "internal",
        "requires_confirmation": true,
        "priority": "medium"
      },
      {
        "action_code": "seguir_reclamo",
        "trigger": ["fondos_retenidos_reclamo"],
        "channel": "internal",
        "requires_confirmation": false,
        "priority": "high"
      },
      {
        "action_code": "priorizar_revision_manual",
        "trigger": ["retencion_relevante", "acreditacion_demorada"],
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

* si no existe `costo_producto`, el módulo no puede calcular margen neto completo
* si no existe `fecha_acreditacion`, no puede medir demora de liquidación
* si no hay `order_id` consistente entre fuentes, la conciliación baja de precisión
* si hay múltiples monedas sin conversión, el análisis agregado por monto puede perder coherencia

**Nombre sugerido:** `conciliacion_ventas_ml_v1.md`
**Ubicación sugerida:** `docs/product/modules/conciliacion_ventas_ml_v1.md`
