# Auth — Session and Cookies

## Purpose
Definir el modelo de sesión HTTP, persistencia de cookies y su impacto en autenticación SSR en SmartSeller v2.

Este documento formaliza cómo se transporta y valida la sesión de usuario en entorno Next.js App Router + Supabase SSR.

---

## Modelo de sesión

SmartSeller utiliza sesión basada en cookies httpOnly emitidas por Supabase tras intercambio OAuth exitoso.

Flujo canónico:

1. Usuario completa OAuth (Google).
2. Callback ejecuta `exchangeCodeForSession(code)`.
3. Supabase genera tokens de sesión.
4. Tokens se escriben como cookies httpOnly en el `NextResponse`.
5. Requests posteriores incluyen cookies automáticamente.
6. `/api/me` valida sesión leyendo cookies del request.

---

## Cookies esperadas

Supabase emite típicamente:

- `sb-access-token`
- `sb-refresh-token`

Propiedades requeridas:

- `httpOnly = true`
- `secure = true` en producción (HTTPS)
- `sameSite = "lax"` o configuración compatible con OAuth
- `path = "/"`

---

## Wiring SSR obligatorio

En rutas server-side que usan Supabase SSR:

```ts
createServerClient(..., {
  cookies: {
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
    }
  }
})
```

## Reglas críticas

- `setAll` debe escribir sobre el `NextResponse` que será retornado.
- No crear un nuevo `NextResponse` después de ejecutar `exchangeCodeForSession`.
- No perder la referencia del response que contiene cookies.

## Dominio y entorno

**En local**
- `secure` puede no estar activo.
- Dominio suele ser `localhost`.

**En Vercel (producción)**
- `secure = true` obligatorio.
- Dominio debe coincidir exactamente con dominio activo.
- Cambios entre preview/prod pueden invalidar cookies.

## Data contracts

**Callback OAuth**
- Entrada: `code` en query param.
- Salida: `NextResponse.redirect(...)` que debe contener cookies de sesión en headers.

**/api/me**
- Entrada: Cookies presentes en request.
- Salida:
  - 401 si no hay sesión válida.
  - 200 con `user_id` y contexto si sesión válida.

## Invariants

- La sesión solo se crea en el callback OAuth.
- `/api/me` no crea sesión, solo la valida.
- Toda API protegida debe depender de sesión válida.
- No exponer tokens de sesión al cliente JS.

## Errores frecuentes

### 1) /api/me devuelve 401 después de login

Causa probable:
- Callback no escribió cookies en el response retornado.
- Dominio mismatch.
- Cookies bloqueadas por `secure` en HTTP.

Verificación:
- Revisar `Set-Cookie` en respuesta de callback.
- Inspeccionar cookies en DevTools.
- Confirmar que request a `/api/me` incluye cookies.

### 2) Login funciona pero dashboard redirige a /enter

Causa probable:
- Cookie no persistida.
- Nuevo `NextResponse` creado sin copiar cookies.
- Middleware interfiere en flujo.

### 3) Loop infinito de login

Causa probable:
- `/api/me` siempre 401.
- Session cookie expira inmediatamente.
- Inconsistencia entre dominios preview y production.

## Failure modes

- Sesión creada pero no persistida.
- Sesión persistida pero no enviada en requests SSR.
- Uso incorrecto de `createServerClient` sin wiring de cookies.
- Uso de `service_role` en contexto cliente (violación de seguridad).

## Verification checklist

- Verificar que callback retorna cookies en headers.
- Verificar cookies visibles en navegador tras login.
- Verificar que `/api/me` retorna 200 tras login.
- Verificar que logout elimina cookies.
- Verificar comportamiento consistente en preview y production.
- Verificar que ninguna API protegida funcione sin sesión válida.
