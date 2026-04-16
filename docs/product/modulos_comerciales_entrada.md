Módulos Comerciales de Entrada — SmartPyME / SmartCounter
1. Propósito del documento

Este documento formaliza los tres módulos comerciales de entrada de SmartPyME / SmartCounter. Su función es definir las primeras soluciones que se ofrecen al cliente para resolver problemas concretos de caja, control y rentabilidad, sin exigir una implementación completa del sistema desde el inicio.

2. Criterio de selección de módulos

Estos tres módulos se priorizan por cinco razones:

Dolor real: atacan problemas que la PyME ya sufre en su operación diaria.
Urgencia: impactan de forma directa en la caja o en la pérdida de ventas.
Facilidad de venta: no requieren explicar demasiado el problema; el cliente ya lo reconoce.
Claridad del ROI: permiten medir rápido el dinero recuperado o protegido.
Capacidad de expansión: son una puerta de entrada natural al sistema operativo completo.
3. Los 3 módulos
Cobranzas vencidas

Dolor que resuelve
No saber con precisión quién debe, cuánto debe y desde cuándo, afectando la caja y la capacidad de planificación.

Qué no puede ver hoy la PyME
El estado consolidado de sus cuentas a cobrar. La información suele estar repartida entre planillas, sistemas de facturación y seguimiento manual, lo que dificulta ver la deuda total y su antigüedad.

Input mínimo requerido

Excel, CSV o reporte del sistema con:
Cliente
Monto de la factura
Fecha de vencimiento
Estado o saldo adeudado

Qué devuelve el sistema
Un mapa de deuda ordenado por días de atraso, monto y cliente, con prioridad de seguimiento.

Hallazgos típicos

La mayor parte de la deuda vencida está concentrada en pocos clientes.
Existen facturas con más de 90 días de atraso sin gestión de cobro.
El plazo real de cobro supera el plazo comercial acordado.
Hay clientes con deuda recurrente que siguen operando con crédito abierto.

Acciones sugeridas

Priorizar reclamos sobre clientes de mayor deuda o mayor atraso.
Suspender nuevas entregas o crédito por encima de ciertos umbrales.
Ordenar una agenda de seguimiento comercial o administrativo.
Escalar casos críticos a revisión manual.

Valor comercial
Demuestra valor rápido porque hace visible dinero que hoy está trabado. El impacto en caja es directo y fácil de entender.

Complejidad técnica relativa
Baja. Requiere ingesta de datos tabulares, validación básica y reglas simples de clasificación por atraso y monto.

Stock roto / quiebre de stock

Dolor que resuelve
Perder ventas por no tener producto disponible o inmovilizar dinero en stock que no rota.

Qué no puede ver hoy la PyME
La relación entre stock disponible, ritmo de venta y tiempo de reposición. El problema suele aparecer cuando la venta ya se perdió o cuando el exceso de inventario ya inmovilizó capital.

Input mínimo requerido

Base de stock con:
SKU o código de producto
Stock actual
Stock mínimo o punto de pedido
Ventas del último período

Qué devuelve el sistema
Una estimación de riesgo de quiebre por producto y una lectura de capital inmovilizado en artículos de baja rotación.

Hallazgos típicos

Riesgo de quiebre en productos de alta salida dentro de los próximos días.
Productos con stock alto y ventas bajas durante varios meses.
Tiempos de reposición que no alcanzan a cubrir el consumo actual.
Stock concentrado en líneas con baja contribución comercial.

Acciones sugeridas

Adelantar órdenes de compra en productos críticos.
Revisar puntos de pedido y reglas de reposición.
Liquidar o reubicar artículos estancados.
Priorizar seguimiento sobre SKUs con mayor riesgo de venta perdida.

Valor comercial
Protege ventas y libera capital. Es un módulo fácil de justificar porque el impacto económico se puede medir en faltantes y stock inmovilizado.

Complejidad técnica relativa
Media. Exige datos más ordenados y reglas básicas de proyección entre consumo, stock y reposición.

Conciliación de ventas / Mercado Libre

Dolor que resuelve
No saber cuánto ganó realmente la empresa después de comisiones, envíos, retenciones, devoluciones y reclamos.

Qué no puede ver hoy la PyME
El margen neto real por operación, producto o publicación. La información de ventas y liquidaciones suele venir fragmentada y con múltiples descuentos o retenciones difíciles de seguir manualmente.

Input mínimo requerido

Exportación o integración con datos de:
Ventas brutas
Comisiones
Costos de envío
Retenciones
Devoluciones
Reclamos
Acreditaciones

Qué devuelve el sistema
Una conciliación entre lo vendido, lo cobrado y lo descontado, con cálculo de margen neto real y desvíos por operación o grupo de operaciones.

Hallazgos típicos

Productos con buen volumen pero margen neto muy bajo o negativo.
Diferencias entre ventas registradas y acreditaciones efectivas.
Retenciones o costos logísticos no considerados en el cálculo de rentabilidad.
Dinero retenido por reclamos o devoluciones sin seguimiento.

Acciones sugeridas

Revisar precios y costos por producto o publicación.
Ajustar reglas de envío o promociones que destruyen margen.
Priorizar seguimiento de reclamos con fondos retenidos.
Frenar inversión publicitaria en publicaciones con resultado negativo.

Valor comercial
Ordena un problema que el vendedor online siente todos los días: vender no siempre significa ganar. Permite mostrar números claros sobre margen real.

Complejidad técnica relativa
Alta. Requiere mayor volumen de datos, lógica financiera más precisa y, en muchos casos, integración con fuentes externas.

4. Relación con el sistema operativo completo

Estos módulos no son productos aislados. Son puertas de entrada al sistema operativo completo. Cada uno resuelve un problema concreto, pero todos aprovechan la misma base: ingesta, normalización, reglas, hallazgos y acciones. El objetivo es entrar por un dolor puntual, demostrar valor rápido y luego expandir hacia una visión más integral del negocio.

5. Conclusión

Cobranzas vencidas, stock roto y conciliación de ventas / Mercado Libre son los tres módulos iniciales porque combinan dolor real, impacto económico claro y entrada comercial simple. Permiten demostrar valor en poco tiempo y funcionan como el primer paso hacia una adopción más amplia del sistema operativo SmartPyME / SmartCounter.