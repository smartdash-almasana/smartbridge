# V3 Read Model Pattern — Disciplina operativa

Fecha: 2026-03-14  
Derivado de: `clinical-status`, `run-history`, `store-pulse` (aprobados).

---

## 1. Patrón de route V3

Archivo: `src/app/api/v3/<nombre>/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { readV3<Nombre>, V3<Nombre>StoreNotFoundError } from '@/v3/read-models/<nombre>';

function normalizeSecret(value: string): string {
    return value.replace(/[\r\n\t\s]+/g, '').trim();
}

function isAuthorized(request: NextRequest): boolean {
    const provided = normalizeSecret(request.headers.get('x-cron-secret') ?? '');
    const expected = normalizeSecret(process.env.CRON_SECRET ?? '');
    if (!provided || !expected) return false;
    return provided === expected;
}

export async function GET(request: NextRequest) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        }

        const tenant_id = (request.nextUrl.searchParams.get('tenant_id') ?? '').trim();
        const store_id = (request.nextUrl.searchParams.get('store_id') ?? '').trim();

        if (!tenant_id) return NextResponse.json({ ok: false, error: 'Missing tenant_id' }, { status: 400 });
        if (!store_id) return NextResponse.json({ ok: false, error: 'Missing store_id' }, { status: 400 });

        const result = await readV3<Nombre>({ tenant_id, store_id });
        return NextResponse.json({ ok: true, ...result }, { status: 200 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = error instanceof V3<Nombre>StoreNotFoundError ? 404 : 500;
        return NextResponse.json({ ok: false, error: message }, { status });
    }
}
```

**Reglas del route:**
- No lógica de negocio. Solo: autorizar → validar params → llamar read model → responder.
- El 404 siempre por `instanceof` sobre una clase tipada, nunca por `message.includes(...)`.
- Si el endpoint compone múltiples read models, importar y evaluar `instanceof` para cada clase de not-found posible.

---

## 2. Patrón de read model V3

Archivo: `src/v3/read-models/<nombre>.ts`

Estructura obligatoria:

```ts
import { supabaseAdmin } from '@v2/lib/supabase'; // infraestructura compartida — permitido

// 1. Tipos de fila (privados al módulo)
interface StoreRow { tenant_id: string; store_id: string; }
// ... demás interfaces de fila

// 2. Error tipado exportado
export class V3<Nombre>StoreNotFoundError extends Error {
    code = 'STORE_NOT_FOUND' as const;
    constructor() {
        super('[v3-<nombre>] store not found');
        this.name = 'V3<Nombre>StoreNotFoundError';
    }
}

// 3. Interface de respuesta exportada
export interface V3<Nombre>Response {
    tenant_id: string;
    store_id: string;
    // ... campos del bloque
}

// 4. Función principal
export async function readV3<Nombre>(args: {
    tenant_id: string;
    store_id: string;
}): Promise<V3<Nombre>Response> {
    // a. Siempre verificar store primero
    // b. Leer datos con tenant_id + store_id en cada query
    // c. Bulk reads en Promise.all cuando no hay dependencia de datos
    // d. Construir respuesta estrictamente por run_id — nunca mezclar
    // e. Respuestas parciales (score null, signals vacíos) son válidas y explícitas
}
```

---

## 3. Patrón de errores tipados

**Regla:** cada read model exporta su propia clase de error de store not found.  
**Nunca** lanzar `new Error('... store not found')` como string y parsear en el route.

```ts
// Correcto
export class V3RunHistoryStoreNotFoundError extends Error {
    code = 'STORE_NOT_FOUND' as const;
    constructor() { super('[v3-run-history] store not found'); this.name = 'V3RunHistoryStoreNotFoundError'; }
}
if (!store) throw new V3RunHistoryStoreNotFoundError();

// PROHIBIDO
if (!store) throw new Error('[v3-...] store not found');
// → el route haría message.includes('store not found') → frágil y silencioso ante cambios
```

**Read models compuestos (como store-pulse):** re-exportar las clases de error de los read models que componen, para que el route solo importe desde un lugar.

