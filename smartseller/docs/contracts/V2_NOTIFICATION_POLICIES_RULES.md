# V2 Notification Policies — `rules` JSONB Contract (V0)

**Status:** Canonical (V0)  
**Scope:** `v2_notification_policies.rules` only  
**Goal:** Definir un contrato **exacto**, determinista y extensible para la configuración de alertas por señal (rule fine-tuning) **sin inventar campos**.

---

## 1) Ubicación y propósito

Tabla: `v2_notification_policies`  
Columna: `rules` (`jsonb`)

`rules` define, por **signal_key**, cómo se comporta la notificación:

- si está habilitada (`enabled`)
- si fuerza severidad para notificación (`severity_override`)
- cuánto “enfría” para evitar spam (`cooldown_hours`)
- qué umbrales usa (`thresholds`)

> Importante: `severity_override` **no altera el score**. Solo la severidad de la **notificación**.

---

## 2) Forma general del JSON

`rules` es un **objeto JSON** donde cada key es un `signal_key` válido, y cada value es un `RuleConfig`.

### 2.1 Forma
```json
{
  "<signal_key>": {
    "enabled": true,
    "severity_override": null,
    "cooldown_hours": 12,
    "thresholds": {}
  }
}
2.2 Tipos (normativo)
signal_key (keys del objeto)

Enum V0 exacto:

no_orders_7d

cancellation_spike

unanswered_messages_spike

claims_opened

low_activity_14d

enabled

Tipo: boolean

Default: true

severity_override

Tipo: null | "low" | "medium" | "high"

Default: null

cooldown_hours

Tipo: integer

Rango: 0..168 (0 = sin cooldown)

Default recomendado: 12

thresholds

Tipo: object

Default: {} (interpretado como: “usar defaults V0 del contrato de Score”)

Claves permitidas dependen del signal_key (ver sección 4).

3) Semántica universal (aplica a todas las señales)
3.1 Evaluación

Para cada signal_key:

Si enabled=false ⇒ no notificar, aunque la señal esté activa clínicamente.

Si enabled=true ⇒ evaluar:

thresholds (si está vacío, usar defaults V0)

cooldown (si corresponde)

severidad (override si existe)

3.2 Cooldown (anti-spam)

cooldown_hours impone una ventana mínima entre notificaciones del mismo signal_key para el mismo store_id.

Si existe una notificación enviada en las últimas cooldown_hours ⇒ no enviar.

Implementación: requiere evidencia de “último envío” en un registro de envíos (outbox/log).
Si aún no existe tabla de envíos, el cooldown puede quedar como contrato para implementación futura.

3.3 Defaults por ausencia

Si:

rules es {} (vacío), o

falta una key de señal dentro de rules

El backend debe aplicar defaults V0 (sección 5).

4) thresholds por señal (V0 exacto)

Nota: los campos en thresholds se interpretan como parámetros para evaluar la señal usando agregados 7d/14d de metrics_daily (o el fallback que tenga el engine).
El contrato solo define los parámetros, no cómo se obtienen los agregados.

4.1 no_orders_7d
Thresholds permitidos

window_days (int) — default 7

min_orders (int) — default 1

Semántica

Activa notificación si:

orders_created_window < min_orders dentro de window_days.

Ejemplo
{
  "enabled": true,
  "severity_override": "high",
  "cooldown_hours": 24,
  "thresholds": { "window_days": 7, "min_orders": 1 }
}
4.2 cancellation_spike
Thresholds permitidos

window_days (int) — default 7

min_cancelled (int) — default 3

cancelled_ratio (number) — default 0.30 (rango 0..1)

Semántica

Solo evalúa si orders_created_window > 0.
Activa notificación si:

orders_cancelled_window >= max(min_cancelled, ceil(orders_created_window * cancelled_ratio))

Ejemplo
{
  "enabled": true,
  "severity_override": null,
  "cooldown_hours": 12,
  "thresholds": { "window_days": 7, "min_cancelled": 3, "cancelled_ratio": 0.30 }
}
4.3 unanswered_messages_spike
Thresholds permitidos

window_days (int) — default 7

min_pending (int) — default 5

Semántica

pending = messages_received_window - messages_answered_window
Activa notificación si:

pending >= min_pending

Ejemplo
{
  "enabled": true,
  "severity_override": null,
  "cooldown_hours": 6,
  "thresholds": { "window_days": 7, "min_pending": 5 }
}
4.4 claims_opened
Thresholds permitidos

window_days (int) — default 7

min_opened (int) — default 1

Semántica

Activa notificación si:

claims_opened_window >= min_opened

Ejemplo
{
  "enabled": true,
  "severity_override": "medium",
  "cooldown_hours": 24,
  "thresholds": { "window_days": 7, "min_opened": 1 }
}
4.5 low_activity_14d
Thresholds permitidos

window_days (int) — default 14

min_activity (int) — default 1

max_activity (int) — default 2

Semántica

activity = orders_created_window + messages_received_window + claims_opened_window
Activa notificación si:

min_activity <= activity <= max_activity

Esto es equivalente a la regla clínica V0: 0 < activity14 < 3.

Ejemplo
{
  "enabled": true,
  "severity_override": null,
  "cooldown_hours": 24,
  "thresholds": { "window_days": 14, "min_activity": 1, "max_activity": 2 }
}
5) Defaults V0 (normativo)

Cuando thresholds esté vacío {} o falten señales en rules, el backend debe asumir:

5.1 Defaults por campo (todas las señales)

enabled = true

severity_override = null

cooldown_hours = 12

thresholds = defaults_por_señal (ver 5.2)

5.2 Defaults por señal

no_orders_7d.thresholds = { "window_days": 7, "min_orders": 1 }

cancellation_spike.thresholds = { "window_days": 7, "min_cancelled": 3, "cancelled_ratio": 0.30 }

unanswered_messages_spike.thresholds = { "window_days": 7, "min_pending": 5 }

claims_opened.thresholds = { "window_days": 7, "min_opened": 1 }

low_activity_14d.thresholds = { "window_days": 14, "min_activity": 1, "max_activity": 2 }

6) Ejemplo completo de rules (V0 listo)
{
  "no_orders_7d": {
    "enabled": true,
    "severity_override": "high",
    "cooldown_hours": 24,
    "thresholds": { "window_days": 7, "min_orders": 1 }
  },
  "cancellation_spike": {
    "enabled": true,
    "severity_override": null,
    "cooldown_hours": 12,
    "thresholds": { "window_days": 7, "min_cancelled": 3, "cancelled_ratio": 0.30 }
  },
  "unanswered_messages_spike": {
    "enabled": true,
    "severity_override": null,
    "cooldown_hours": 6,
    "thresholds": { "window_days": 7, "min_pending": 5 }
  },
  "claims_opened": {
    "enabled": true,
    "severity_override": "medium",
    "cooldown_hours": 24,
    "thresholds": { "window_days": 7, "min_opened": 1 }
  },
  "low_activity_14d": {
    "enabled": true,
    "severity_override": null,
    "cooldown_hours": 24,
    "thresholds": { "window_days": 14, "min_activity": 1, "max_activity": 2 }
  }
}
7) Validación backend (normativa)

El backend debe validar y rechazar configuraciones inválidas con error 400:

7.1 Validaciones generales

rules debe ser objeto JSON.

No permitir signal_key desconocidos.

enabled debe ser boolean.

cooldown_hours entero 0..168.

severity_override ∈ {null, low, medium, high}.

7.2 Validaciones de thresholds

window_days entero positivo.

cancelled_ratio number 0..1.

min_activity <= max_activity.

min_* enteros >= 0.

7.3 Normalización recomendada

Si falta una señal, el backend puede devolver el objeto completo con defaults aplicados (sin necesariamente persistirlo) para simplificar UI.

8) Extensibilidad / Versioning

Este contrato es V0 y está alineado al Score V0.

Para agregar señales futuras:

se agregan nuevas keys signal_key y su schema de thresholds.

Para mantener compatibilidad:

el backend debe ignorar campos desconocidos solo si se decide explícitamente en un ADR.

por defecto, se recomienda rechazar desconocidos en V0 (fail-fast).

Recomendación: agregar en el futuro un campo rules_version en la tabla o dentro de rules si se requiere migración semántica.

9) Non-goals (V0)

No define canales (channels) ni horarios (quiet_hours) — están en otras columnas.

No define formato de mensajes.

No automatiza acciones (solo notificación).

No integra WhatsApp/Telegram/Email (solo configuración).

No altera el cálculo del score (solo notificación).

10) Implementación mínima esperada (UI/Server)

UI lista las 5 señales V0.

UI permite:

toggle enabled

seleccionar severity_override

setear cooldown_hours

editar thresholds específicos por señal

Server:

GET devuelve policy + defaults aplicados

POST valida estrictamente y upsertea rules