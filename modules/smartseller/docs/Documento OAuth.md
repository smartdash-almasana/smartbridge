# SmartSeller v2 — Documento Técnico OAuth

**Alcance:** Flujo completo de autenticación con Google (via Supabase) + vinculación OAuth con Mercado Libre.
**Objetivo:** Proveer especificación clara, determinística y reproducible para el equipo de desarrollo.

---

# 1. Arquitectura General

SmartSeller utiliza **doble OAuth**:

1. **OAuth #1 — Identidad del usuario**

   * Provider: Google
   * Broker: Supabase Auth
   * Resultado: Sesión autenticada + cookies httpOnly

2. **OAuth #2 — Vinculación de tienda**

   * Provider: Mercado Libre
   * Resultado: Access token + refresh token + store vinculada al user_id

Separación estricta:

| Dominio             | Responsable   | Resultado         |
| ------------------- | ------------- | ----------------- |
| Identidad humana    | Supabase      | session + user_id |
| Identidad comercial | Mercado Libre | store vinculada   |

---

# 2. OAuth Google (Supabase) — Flujo Completo

## 2.1 Objetivo

Autenticar al usuario y crear sesión persistente vía cookies seguras.

---

## 2.2 Endpoints involucrados

```
/enter
/api/auth/callback
/api/me
/post-login
```

---

## 2.3 Flujo Secuencial

### Paso 1 — Usuario inicia login

Desde `/enter`:

```ts
supabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    redirectTo: `${origin}/api/auth/callback?next=/post-login`
  }
});
```

Google redirige luego a:

```
/api/auth/callback?code=XXXX&next=/post-login
```

---

### Paso 2 — Intercambio del code

Archivo:

```
src/app/(v2)/api/auth/callback/route.ts
```

### Lógica crítica

```ts
const code = req.nextUrl.searchParams.get("code");

await supabase.auth.exchangeCodeForSession(code);
```

⚠️ Es obligatorio pasar **el code**, no `req.url`.

---

### Paso 3 — Persistencia de cookies

Se usa `createServerClient` con:

```ts
cookies: {
  getAll: () => cookieStore.getAll(),
  setAll: (cookiesToSet) => {
    cookiesToSet.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
  },
}
```

Esto permite que Supabase escriba:

* sb-access-token
* sb-refresh-token

Cookies deben ser:

* httpOnly
* secure (en producción)
* sameSite=lax

---

### Paso 4 — Redirección segura

```ts
return NextResponse.redirect(new URL(nextPath, req.url));
```

`nextPath` debe sanitizarse para evitar open redirect.

---

## 2.4 Verificación

`/api/me`

Debe devolver:

```json
{
  "user_id": "uuid",
  "email": "user@email.com",
  "stores": [...]
}
```

Si devuelve 401:

* No hay sesión
* Cookies no se setearon
* Domain mismatch
* Error en exchangeCodeForSession

---

# 3. Mercado Libre OAuth — Flujo Completo

## 3.1 Objetivo

Vincular tienda del seller autenticado.

Resultado:

* access_token
* refresh_token
* external_account_id
* nickname
* provider metadata

Persistido en:

```
v2_stores
v2_store_memberships
v2_provider_tokens
```

---

## 3.2 Endpoints

```
/api/auth/meli/start
/api/auth/meli/callback
```

---

## 3.3 Inicio de autorización

`/api/auth/meli/start`

Construye URL:

```
https://auth.mercadolibre.com.ar/authorization
  ?response_type=code
  &client_id=XXXX
  &redirect_uri=XXXX
  &state=RANDOM
  [&code_challenge=...]
```

---

## 3.4 PKCE

Controlado por:

```
MELI_USE_PKCE=true | false
```

Si PKCE está deshabilitado en la app ML:

```
MELI_USE_PKCE=false
```

Si está habilitado:

* Generar code_verifier
* Guardarlo en cookie httpOnly temporal
* Enviar code_challenge (S256)
* Usarlo luego en intercambio

