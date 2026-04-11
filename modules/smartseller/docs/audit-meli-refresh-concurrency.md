# Auditoría de Concurrencia — meli-token

## Resumen ejecutivo
Se auditó la concurrencia de `getValidToken(storeId)` y `refreshToken(storeId)` en:
- `src/v2/lib/meli-token.ts`

Resultado:
- No se encontró mecanismo explícito de exclusión mutua para evitar doble refresh concurrente.
- No se encontró lock DB ni single-flight en memoria.
- No se encontró re-check de expiración luego de adquirir lock (no hay lock).

## Evidencia técnica (fragmentos relevantes)

### 1) Lectura y refresh sin transacción explícita
Archivo: `src/v2/lib/meli-token.ts`

```ts
82: export async function refreshToken(storeId: string): Promise<string> {
83:     // 1. Read current refresh_token
84:     const { data: row, error: readErr } = await supabaseAdmin
85:         .from('v2_oauth_tokens')
86:         .select('refresh_token, status')
87:         .eq('store_id', storeId)
88:         .maybeSingle<Pick<TokenRow, 'refresh_token' | 'status'>>();
```

No hay uso de transacción explícita alrededor de read + refresh externo + update.

### 2) Llamada externa a ML sin lock previo

```ts
98:     // 2. Call ML
99:     let meli: MeliTokenResponse;
100:     try {
101:         meli = await callMeliRefresh(row.refresh_token);
```

### 3) Persistencia posterior sin lock de fila

```ts
117:     // 3. Persist new tokens
118:     const { error: upsertErr } = await supabaseAdmin
119:         .from('v2_oauth_tokens')
120:         .update({
121:             access_token: meli.access_token,
122:             refresh_token: meli.refresh_token,
123:             expires_at: newExpiresAt,
124:             status: 'active',
125:             updated_at: new Date().toISOString(),
126:         })
127:         .eq('store_id', storeId);
```

### 4) getValidToken decide refresh por expiración y delega

```ts
154:     // If expiring soon, refresh transparently
155:     if (isExpiringSoon(row.expires_at)) {
156:         return refreshToken(storeId);
157:     }
```

No existe control de concurrencia entre múltiples invocaciones simultáneas de `getValidToken` para el mismo `storeId`.

## Verificación específica solicitada

1. ¿Se usa transacción explícita?
- No se encontró.

2. ¿Existe `SELECT ... FOR UPDATE` sobre `v2_oauth_tokens`?
- No se encontró.

3. ¿Se usa `pg_advisory_lock` o similar?
- No se encontró.

4. ¿Existe mecanismo single-flight en memoria (`Map` / Promise cache)?
- No se encontró.

5. ¿Se vuelve a chequear `expires_at` después de adquirir lock?
- No aplica: no hay lock implementado.

## Riesgo bajo alta concurrencia
- Múltiples requests concurrentes para el mismo `storeId` pueden entrar en `refreshToken` simultáneamente.
- Puede ejecutarse más de un refresh contra ML en paralelo para la misma credencial.
- El último update en DB define el estado final de token persistido.

## Estado
**RIESGO**
