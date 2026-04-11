import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { POST as clinicalUiPost } from '@/app/api/internal/meli/clinical-ui/route';

export const dynamic = 'force-dynamic';

type Status =
  | 'connected'
  | 'bootstrap_hot_running'
  | 'bootstrap_hot_ready'
  | 'bootstrap_cold_running'
  | 'bootstrap_cold_ready'
  | 'completed'
  | 'failed';

const COLD_MONTHS_TOTAL = 9;
const MAX_RETRIES = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function computeColdMonths(now = new Date()): string[] {
  const hotFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const coldTo = new Date(Date.UTC(hotFrom.getUTCFullYear(), hotFrom.getUTCMonth(), 1));
  const coldFrom = new Date(Date.UTC(coldTo.getUTCFullYear(), coldTo.getUTCMonth() - COLD_MONTHS_TOTAL, 1));
  const months: string[] = [];
  const cursor = new Date(coldFrom);
  while (cursor < coldTo) {
    months.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function ensureInternalSecret(req: NextRequest): NextResponse | null {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    return NextResponse.json(
      {
        ok: false,
        error_code: 'INTERNAL_SECRET_MISSING',
        message: 'INTERNAL_SECRET no está configurado. Ver docs/runbooks/ONBOARDING_MELI.md'
      },
      { status: 503 }
    );
  }
  const secret = req.headers.get('x-internal-secret');
  if (secret !== internalSecret) {
    return NextResponse.json(
      {
        ok: false,
        error_code: 'UNAUTHORIZED',
        message: 'Credenciales internas inválidas.'
      },
      { status: 401 }
    );
  }
  return null;
}

async function resolveContext(input: { seller_uuid?: string; store_id?: string }) {
  if (input.seller_uuid) {
    const { data: seller } = await supabaseAdmin
      .from('sellers')
      .select('seller_uuid, external_id, provider_key')
      .eq('seller_uuid', input.seller_uuid)
      .eq('provider_key', 'meli')
      .maybeSingle();

    if (!seller) return null;

    const storeId = input.store_id || process.env.ONBOARDING_DEFAULT_STORE_ID || seller.seller_uuid;
    return {
      store_id: String(storeId),
      seller_uuid: String(seller.seller_uuid),
      external_id: String(seller.external_id),
      provider_key: String(seller.provider_key || 'meli')
    };
  }

  if (input.store_id) {
    const { data: maybeSeller } = await supabaseAdmin
      .from('sellers')
      .select('seller_uuid, external_id, provider_key')
      .or(`seller_uuid.eq.${input.store_id},external_id.eq.${input.store_id}`)
      .eq('provider_key', 'meli')
      .maybeSingle();

    if (!maybeSeller) return null;

    const normalizedStoreId = UUID_RE.test(String(input.store_id))
      ? String(input.store_id)
      : String(maybeSeller.seller_uuid);

    return {
      store_id: normalizedStoreId,
      seller_uuid: String(maybeSeller.seller_uuid),
      external_id: String(maybeSeller.external_id),
      provider_key: String(maybeSeller.provider_key || 'meli')
    };
  }

  return null;
}

async function upsertOnboardingState(params: {
  store_id: string;
  seller_uuid: string;
  provider_key: string;
  status: Status;
  hot_window_from?: string | null;
  hot_window_to?: string | null;
  cold_months_done?: number;
  last_error?: string | null;
}) {
  const payload = {
    store_id: params.store_id,
    seller_uuid: params.seller_uuid,
    provider_key: params.provider_key,
    status: params.status,
    hot_window_from: params.hot_window_from ?? null,
    hot_window_to: params.hot_window_to ?? null,
    cold_months_total: COLD_MONTHS_TOTAL,
    cold_months_done: params.cold_months_done ?? 0,
    last_error: params.last_error ?? null,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabaseAdmin
    .from('onboarding_state')
    .upsert(payload, { onConflict: 'store_id' });
  if (error) throw error;
}

async function ensureColdJobs(sellerUuid: string, months: string[]) {
  const nowIso = new Date().toISOString();
  const { data: existing } = await supabaseAdmin
    .from('archive_jobs')
    .select('id, month, status, retries, next_retry_at, last_error, updated_at')
    .eq('seller_uuid', sellerUuid)
    .in('month', months);

  const byMonth = new Map<string, any>();
  for (const row of existing || []) {
    const previous = byMonth.get(row.month);
    if (!previous || new Date(row.updated_at).getTime() > new Date(previous.updated_at).getTime()) {
      byMonth.set(row.month, row);
    }
  }

  const inserts: Array<{ seller_uuid: string; month: string; status: string; retries: number; next_retry_at: string | null; updated_at: string }> = [];

  for (const month of months) {
    const row = byMonth.get(month);
    if (!row) {
      inserts.push({ seller_uuid: sellerUuid, month, status: 'pending', retries: 0, next_retry_at: null, updated_at: nowIso });
      continue;
    }

    if (row.status === 'failed') {
      const due = !row.next_retry_at || new Date(row.next_retry_at).getTime() <= Date.now();
      if (!due) continue;
      const retries = Number(row.retries || 0) + 1;
      const patch: Record<string, any> = {
        retries,
        updated_at: nowIso
      };
      if (retries >= MAX_RETRIES) {
        patch.status = 'dlq';
        patch.next_retry_at = null;
      } else {
        patch.status = 'pending';
        patch.next_retry_at = new Date(Date.now() + Math.pow(2, retries) * 60_000).toISOString();
      }

      await supabaseAdmin.from('archive_jobs').update(patch).eq('id', row.id);
    }
  }

  if (inserts.length > 0) {
    await supabaseAdmin.from('archive_jobs').insert(inserts);
  }
}

async function getColdProgress(sellerUuid: string, expectedMonths: string[]) {
  const { data } = await supabaseAdmin
    .from('archive_manifest')
    .select('month')
    .eq('seller_uuid', sellerUuid)
    .in('month', expectedMonths);

  const doneSet = new Set((data || []).map((d) => d.month));
  return doneSet.size;
}

function nextActions(status: Status, coldDone: number): string[] {
  if (status === 'completed') return ['Onboarding finalizado'];
  if (status === 'failed') return ['Reintentar POST /api/internal/onboarding/meli con el mismo seller'];
  if (status === 'bootstrap_hot_running') return ['Esperar bootstrap hot'];
  if (status === 'bootstrap_hot_ready' || status === 'bootstrap_cold_running') {
    return coldDone >= COLD_MONTHS_TOTAL
      ? ['Marcar completed']
      : ['Procesar archive_jobs pendientes y generar archive_manifest faltantes'];
  }
  return ['Conectar ML y reiniciar onboarding'];
}

export async function POST(req: NextRequest) {
  const authError = ensureInternalSecret(req);
  if (authError) return authError;

  try {
    const body = await req.json().catch(() => ({}));
    const ctx = await resolveContext({
      seller_uuid: body?.seller_uuid,
      store_id: body?.store_id
    });

    if (!ctx) {
      return NextResponse.json(
        { ok: false, error: 'seller context not found; send seller_uuid or a resolvable store_id' },
        { status: 400 }
      );
    }

    const expectedMonths = computeColdMonths();
    const hotFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const hotTo = new Date().toISOString();

    console.info(JSON.stringify({ level: 'info', msg: 'onboarding.start', store_id: ctx.store_id, seller_uuid: ctx.seller_uuid }));
    await upsertOnboardingState({
      store_id: ctx.store_id,
      seller_uuid: ctx.seller_uuid,
      provider_key: ctx.provider_key,
      status: 'bootstrap_hot_running',
      hot_window_from: hotFrom,
      hot_window_to: hotTo,
      last_error: null
    });

    const hotReq = new Request('http://localhost/api/internal/meli/clinical-ui', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-key': process.env.INTERNAL_DIAGNOSTICS_KEY || ''
      },
      body: JSON.stringify({
        seller_uuid: ctx.seller_uuid,
        external_id: ctx.external_id,
        months: 12
      })
    });

    const hotRes = await clinicalUiPost(hotReq);
    const hotPayload = await hotRes.json();
    if (!hotPayload?.ok) {
      const message = hotPayload?.error || 'hot bootstrap check failed';
      await upsertOnboardingState({
        store_id: ctx.store_id,
        seller_uuid: ctx.seller_uuid,
        provider_key: ctx.provider_key,
        status: 'failed',
        hot_window_from: hotFrom,
        hot_window_to: hotTo,
        last_error: message
      });
      return NextResponse.json({ ok: false, status: 'failed', error: message }, { status: 500 });
    }

    await upsertOnboardingState({
      store_id: ctx.store_id,
      seller_uuid: ctx.seller_uuid,
      provider_key: ctx.provider_key,
      status: 'bootstrap_hot_ready',
      hot_window_from: hotFrom,
      hot_window_to: hotTo
    });

    await upsertOnboardingState({
      store_id: ctx.store_id,
      seller_uuid: ctx.seller_uuid,
      provider_key: ctx.provider_key,
      status: 'bootstrap_cold_running',
      hot_window_from: hotFrom,
      hot_window_to: hotTo
    });

    await ensureColdJobs(ctx.seller_uuid, expectedMonths);
    const coldDone = await getColdProgress(ctx.seller_uuid, expectedMonths);
    const status: Status = coldDone >= COLD_MONTHS_TOTAL ? 'completed' : coldDone > 0 ? 'bootstrap_cold_running' : 'bootstrap_hot_ready';

    await upsertOnboardingState({
      store_id: ctx.store_id,
      seller_uuid: ctx.seller_uuid,
      provider_key: ctx.provider_key,
      status,
      hot_window_from: hotFrom,
      hot_window_to: hotTo,
      cold_months_done: coldDone
    });

    if (coldDone >= COLD_MONTHS_TOTAL) {
      await upsertOnboardingState({
        store_id: ctx.store_id,
        seller_uuid: ctx.seller_uuid,
        provider_key: ctx.provider_key,
        status: 'bootstrap_cold_ready',
        hot_window_from: hotFrom,
        hot_window_to: hotTo,
        cold_months_done: coldDone
      });
      await upsertOnboardingState({
        store_id: ctx.store_id,
        seller_uuid: ctx.seller_uuid,
        provider_key: ctx.provider_key,
        status: 'completed',
        hot_window_from: hotFrom,
        hot_window_to: hotTo,
        cold_months_done: coldDone
      });
    }

    console.info(JSON.stringify({
      level: 'info',
      msg: 'onboarding.progress',
      store_id: ctx.store_id,
      seller_uuid: ctx.seller_uuid,
      cold_months_done: coldDone,
      cold_months_total: COLD_MONTHS_TOTAL,
      status
    }));

    return NextResponse.json({
      ok: true,
      seller_uuid: ctx.seller_uuid,
      store_id: ctx.store_id,
      status,
      hot_ready: true,
      cold_done: coldDone,
      cold_total: COLD_MONTHS_TOTAL,
      last_error: null,
      next_actions: nextActions(status, coldDone)
    });
  } catch (error: any) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'onboarding.error',
      error: error?.message || 'unknown'
    }));
    return NextResponse.json({ ok: false, error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const authError = ensureInternalSecret(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const sellerUuid = searchParams.get('seller_uuid') || undefined;
  const storeId = searchParams.get('store_id') || undefined;

  const ctx = await resolveContext({ seller_uuid: sellerUuid, store_id: storeId });
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: 'seller context not found; use seller_uuid or resolvable store_id' },
      { status: 400 }
    );
  }

  const expectedMonths = computeColdMonths();
  const coldDone = await getColdProgress(ctx.seller_uuid, expectedMonths);

  const { data: state } = await supabaseAdmin
    .from('onboarding_state')
    .select('status, hot_window_from, hot_window_to, cold_months_total, cold_months_done, last_error, updated_at')
    .eq('store_id', ctx.store_id)
    .maybeSingle();

  const effectiveStatus = (state?.status as Status | undefined) || 'connected';
  const normalizedStatus: Status =
    coldDone >= COLD_MONTHS_TOTAL && effectiveStatus !== 'failed'
      ? 'completed'
      : effectiveStatus;

  return NextResponse.json({
    ok: true,
    seller_uuid: ctx.seller_uuid,
    store_id: ctx.store_id,
    status: normalizedStatus,
    hot_ready: normalizedStatus !== 'connected' && normalizedStatus !== 'bootstrap_hot_running' && normalizedStatus !== 'failed',
    cold_done: coldDone,
    cold_total: state?.cold_months_total || COLD_MONTHS_TOTAL,
    hot_window_from: state?.hot_window_from || null,
    hot_window_to: state?.hot_window_to || null,
    last_error: state?.last_error || null,
    updated_at: state?.updated_at || null,
    next_actions: nextActions(normalizedStatus, coldDone),
    links: {
      clinical_ui: `/api/internal/meli/clinical-ui`,
      archive_manifest: 'archive_manifest',
      archive_jobs: 'archive_jobs'
    }
  });
}