---

## 3.5 Callback ML

ML redirige a:

```
/api/auth/meli/callback?code=XXXX&state=XXXX
```

### Paso 1 — Validar sesión

Debe existir usuario autenticado:

```ts
const { data: { user } } = await supabase.auth.getUser();
```

Si no hay user → 401.

---

### Paso 2 — Intercambio del code

POST a:

```
https://api.mercadolibre.com/oauth/token
```

Body:

```json
{
  "grant_type": "authorization_code",
  "client_id": "...",
  "client_secret": "...",
  "code": "...",
  "redirect_uri": "...",
  "code_verifier": "..." // si PKCE
}
```

Respuesta:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "user_id": 12345678
}
```

---

### Paso 3 — Obtener datos del seller

GET:

```
https://api.mercadolibre.com/users/me
Authorization: Bearer ACCESS_TOKEN
```

Devuelve:

```json
{
  "id": 12345678,
  "nickname": "SMARTSELL",
  "country_id": "AR"
}
```

---

### Paso 4 — Persistencia determinística

Debe ejecutarse:

```
upsertStoreAndMembership({
  provider_key: "meli",
  external_account_id: "12345678",
  provider_account_name: "SMARTSELL",
  user_id
})
```

Invariantes:

* UNIQUE (provider_key, external_account_id)
* Membership UNIQUE (store_id, user_id)

---

### Paso 5 — Guardar tokens

Tabla:

```
v2_provider_tokens
```

Campos:

* store_id
* access_token
* refresh_token
* expires_at
* scope

---

### Paso 6 — Redirección final

Si es primera tienda:

```
/dashboard/{store_id}
```

Si hay múltiples:

```
/choose-store
```

---

# 4. /api/me — Comportamiento

NO crea sesión.

Solo:

```ts
supabase.auth.getUser()
```

Y luego consulta:

```
v2_store_memberships
JOIN v2_stores
```

Retorna lista de tiendas vinculadas.

---

# 5. Variables de Entorno Requeridas

## Supabase

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

---

## Mercado Libre

```
MELI_CLIENT_ID
MELI_CLIENT_SECRET
MELI_REDIRECT_URI
MELI_USE_PKCE
```

---

# 6. Riesgos y Fallos Comunes

| Síntoma             | Causa probable         |
| ------------------- | ---------------------- |
| 401 en /api/me      | exchangeCode mal usado |
| Loop en ML          | PKCE mal configurado   |
| No se crean tiendas | RLS bloqueando inserts |
| Tokens no persisten | Falta transaction      |
| Cookies no aparecen | Domain mismatch Vercel |

---

# 7. Seguridad

✔ Sanitizar next param
✔ Validar state en ML
✔ Cookies httpOnly
✔ Tokens cifrados en DB (recomendado)
✔ No exponer client_secret en frontend

---

# 8. Estado Determinístico Esperado

Después de Google login:

```
/api/me → user_id != null
```

Después de ML autorización:

```
/api/me → stores.length >= 1
```

---

# 9. Diagrama Resumido

```
User
 ↓
Google OAuth
 ↓
/api/auth/callback
 ↓ exchangeCodeForSession
 ↓ set cookies
 ↓
/post-login
 ↓
/api/me
 ↓
No stores → start ML OAuth
 ↓
ML Authorization
 ↓
/api/auth/meli/callback
 ↓ exchange token
 ↓ upsert store
 ↓ persist tokens
 ↓
/dashboard/{store_id}
```

---

# 10. Conclusión

El sistema OAuth tiene dos capas independientes:

1. Autenticación humana (Supabase)
2. Autorización comercial (Mercado Libre)

Ambas deben funcionar correctamente para que el dashboard opere.

Si cualquiera falla, el sistema queda en estado parcial.

---

Si querés, puedo generar:

* Versión PDF técnica formal
* Checklist QA de OAuth
* Secuencia tipo ADR
* Diagrama UML formal
* Especificación de RLS asociada


