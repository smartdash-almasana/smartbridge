CREATE TABLE IF NOT EXISTS signals_current (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    signal_code TEXT NOT NULL,
    entity_ref TEXT NOT NULL,
    ingestion_id TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(signal_code, entity_ref, tenant_id)
);

CREATE TABLE IF NOT EXISTS signals_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    signal_code TEXT NOT NULL,
    entity_ref TEXT NOT NULL,
    ingestion_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    signal_code TEXT NOT NULL,
    entity_ref TEXT NOT NULL,
    action_type TEXT NOT NULL,
    status TEXT NOT NULL,
    ingestion_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
