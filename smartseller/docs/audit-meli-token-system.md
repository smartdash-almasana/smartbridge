# Auditoría del Sistema de Tokens de Mercado Libre (SmartSeller V2)

## Resumen Ejecutivo
El sistema de gestión de tokens de Mercado Libre en SmartSeller V2 está correctamente estructurado en base al repositorio actual. Utiliza la tabla `v2_oauth_tokens` para persistir los tokens de acceso y refresco por cada tienda (`store_id`). La lógica centralizada en `meli-token.ts` se encarga de entregar siempre un token válido, implementando una ventana de seguridad de 2 minutos (`expires_at < 120s`) para efectuar un refresh proactivo. Además, se cumple con la rotación del `refresh_token`, persistiendo el nuevo valor devuelto por ML. No obstante, existe un riesgo técnico evidente en operaciones concurrentes al no haber un mecanismo atómico (single-flight) en el momento del refresco.

## Evidencia Técnica

### Estructura SQL (`public.v2_oauth_tokens`)
```sql
CREATE TABLE public.v2_oauth_tokens (
    token_id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    store_id uuid NOT NULL REFERENCES public.v2_stores(store_id),
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status text DEFAULT 'active'::text NOT NULL CHECK (status = ANY (ARRAY['active'::text, 'invalid'::text])),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    raw jsonb
);
```

### Rutas de Archivos Clave
*   **`src/v2/lib/meli-token.ts`**: Contiene la función canónica `getValidToken(storeId)`. Revisa la validez del token comparando la columna `expires_at` y, de ser necesario, llama internamente a `refreshToken(storeId)` persistiendo el nuevo `access_token` y el nuevo `refresh_token` rotado.
*   **`src/v2/lib/meli/oauth.ts`**: Implementa los métodos puros para la comunicación con la API de ML, incluyendo `exchangeCodeForTokens` y `refreshTokens`.
*   **`src/app/(v2)/api/meli/sync/[store_id]/route.ts`**: Evidencia el uso del token en un flujo de negocio real. Obtiene el token activo de la base de datos y realiza llamadas HTTP a `https://api.mercadolibre.com/users/me` y `/orders/search`, portando el token en el header `Authorization`. 

## Riesgos Detectados
1.  **Condición de Carrera (Race Condition) en Refresh:** Actualmente no existe un control de concurrencia rígido (como un lock en base de datos o *single-flight*) para la operación de refresco. Si llegan varias peticiones simultáneas justo cuando el token entra en la ventana de expiración (< 2 min), es posible que se ejecuten múltiples llamadas de refresco en paralelo. Debido a que Mercado Libre rota los refresh tokens, esto puede provocar errores de `invalid_grant`, lo que según la lógica actual en `meli-token.ts` marcaría el estado del token como `invalid`, desconectando al seller de manera accidental. El mismo código documenta esto como pendiente: `// TODO: refresh if expires_at <= now (PORT_LATER: single-flight atomic refresh)`.

## Estado
**FALTA** (Se requiere implementar concurrencia segura / single-flight en el refresh para evitar la invalidación de sesiones).
