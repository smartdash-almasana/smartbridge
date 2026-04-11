# Auditoría — Token Gate Mercado Libre

## Objetivo
Forzar que el acceso a tokens de Mercado Libre use exclusivamente `getValidToken(storeId)`.

## Archivos modificados
- `src/app/(v2)/api/meli/sync/[store_id]/route.ts`
- `src/v2/lib/meli/oauth.ts`
- `src/app/(v2)/api/auth/meli/callback/route.ts`

## Cambios aplicados
- Eliminada función alternativa `getActiveToken` en `api/meli/sync`.
- `fetchMeliOrders(...)` ahora recibe `storeId` y resuelve token internamente con `getValidToken(storeId)`.
- `getMeliUser(...)` en `v2/lib/meli/oauth.ts` ahora recibe `storeId` y resuelve token internamente con `getValidToken(storeId)`.
- Callback ML dejó de pasar `access_token` externo a `getMeliUser`; usa `user_id` de `tokens.raw` para `externalAccountId`.

## Evidencia de búsqueda global

### 1) Referencias a `v2_oauth_tokens`
Comando:
```bash
rg -n "v2_oauth_tokens" src -S
```
Salida:
```text
src\v2\lib\meli-token.ts:85:        .from('v2_oauth_tokens')
src\v2\lib\meli-token.ts:107:                .from('v2_oauth_tokens')
src\v2\lib\meli-token.ts:119:        .from('v2_oauth_tokens')
src\v2\lib\meli-token.ts:139:        .from('v2_oauth_tokens')
src\app\(v2)\api\meli\sync\[store_id]\route.ts:7://   3. Load active OAuth token for store from v2_oauth_tokens
src\v2\lib\meli\installations.ts:14:        .from('v2_oauth_tokens')
```

### 2) Uso de `getValidToken(storeId)`
Comando:
```bash
rg -n "getValidToken\(" src -S
```
Salida:
```text
src\v2\lib\meli-token.ts:6://   getValidToken(storeId)  →  access_token string (refreshed if needed)
src\v2\lib\meli-token.ts:137:export async function getValidToken(storeId: string): Promise<string> {
src\v2\lib\meli\oauth.ts:179:    const accessToken = await getValidToken(storeId);
src\app\(v2)\api\meli\sync\[store_id]\route.ts:77:    const accessToken = await getValidToken(storeId);
```

### 3) Búsqueda de `getActiveToken`
Comando:
```bash
rg -n "getActiveToken\(" src -S
```
Salida:
```text
(no matches)
```

### 4) Búsqueda de Authorization Bearer
Comando:
```bash
rg -n "Bearer\s*\$\{|Authorization" "src\v2" "src\app\(v2)" -S
```
Salida:
```text
src\v2\lib\meli\oauth.ts:80:export function generateAuthorizationUrl(clientId: string, redirectUri: string): string {
src\v2\lib\meli\oauth.ts:181:        headers: { Authorization: `Bearer ${accessToken}` },
src\app\(v2)\api\meli\sync\[store_id]\route.ts:86:        headers: { Authorization: `Bearer ${accessToken}` },
src\app\(v2)\api\meli\sync\[store_id]\route.ts:95:        headers: { Authorization: `Bearer ${accessToken}` },
```

Nota de evidencia:
- En los 3 matches con header `Authorization`, `accessToken` se obtiene internamente con `getValidToken(storeId)` dentro del mismo módulo.

## Confirmación de camino único de token
- Camino operativo de lectura de token: `getValidToken(storeId)` en `src/v2/lib/meli-token.ts`.
- No hay funciones alternativas `getActiveToken`.
- No hay llamadas activas que inyecten `accessToken` externo para fetches a Mercado Libre.

## Estado final
OK
