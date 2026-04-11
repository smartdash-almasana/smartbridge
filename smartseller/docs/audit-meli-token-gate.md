# Auditoría: Gate Central de Tokens de Mercado Libre (SmartSeller V2)

## Resumen Ejecutivo
Dentro del sistema, existe una función diseñada como guardián central para el manejo de tokens: `getValidToken(storeId)` ubicada en `src/v2/lib/meli-token.ts`. Su responsabilidad teórica es leer el token desde `v2_oauth_tokens`, verificar si está próximo a expirar (`expires_at`), refrescarlo proactivamente si es necesario, y retornar un `access_token` siempre válido y fresco. 

Sin embargo, el uso de este patrón centralizado no se ha adoptado universalmente en el código base. Se detectan implementaciones paralelas (como en el endpoint de sincronización manual de órdenes) que leen el token de forma directa sin delegar en el gate unificado, y de hecho, tienen lógica de "TODO" en el refresco del mismo. Además, la mayoría de funciones de comunicación a la API de Mercado Libre esperan recibir un `access_token` inyectado como parámetro externo, delegando la responsabilidad de asegurar su validez al flujo de la capa de negocio que las invoque.

## Lista de rutas que usan token de manera directa (por inyección de parámetro)
Las siguientes funciones o módulos se comunican con `api.mercadolibre.com` esperando recibir un `access_token` (en vez de usar el storeId para consultar y auto-refrescar internamente a través de `getValidToken`):

*   **`src/app/(v2)/api/meli/sync/[store_id]/route.ts`**
    *   La función encargada del negocio: `fetchMeliOrders(accessToken: string)`.
    *   Implementa su propio y aislado lector de tokens en base de datos: `getActiveToken(storeId)` con anotación pendiente de revisión `// TODO: refresh if expires_at <= now`.
*   **`src/v2/lib/meli/oauth.ts`**
    *   La función `getMeliUser(access_token: string)` utilizada durante las llamadas de callback de autenticación y vinculación.

## Riesgo Arquitectónico
La principal consecuencia de no pasar todo el acceso a través de un único "Token Gate" es la **fragmentación de conocimiento de seguridad**.
1.  **Falsos positivos clínicos o quiebres operativos:** Un desarrollador que invoque a `fetchMeliOrders` a través del loader incompleto actual, provocará que la llamada a la red falle con `HTTP 401 Unauthorized` si el token expiró accidentalmente, simplemente porque no usó la ruta oficial de refresco que reside en `getValidToken()`.
2.  **Duplicación de lógica:** Cada vez que otro agente construya una nueva característica, si observa el código de `/sync`, puede adoptar el antipatrón y usar el token en crudo.
3.  **Filtración del refresh error:** Si Meli falla y retorna un `invalid_grant` cuando se refresca, la lógica actual en la clase base (`ReauthorizationRequired`) marca la cuenta con estatus 'invalid', una responsabilidad arquitectónica que jamás podría asumirse o escalarse si todos manejan su propia versión de carga de token.

## Estado
**CRÍTICO** (El patrón oficial existe pero está bypasseado en flujos críticos actuales. Falla la unicidad y hay un alto riesgo de degradación operativa al ejecutar llamadas de validación contra APIs con un token malamente validado).
