# ADR — store_id como Unidad Operativa (Installation / Connected Account)

## Estado
Proposed → Ready for Accepted

## Contexto

SmartSeller V1 requiere persistir entidades clínicas por tienda
(órdenes, ítems, envíos, pagos, reembolsos) con idempotencia determinística
y scoping multi-tenant real.

El inventario canónico previo no definía formalmente `store_id`.

## Decisión

- `store_id` = UUID interno que representa una instalación/cuenta conectada.
- `seller_uuid` = identidad clínica del vendedor.
- Cardinalidad: seller_uuid 1 → N stores.

## Invariantes

1. Toda tabla `v2_*` debe incluir:
   - tenant_id
   - store_id
   - seller_uuid
   - provider_key
   - external_id

2. Idempotencia se scopea por:
   UNIQUE(provider_key, store_id, external_id)

3. No se permite:
   - seller_id (usar seller_uuid)
   - meli_user_id (usar external_id)
   - scenario_key (usar signal_key)

## Consecuencias

- Se incorpora tabla canónica `stores`.
- QA y writers se scopean por store_id.
- Dos stores del mismo seller pueden tener el mismo external_id sin colisión.

## Definición Canónica — Tabla stores

- store_id (uuid, PK)
- seller_uuid (uuid, FK → sellers.seller_uuid)
- tenant_id (text, NOT NULL)
- provider_key (text, NOT NULL)
- external_id (text, NOT NULL)
- status (text, NOT NULL)

UNIQUE(provider_key, tenant_id, external_id)
INDEX(seller_uuid)
INDEX(tenant_id, provider_key, status)