```ts
// store-pulse.ts
export { V3RunHistoryStoreNotFoundError } from '@/v3/read-models/run-history';
export { V3ClinicalStatusStoreNotFoundError } from '@/v3/read-models/clinical-status';

// route.ts
const status = (
    error instanceof V3RunHistoryStoreNotFoundError ||
    error instanceof V3ClinicalStatusStoreNotFoundError
) ? 404 : 500;
```

---

## 4. Reglas de reutilización entre read models

| Regla | Detalle |
|---|---|
| Composición por función, no por HTTP | Si un endpoint necesita datos de otro read model, importa y llama la función directamente. Nunca `fetch('/api/v3/...')` interno. |
| No duplicar queries | Si un read model compuesto (ej: store-pulse) llama a dos read models que ambos hacen store lookup, el doble lookup es aceptable. No crear un tercer read model solo para deduplicar el lookup. |
| No duplicar lógica de negocio | `bandFromScore`, `severityRank`, `freshnessFromComputedAt` viven en `clinical-status.ts`. Si otro read model los necesita, exportarlos desde ahí y reutilizarlos. No copiarlos. |
| Proyecciones son responsabilidad del consumidor | El read model compuesto proyecta solo los campos que necesita del resultado del read model base. No modificar el read model base para acomodar al compuesto. |

---

## 5. Invariantes obligatorios

Todas las superficies V3 read-only deben cumplir estas reglas sin excepción:

**Solo V3**
- Todas las queries de negocio son sobre tablas `v3_*`.
- La única excepción permitida es `supabaseAdmin` de `@v2/lib/supabase` como cliente de infraestructura compartida — no como fuente de datos V2.

**No raw webhooks para UI**
- Ningún read model retorna filas de `v3_webhook_events` directamente.
- Los webhooks son fuente de ingesta, no de presentación.

**No mezclar runs**
- Todos los datos de un ítem de respuesta (score, signals, snapshot) deben provenir del mismo `run_id`.
- La construcción por Map keyed por `run_id` es el patrón aprobado para associar datos de múltiples tablas.

**tenant_id + store_id siempre**
- Toda query a cualquier tabla V3 filtra por `tenant_id` Y `store_id`.
- El `.in('run_id', runIds)` donde `runIds` ya viene filtrado por tenant/store es doble acotamiento válido — no reemplaza los filtros directos.

**Respuestas parciales explícitas**
- `score: null`, `signals: []`, `snapshot_id: null` son respuestas válidas.
- El campo nunca se omite del shape; se retorna con valor nulo o vacío.
- El contrato del endpoint documenta explícitamente qué campos pueden ser null y bajo qué condición.

---

## 6. Checklist de cierre de bloque

Antes de aprobar un nuevo endpoint V3 read-only como cerrado:

- [ ] Route usa `instanceof` (clase tipada) para derivar 404 — no `message.includes`
- [ ] Read model exporta su clase `V3<X>StoreNotFoundError`
- [ ] Store lookup filtra `tenant_id` + `store_id` con `.maybeSingle()`
- [ ] Todas las queries de negocio usan tablas `v3_*` únicamente
- [ ] Datos por run construidos por Map keyed en `run_id` — sin mezcla cross-run
- [ ] Respuestas parciales (null/vacío) explícitas en el interface TypeScript y en el contrato declarado
- [ ] No hay `fetch` HTTP interno a otro endpoint V3
- [ ] Lógica compartida (`bandFromScore`, `severityRank`, etc.) importada, no copiada
- [ ] Build OK
- [ ] Contrato de respuesta documentado con tipos de todos los campos nullable

---

## Superficies cerradas con este patrón

| Endpoint | Read model | Estado |
|---|---|---|
| `GET /api/v3/clinical-status` | `src/v3/read-models/clinical-status.ts` | ✅ CERRADO |
| `GET /api/v3/run-history` | `src/v3/read-models/run-history.ts` | ✅ CERRADO |
| `GET /api/v3/store-pulse` | `src/v3/read-models/store-pulse.ts` | ✅ CERRADO |
