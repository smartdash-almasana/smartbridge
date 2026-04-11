// ============================================================================
// SmartSeller V2 — DB Row Types
// Derived from live schema: public.v2_stores, public.v2_webhook_events
// DO NOT extend with clinical types here. See engine types for that.
// ============================================================================

export interface StoreRow {
  store_id: string;              // uuid
  tenant_id: string;             // uuid
  seller_uuid: string;           // uuid
  provider_key: 'mercadolibre' | 'shopify';
  external_account_id: string;   // opaque TEXT — never cast to numeric
  connection_status: 'connected' | 'disconnected' | 'uninstalled' | 'error';
  market: string | null;
  created_at: string;            // timestamptz as ISO string
  updated_at: string;
}

export interface WebhookEventRow {
  event_id: string;              // uuid
  store_id: string;              // uuid FK → v2_stores
  provider_event_id: string;     // idempotency key (from provider)
  topic: string;
  resource: string | null;
  provider_user_id: string | null;
  raw_payload: Record<string, unknown> | null;
  received_at: string;           // timestamptz as ISO string
}
