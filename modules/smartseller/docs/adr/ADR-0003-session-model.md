# ADR-0003: Modelo de Sesión SSR basado en Cookies httpOnly

- Status: Accepted
- Date: 2026-02-28 -03:00

## Context
- Necesidad de asegurar la identidad del usuario en un entorno Next.js App Router (React Server Components).
- Requisito de protección contra XSS e inyección de tokens en el lado del cliente.
- Multi-tenancy basado en `store_id` que debe ser validado contra el `user_id` en cada request.

## Decision
- **Sesión strictly Server-Side**: La sesión reside exclusivamente en cookies `httpOnly` emitidas por Supabase.
- **Prohibición de persistencia en Frontend**: No se permite almacenar JWTs o metadata de sesión en `localStorage`, `sessionStorage` o cookies accesibles por JS.
- **Resolución de Identidad Canónica**: `/api/me` es el único punto de resolución de identidad para la UI.
- **Validación RLS**: Toda operación de base de datos debe pasar por un cliente Supabase configurado con las cookies del request para aplicar políticas de seguridad (RLS).
- **Navigation Identity**: Las rutas de la aplicación deben usar `store_id` (interno) y nunca IDs externos (`external_account_id`) para prevenir fugas de contexto entre tenants.

## Consequences
- **Pros**:
  - Inmunidad total a ataques de lectura de tokens via JS.
  - Compatibilidad nativa con Server Components sin hidratación de sesión en el cliente.
  - Implementación simple de multi-tenancy mediante RLS.
- **Cons**:
  - Mayor dependencia de la latencia del servidor para validaciones de ruta.
  - Complejidad en la gestión de "NextResponse" para asegurar la propagación de cookies de refresco.
- **Mitigations**:
  - Uso de middleware para validación de pre-vuelo.
  - Caché de sesión en el lado del servidor para peticiones recurrentes dentro de un mismo render cycle.

## Invariants
- El usuario es anónimo para el cliente JS; solo el servidor conoce su `user_id`.
- Un `store_id` solicitado en la URL debe pertenecer al `user_id` resuelto desde la cookie, validado por RLS.
- No se exponen tokens de Supabase a través de props de componentes.

## Rejected Alternatives
1. **JWT-only Flow**: Rechazado por riesgo de seguridad y complejidad de refresco en RSC.
2. **Client-side Auth Store (Zustand/Redux)**: Rechazado para mantener el "Source of Truth" exclusivamente en el servidor y evitar desincronización.
3. **External ID Routing**: Rechazado para evitar exponer IDs de proveedores externos en la estructura de navegación interna.

## References
- `docs/auth/session-and-cookies.md`
- `src/app/(v2)/api/me/route.ts`
- `src/app/(v2)/api/auth/callback/route.ts`
- Commit: `a5b0cdd` (Initial SSR implementation)
