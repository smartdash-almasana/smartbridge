# Audit — Meli Refresh Single-Flight

## Resumen ejecutivo
- Se implementó un mecanismo single-flight en memoria para `getValidToken(storeId)` usando `refreshLocks`.
- Resultado: para un mismo `storeId`, múltiples llamadas concurrentes reutilizan la misma `Promise` de refresh.
- Se agregó test concurrente mínimo y pasa correctamente.
- Estado final: **OK**.

## Explicación del mecanismo
- Estructura en memoria:
  - `const refreshLocks = new Map<string, Promise<string>>();`
- Flujo en `getValidToken(storeId)` cuando el token expira pronto:
  1. Busca lock existente por `storeId`.
  2. Si existe, hace `await` de esa `Promise`.
  3. Si no existe, crea `Promise` de refresh, la guarda en `refreshLocks`.
  4. Ejecuta refresh y en `finally` elimina el lock.
- Efecto: se ejecuta un solo refresh real por store en concurrencia.

## Evidencia técnica

### Archivo modificado
- `src/v2/lib/meli-token.ts`

Fragmentos relevantes:

```ts
const refreshLocks = new Map<string, Promise<string>>();
```

```ts
if (isExpiringSoon(row.expires_at)) {
    const existing = refreshLocks.get(storeId);
    if (existing) {
        return existing;
    }

    const refreshPromise = (refreshTokenOverride ?? refreshToken)(storeId);
    refreshLocks.set(storeId, refreshPromise);
    try {
        return await refreshPromise;
    } finally {
        if (refreshLocks.get(storeId) === refreshPromise) {
            refreshLocks.delete(storeId);
        }
    }
}
```

Referencias de líneas (búsqueda):
- `refreshLocks`: `src/v2/lib/meli-token.ts:48`
- uso en `getValidToken`: `src/v2/lib/meli-token.ts:170-182`

### Test agregado
- `tests/meli-token-singleflight.spec.ts`

Validación del test:
- Ejecuta dos llamadas concurrentes a `getValidToken('store-123')`.
- Mockea refresh y cuenta invocaciones.
- Verifica `refreshCalls === 1`.
- Verifica limpieza del lock `__getRefreshLocksSize() === 0`.

Fragmento:

```ts
const [tokenA, tokenB] = await Promise.all([
  getValidToken('store-123'),
  getValidToken('store-123'),
]);

expect(tokenA).toBe('new-token');
expect(tokenB).toBe('new-token');
expect(refreshCalls).toBe(1);
expect(__getRefreshLocksSize()).toBe(0);
```

### Evidencia de ejecución
Comando:

```bash
npx playwright test tests/meli-token-singleflight.spec.ts --reporter=line
```

Salida:

```text
Running 1 test using 1 worker
[1/1] tests\meli-token-singleflight.spec.ts:14:7 › meli-token single-flight › two concurrent getValidToken calls execute one refreshToken for same store
1 passed (36.4s)
```

## Confirmación de eliminación del riesgo concurrente
- Antes: dos llamadas concurrentes podían ejecutar refresh duplicado para el mismo `storeId`.
- Ahora: el lock por `storeId` garantiza un único refresh en curso y fan-out por `await` de la misma `Promise`.
- Cobertura mínima agregada y validada con test concurrente.

## Estado final
**OK**
