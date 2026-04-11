# OAuth Mercado Libre

- Status: Accepted
- Date: 2026-02-28 -03:00

## Purpose
Definir el flujo de vinculación de cuentas externas de Mercado Libre (vendedores) con la identidad de SmartSeller, gestionando el ciclo de vida de tokens y la creación de tiendas.

## Context
- Integración principal: Mercado Libre (ML).
- Rol: SmartSeller actúa como aplicación de terceros autorizada por el vendedor.
- Almacenamiento: Tokens persistidos en `v2_installations` (vía `store_id`).
- Identidad: El vendedor de ML se mapea a un `store_id` con `provider_key="mercadolibre"`.

## Flow
1. **Start (`/api/auth/meli/start`)**:
   - Inicia flujo OAuth 2.0 con PKCE (opcional según `MELI_USE_PKCE`).
   - Genera `state` y `code_verifier`.
   - Persiste estado en `v2_oauth_states` con TTL de 15 min.
   - Redirige al portal de autorización de Mercado Libre.
2. **Callback (`/api/auth/meli/callback`)**:
   - Recibe `code` y `state` de ML.
   - Valida `state` y consume `code_verifier`.
   - Si no hay usuario autenticado: Crea instalación pendiente y redirige a `/install/meli/complete`.
   - Si hay usuario: Vincula cuenta directamente, crea `v2_stores` y persiste tokens.
3. **Completion (`/install/meli/complete`)**:
   - Proceso de finalización para flujos "desconectados" o instalaciones iniciadas sin sesión previa.
   - Requiere autenticación de usuario humano (Supabase).
   - Realiza el "handshake" final entre el usuario autenticado y la instalación pendiente de ML.
   - Encola el **Historical Bootstrap Sync** inicial (`bootstrap_status='pending'`) y delega ejecución al worker.

## Historical Bootstrap Sync
- **Objetivo**: evitar que una tienda recién conectada quede sin score inicial.
- **Disparo**: al finalizar `/install/meli/complete`, solo se marca `pending` en `v2_oauth_installations`.
- **Ejecución**: `GET/POST /api/worker/meli-bootstrap` (cron interno con `x-cron-secret`).
- **Pipeline reutilizado**:
  1. `POST /api/meli/sync/{store_id}?historical=1&max_orders=200`
  2. `getLatestScore(storeId)` para materializar métricas/señales/snapshot/score.
- **Estados persistidos**:
  - `pending`
  - `running`
  - `completed`
  - `failed`
- **Dashboard sin score**:
  - `pending/running`: muestra "Bootstrap inicial en progreso..."
  - `failed`: muestra "Bootstrap inicial falló..."
  - `null`: muestra "Bootstrap inicial todavía no se inició."

## Data Contracts
### `/api/auth/meli/start`
- **Env Required**: `MELI_APP_ID`, `MELI_REDIRECT_URI`.
- **PKCE**: S256 mediante `MELI_USE_PKCE` (default true).

### `/api/auth/meli/callback`
- **Input**: `code`, `state`.
- **Logic**: Upsert en `v2_stores` y `v2_store_memberships`.

## Invariants
- **Identity Separation**: El `external_account_id` (ML seller ID) nunca se usa como clave primaria en la navegación UI; se debe usar siempre el `store_id` interno.
- **Provider Key**: El valor canónico para Mercado Libre es `"mercadolibre"` o `"meli"`.
- **Token Persistence**: El `refresh_token` es obligatorio para garantizar la operabilidad del motor clínico en segundo plano.
- **Atomic Linkage**: La vinculación de tienda y membresía de usuario debe ser atómica.

## Failure Modes
- **State Mismatch**: Intento de CSRF o expiración del estado de 15 min.
- **Installation Orphan**: Instalación de ML sin usuario de SmartSeller asociado (manejado por `complete`).
- **Invalid Grant**: `code` ya usado o verificado incorrectamente.

## Verification Checklist
- [ ] Registro en `v2_oauth_states` creado al inicio.
- [ ] `v2_stores` creado con el `provider_key` correcto tras éxito.
- [ ] Tokens válidos almacenados en la tabla de instalaciones.
- [ ] Redirección final al dashboard de la tienda recién vinculada.

## References
- `src/app/(v2)/api/auth/meli/start/route.ts`
- `src/app/(v2)/api/auth/meli/callback/route.ts`
- `src/app/(v2)/install/meli/complete/route.ts`
- `src/v2/lib/meli/oauth.ts`
- `src/v2/lib/meli/installations.ts`
