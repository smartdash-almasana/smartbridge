const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const FIX = {
  tenantA: {
    tenant_id: '11111111-1111-4111-8111-111111111111',
    store_id: '11111111-3333-4111-8111-111111111111',
    run_id: '11111111-4444-4111-8111-111111111111',
    snapshot_id: '11111111-5555-4111-8111-111111111111',
  },
  tenantB: {
    tenant_id: '22222222-1111-4222-8222-222222222222',
    store_id: '22222222-3333-4222-8222-222222222222',
    run_id: '22222222-4444-4222-8222-222222222222',
    snapshot_id: '22222222-5555-4222-8222-222222222222',
  },
};

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

async function restSelect(url, apikey, bearer, table, select = '*') {
  const qs = new URLSearchParams({ select });
  const res = await fetch(`${url}/rest/v1/${table}?${qs.toString()}`, {
    headers: {
      apikey,
      Authorization: `Bearer ${bearer}`,
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${table} select failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const env = readEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY');
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function ensureAuthUser(email, password, tenantId) {
    const createPayload = {
      email,
      password,
      email_confirm: true,
      user_metadata: tenantId ? { tenant_id: tenantId } : {},
      app_metadata: {},
    };
    const { error: createErr } = await admin.auth.admin.createUser(createPayload);
    if (createErr && !String(createErr.message || '').toLowerCase().includes('already')) {
      throw new Error(`createUser failed for ${email}: ${createErr.message}`);
    }

    const { data: signInData, error: signInErr } = await authClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr || !signInData.session?.access_token || !signInData.user?.id) {
      throw new Error(`signInWithPassword failed for ${email}: ${signInErr?.message ?? 'missing access token'}`);
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(signInData.user.id, {
      user_metadata: tenantId ? { tenant_id: tenantId } : {},
    });
    if (updateErr) throw new Error(`updateUserById failed for ${email}: ${updateErr.message}`);

    const { data: signInData2, error: signInErr2 } = await authClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr2 || !signInData2.session?.access_token) {
      throw new Error(`re-signInWithPassword failed for ${email}: ${signInErr2?.message ?? 'missing access token'}`);
    }

    return signInData2.session.access_token;
  }

  const tokenTenantA = await ensureAuthUser('v3-tenant-a-fixture@example.com', 'V3FixturePass!2026', FIX.tenantA.tenant_id);
  const tokenNoTenant = await ensureAuthUser('v3-no-tenant-fixture@example.com', 'V3FixturePass!2026', null);

  const rpcRes = await fetch(`${url}/rest/v1/rpc/get_session_tenant_id`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${tokenTenantA}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!rpcRes.ok) {
    const body = await rpcRes.text();
    throw new Error(
      `Precondition failed: get_session_tenant_id() is not callable (${rpcRes.status}). ` +
      `Apply migration 20260310_v3_rls_tenant_policies.sql first. Body=${body}`
    );
  }
  const rpcTenant = await rpcRes.json();
  assert(rpcTenant === FIX.tenantA.tenant_id, `RLS claim resolver mismatch: expected ${FIX.tenantA.tenant_id}, got ${rpcTenant}`);

  const aScores = await restSelect(url, anon, tokenTenantA, 'v3_health_scores', 'tenant_id,store_id,run_id,score');
  assert(aScores.length >= 1, 'tenant A should see at least one score row');
  assert(aScores.every((r) => r.tenant_id === FIX.tenantA.tenant_id), 'tenant A token can see non-tenant-A score rows');
  assert(aScores.some((r) => r.run_id === FIX.tenantA.run_id), 'tenant A fixture score not visible');
  assert(!aScores.some((r) => r.run_id === FIX.tenantB.run_id), 'tenant A can see tenant B score row');

  const aSignals = await restSelect(url, anon, tokenTenantA, 'v3_clinical_signals', 'tenant_id,store_id,run_id,signal_key,severity');
  assert(aSignals.length >= 1, 'tenant A should see at least one signal row');
  assert(aSignals.every((r) => r.tenant_id === FIX.tenantA.tenant_id), 'tenant A token can see non-tenant-A signal rows');
  assert(aSignals.some((r) => r.run_id === FIX.tenantA.run_id), 'tenant A fixture signal not visible');
  assert(!aSignals.some((r) => r.run_id === FIX.tenantB.run_id), 'tenant A can see tenant B signal row');

  const noTenantScores = await restSelect(url, anon, tokenNoTenant, 'v3_health_scores', 'tenant_id,store_id,run_id,score');
  assert(noTenantScores.length === 0, 'authenticated token without tenant_id should see zero score rows');

  const { data: runs, error: runsErr } = await admin
    .from('v3_engine_runs')
    .select('tenant_id,store_id,run_id')
    .in('run_id', [FIX.tenantA.run_id, FIX.tenantB.run_id]);
  if (runsErr) throw new Error(`runtime check runs failed: ${runsErr.message}`);

  const { data: snapshots, error: snapshotsErr } = await admin
    .from('v3_snapshots')
    .select('tenant_id,store_id,run_id,snapshot_id')
    .in('run_id', [FIX.tenantA.run_id, FIX.tenantB.run_id]);
  if (snapshotsErr) throw new Error(`runtime check snapshots failed: ${snapshotsErr.message}`);

  const { data: metrics, error: metricsErr } = await admin
    .from('v3_metrics_daily')
    .select('tenant_id,store_id,run_id,snapshot_id')
    .in('run_id', [FIX.tenantA.run_id, FIX.tenantB.run_id]);
  if (metricsErr) throw new Error(`runtime check metrics failed: ${metricsErr.message}`);

  const { data: signals, error: signalsErr } = await admin
    .from('v3_clinical_signals')
    .select('tenant_id,store_id,run_id,snapshot_id,signal_key')
    .in('run_id', [FIX.tenantA.run_id, FIX.tenantB.run_id]);
  if (signalsErr) throw new Error(`runtime check signals failed: ${signalsErr.message}`);

  const { data: scores, error: scoresErr } = await admin
    .from('v3_health_scores')
    .select('tenant_id,store_id,run_id,snapshot_id,score')
    .in('run_id', [FIX.tenantA.run_id, FIX.tenantB.run_id]);
  if (scoresErr) throw new Error(`runtime check scores failed: ${scoresErr.message}`);

  const runById = new Map((runs || []).map((r) => [r.run_id, r]));
  const snapById = new Map((snapshots || []).map((s) => [s.snapshot_id, s]));

  for (const row of [...(metrics || []), ...(signals || []), ...(scores || [])]) {
    const run = runById.get(row.run_id);
    const snap = snapById.get(row.snapshot_id);
    assert(run, `missing run for row run_id=${row.run_id}`);
    assert(snap, `missing snapshot for row snapshot_id=${row.snapshot_id}`);
    assert(row.tenant_id === run.tenant_id, `tenant mismatch vs run for run_id=${row.run_id}`);
    assert(row.store_id === run.store_id, `store mismatch vs run for run_id=${row.run_id}`);
    assert(row.tenant_id === snap.tenant_id, `tenant mismatch vs snapshot for snapshot_id=${row.snapshot_id}`);
    assert(row.store_id === snap.store_id, `store mismatch vs snapshot for snapshot_id=${row.snapshot_id}`);
    assert(row.run_id === snap.run_id, `run mismatch vs snapshot for snapshot_id=${row.snapshot_id}`);
  }

  console.log('OK: tenant-aware RLS and runtime tenant consistency checks passed');
  console.log(
    JSON.stringify(
      {
        tenantA_visible_scores: aScores.length,
        tenantA_visible_signals: aSignals.length,
        noTenant_visible_scores: noTenantScores.length,
        checked_rows: {
          runs: (runs || []).length,
          snapshots: (snapshots || []).length,
          metrics: (metrics || []).length,
          signals: (signals || []).length,
          scores: (scores || []).length,
        },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
