# ADR-0007: Cron Run Auditing — Trazabilidad para Ejecuciones Programadas

**Estado:** Aceptado  
**Fecha:** 2026-03-03  
**Autor:** Arquitectura SmartSeller V2  
**Refs:** ADR-0005 (observabilidad ingest), ADR-0006 (DLQ reprocessor)

---

## Contexto

Con la introducción de ADR-0006, delegamos en `pg_cron` (desde Supabase) la responsabilidad de ejecutar procesos periódicos críticos, empezando por el reintentador DLQ (`run_dlq_reprocessor`).

Si bien Supabase provee herramientas para inspeccionar `pg_cron` (`cron.job_run_details`), esta tabla tiene políticas de retención limitadas y pertenece al schema `cron`, el cual no es fácilmente accesible o modificable para integrarse a nuestros dashboards de observabilidad, además de que carece de contexto de nuestra aplicación (el request HTTP específico devuelto por `pg_net`).

Necesitábamos un mecanismo propio para **auditar las corridas de nuestros cron jobs**, garantizando que:
1. Podamos alertar si un job deja de correr.
2. Tengamos el `request_id` de `pg_net` para poder cruzar logs si hay una falla de red.
3. El proceso de logueo **nunca interfiera** con la ejecución misma del cron (ni lo aborte).
4. No queden expuestos secretos (ej. `x-cron-secret`) ni en la base de datos ni en logs externos.

---

## Decisión

Implementar una tabla de auditoría append-only: `public.v2_cron_runs` y obligar a que cualquier función expuesta a `pg_cron` realice un logueo *best-effort*.

### Diseño de la tabla `v2_cron_runs`

| Columna | Tipo | Constraints | Propósito |
|---|---|---|---|
| `cron_run_id` | uuid | PK, default `gen_random_uuid()` | Identificador único del log |
| `job_name` | text | NOT NULL | Nombre canónico del job (ej. `dlq_reprocessor_10m`) |
| `status` | text | CHECK `IN ('ok','error')` | Resultado de la *invocación* (no de la ejecución asíncrona) |
| `pg_net_request_id` | bigint | NULL | ID interno devuelto por `pg_net`, útil para join con `net.http_response` |
| `response` | jsonb | NULL | Body JSON limpio devuelto por la función |
| `error_message` | text | NULL | Mensaje de error si hubo excepción en Postgres |
| `created_at` | timestamptz | default `now()` | Timestamp de ejecución |

### Mecanismo Best-Effort

En la función `run_dlq_reprocessor()`, los *inserts* a `v2_cron_runs` están envueltos en bloques `BEGIN ... EXCEPTION WHEN OTHERS THEN ... END`. 

Esto asegura que:
1. Si `net.http_get()` es exitoso, pero falla el insert de auditoría, se silencia el fallo y el job no se considera "roto" a ojos de `pg_cron`.
2. Si falla la ejecución misma del bloque principal de la función, la excepción es capturada, y se intenta guardar en la tabla con `status = 'error'` (igualmente protegido por *best effort*).
3. Los headers enviados vía HTTP (que contienen secretos de la API) se arman *in-line* en la llamada de `net.http_get` y en ningún momento se asientan en variables ni forman parte del `response` guardado en la base de datos.

---

## Consecuencias

### Mayor Trazabilidad
Permite responder preguntas operativas como:
- *¿Corrió el DLQ en la última hora?*
- *¿Tuvo errores de sintaxis o conexión saliente (`pg_net`)?*
Podemos crear vistas y métricas directas sobre `v2_cron_runs`.

### Control de Secretos
Garantiza que el secreto necesario para llamar al worker productivo nunca toca tablas persistentes de nuestra propiedad (permanece solamente en el código fuente de la función en la DB).

### Costo de Almacenamiento
Siendo una tabla de alto volumen pero baja densidad (1 insert cada 10 minutos = 144 al día por job), el crecimiento en almacenamiento es insignificante, y al ser indexada por `(job_name, created_at DESC)`, las consultas operativas son baratas. Eventualmente, si el proyecto lo requiere, se puede establecer un job de prune (ej. borrar data más vieja a 90 días, acorde a nuestro paradigma Hot/Cold), pero no es necesario actualmente.

---

**Firma:** Arquitectura SmartSeller V2 (ADR-0007, vivo)
