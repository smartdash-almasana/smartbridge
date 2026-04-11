# OAuth Supabase + Google

- Status: Accepted
- Date: 2026-02-28 -03:00

## Purpose
Formalizar el flujo de autenticación de usuarios humanos mediante Google OAuth administrado por Supabase SSR, garantizando la persistencia de sesión segura en el servidor.

## Context
- Autenticación primaria: Google via Supabase Auth.
- Entorno: Next.js App Router con `@supabase/ssr`.
- Requisito: Sesión invisible para el cliente JS (httpOnly) para mitigar XSS.
- Identidad: El `user_id` de Supabase es la raíz de la jerarquía de pertenencia en SmartSeller.

## Flow
1. **Initiation (`/api/auth/login`)**:
   - Genera URL de autorización via `signInWithOAuth`.
   - Captura cookies PKCE (code verifier) generadas por el SDK de Supabase.
   - Retorna redirección a Google inyectando las cookies en el `NextResponse`.
2. **Callback (`/api/auth/callback`)**:
   - Recibe `code` de Google.
   - Ejecuta `exchangeCodeForSession(code)`.
   - Escribe tokens de sesión (`sb-access-token`, `sb-refresh-token`) como cookies httpOnly.
   - Redirige a `/post-login` o al path capturado en `next`.
3. **Identity Resolution (`/api/me`)**:
   - Endpoint canónico para verificar estado de sesión.
   - Lee cookies directamente en modo SSR.
   - Retorna `user_id`, lista de `v2_stores` asociados y hint de redirección.

## Data Contracts
### `/api/auth/login`
- **Input**: `next` (optional redirect path).
- **Behavior**: Deterministic redirect to Google Auth.

### `/api/auth/callback`
- **Input**: `code` (query param).
- **Behavior**: Session creation and cookie emission.

### `/api/me`
- **Response Shape**:
  ```json
  {
    "user_id": "uuid",
    "stores": [
      { "store_id": "uuid", "display_name": "string", "provider_key": "string" }
    ],
    "redirect": "/dashboard/{store_id}"
  }
  ```

## Invariants
- **Cookie Security**: `httpOnly=true`, `secure=true` (en producción), `sameSite=lax`.
- **No Client JWT**: El acceso directo a tokens en el navegador está prohibido.
- **Canonical Source**: `/api/me` es la única fuente de verdad para la identidad del usuario.
- **SSR Boundary**: La validación de sesión ocurre estrictamente en el servidor.

## Failure Modes
- **401 Unauthorized**: Sesión expirada o inexistente en `/api/me`.
- **Missing Cookies**: Falla en la propagación entre `/api/auth/login` y el callback (causado por pérdida de referencia de `NextResponse`).
- **PKCE Mismatch**: Verificador expirado o inconsistente entre inicio y callback.

## Verification Checklist
- [ ] Cookies `sb-*-auth-token` presentes en el navegador tras login.
- [ ] `/api/me` retorna 200 con el `user_id` correcto.
- [ ] Redirección determinística a `/post-login` tras éxito.
- [ ] No hay tokens visibles en `localStorage` o `sessionStorage`.

## References
- `src/app/(v2)/api/auth/login/route.ts`
- `src/app/(v2)/api/auth/callback/route.ts`
- `src/app/(v2)/api/me/route.ts`
