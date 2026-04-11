const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function readEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  const raw = fs.readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1');
    out[k] = v;
  }
  return out;
}

const FIXTURES = {
  tenantA: {
    tenant_id: '11111111-1111-4111-8111-111111111111',
    seller_uuid: '11111111-2222-4111-8111-111111111111',
    store_id: '11111111-3333-4111-8111-111111111111',
    run_id: '11111111-4444-4111-8111-111111111111',
    snapshot_id: '11111111-5555-4111-8111-111111111111',
    metric_date: '2026-03-10',
    signal_id: '11111111-6666-4111-8111-111111111111',
    score_id: '11111111-7777-4111-8111-111111111111',
  },
  tenantB: {
    tenant_id: '22222222-1111-4222-8222-222222222222',
    seller_uuid: '22222222-2222-4222-8222-222222222222',
    store_id: '22222222-3333-4222-8222-222222222222',
    run_id: '22222222-4444-4222-8222-222222222222',
    snapshot_id: '22222222-5555-4222-8222-222222222222',
    metric_date: '2026-03-10',
    signal_id: '22222222-6666-4222-8222-222222222222',
    score_id: '22222222-7777-4222-8222-222222222222',
  },
};

async function upsertTenantBundle(admin, key, fx) {
  const tenantKey = `fixture_${key}`;
  const sellerKey = `fixture_seller_${key}`;
  const storeKey = `fixture_store_${key}`;

  const { error: tErr } = await admin.from('v3_tenants').upsert(
    {
      tenant_id: fx.tenant_id,
      tenant_key: tenantKey,
      display_name: `Fixture ${key.toUpperCase()}`,
      status: 'active',
    },
    { onConflict: 'tenant_key' }
  );
  if (tErr) throw new Error(`v3_tenants upsert failed (${key}): ${tErr.message}`);

  const { error: sErr } = await admin.from('v3_sellers').upsert(
    {
      seller_uuid: fx.seller_uuid,
      tenant_id: fx.tenant_id,
      seller_key: sellerKey,
      display_name: `Fixture Seller ${key.toUpperCase()}`,
    },
    { onConflict: 'tenant_id,seller_key' }
  );
  if (sErr) throw new Error(`v3_sellers upsert failed (${key}): ${sErr.message}`);

  const { error: stErr } = await admin.from('v3_stores').upsert(
    {
      store_id: fx.store_id,
      tenant_id: fx.tenant_id,
      seller_uuid: fx.seller_uuid,
      store_key: storeKey,
      provider_key: 'system',
      status: 'active',
    },
    { onConflict: 'tenant_id,provider_key,store_key' }
  );
  if (stErr) throw new Error(`v3_stores upsert failed (${key}): ${stErr.message}`);

  const nowIso = new Date().toISOString();
  const { error: runErr } = await admin.from('v3_engine_runs').upsert(
    {
      run_id: fx.run_id,
      tenant_id: fx.tenant_id,
      store_id: fx.store_id,
      metric_date: fx.metric_date,
      orchestrator_key: 'v3_tenant_isolation_fixture',
      status: 'done',
      started_at: nowIso,
      finished_at: nowIso,
    },
    { onConflict: 'tenant_id,store_id,metric_date,orchestrator_key' }
  );
  if (runErr) throw new Error(`v3_engine_runs upsert failed (${key}): ${runErr.message}`);

  const snapshotPayload = {
    source: 'v3_tenant_isolation_fixture',
    clinical_inputs: {
      source_webhook_events_1d: key === 'tenantA' ? 0 : 4,
      source_domain_events_1d: key === 'tenantA' ? 0 : 4,
    },
  };
  const { error: snapErr } = await admin.from('v3_snapshots').upsert(
    {
      snapshot_id: fx.snapshot_id,
      tenant_id: fx.tenant_id,
      store_id: fx.store_id,
      run_id: fx.run_id,
      payload: snapshotPayload,
      snapshot_at: nowIso,
    },
    { onConflict: 'tenant_id,store_id,run_id' }
  );
  if (snapErr) throw new Error(`v3_snapshots upsert failed (${key}): ${snapErr.message}`);

  const metrics = snapshotPayload.clinical_inputs;
  const { error: mErr } = await admin.from('v3_metrics_daily').upsert(
    {
      tenant_id: fx.tenant_id,
      store_id: fx.store_id,
      metric_date: fx.metric_date,
      run_id: fx.run_id,
      snapshot_id: fx.snapshot_id,
      metrics,
      computed_at: nowIso,
    },
    { onConflict: 'tenant_id,store_id,metric_date' }
  );
  if (mErr) throw new Error(`v3_metrics_daily upsert failed (${key}): ${mErr.message}`);

  const severity = key === 'tenantA' ? 'warning' : 'none';
  const { error: csErr } = await admin.from('v3_clinical_signals').upsert(
    {
      signal_id: fx.signal_id,
      tenant_id: fx.tenant_id,
      store_id: fx.store_id,
      run_id: fx.run_id,
      snapshot_id: fx.snapshot_id,
      signal_key: 'source_webhook_events_1d_zero',
      severity,
      evidence: {
        metric_date: fx.metric_date,
        source_webhook_events_1d: metrics.source_webhook_events_1d,
      },
      created_at: nowIso,
    },
    { onConflict: 'tenant_id,store_id,run_id,signal_key' }
  );
  if (csErr) throw new Error(`v3_clinical_signals upsert failed (${key}): ${csErr.message}`);

  const score = key === 'tenantA' ? 80 : 100;
  const { error: hsErr } = await admin.from('v3_health_scores').upsert(
    {
      score_id: fx.score_id,
      tenant_id: fx.tenant_id,
      store_id: fx.store_id,
      run_id: fx.run_id,
      snapshot_id: fx.snapshot_id,
      score,
      score_payload: {
        fixture: true,
        key,
        score_version: 'v3_health_score_v1',
      },
      computed_at: nowIso,
    },
    { onConflict: 'tenant_id,store_id,run_id' }
  );
  if (hsErr) throw new Error(`v3_health_scores upsert failed (${key}): ${hsErr.message}`);
}

async function main() {
  const env = readEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await upsertTenantBundle(admin, 'tenantA', FIXTURES.tenantA);
  await upsertTenantBundle(admin, 'tenantB', FIXTURES.tenantB);

  console.log('V3 tenant isolation fixtures upserted');
  console.log(JSON.stringify(FIXTURES, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
