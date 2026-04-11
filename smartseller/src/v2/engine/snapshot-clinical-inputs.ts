import { supabaseAdmin } from '../lib/supabase';

export interface SnapshotClinicalInputs {
    refunds_count_1d: number;
    refunds_sample_ids: string[];
    payments_unlinked_1d: number;
    payments_sample_ids: string[];
    zero_price_items_1d: number;
    zero_price_sample_items: Array<{ item_external_id: string; order_external_id: string | null }>;
}

interface SeedSnapshotInputsArgs {
    tenant_id: string;
    store_id: string;
    run_id: string;
    metric_date: string;
}

function asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

async function buildClinicalInputs(tenant_id: string, store_id: string, metric_date: string): Promise<SnapshotClinicalInputs> {
    const dayStart = `${metric_date}T00:00:00.000Z`;
    const dayEnd = `${metric_date}T23:59:59.999Z`;

    const [{ data: refundRows, error: refundErr }, { data: payRows, error: payErr }, { data: itemRows, error: itemErr }] = await Promise.all([
        supabaseAdmin
            .from('v2_refunds')
            .select('refund_external_id')
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .gte('created_at', dayStart)
            .lte('created_at', dayEnd),
        supabaseAdmin
            .from('v2_payments')
            .select('payment_external_id, order_external_id')
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .gte('created_at', dayStart)
            .lte('created_at', dayEnd),
        supabaseAdmin
            .from('v2_order_items')
            .select('line_external_id, order_external_id')
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .eq('unit_price_amount', 0)
            .gt('quantity', 0)
            .gte('created_at', dayStart)
            .lte('created_at', dayEnd),
    ]);

    if (refundErr) throw new Error(`[snapshot-inputs] refunds read failed: ${refundErr.message}`);
    if (payErr) throw new Error(`[snapshot-inputs] payments read failed: ${payErr.message}`);
    if (itemErr) throw new Error(`[snapshot-inputs] zero-price-items read failed: ${itemErr.message}`);

    const refundsSampleIds = (refundRows ?? [])
        .map((r: { refund_external_id: string | null }) => r.refund_external_id)
        .filter((v: string | null): v is string => Boolean(v))
        .slice(0, 20);

    const paymentRows = (payRows ?? []) as Array<{ payment_external_id: string; order_external_id: string | null }>;
    const unlinkedPaymentIds: string[] = paymentRows
        .filter((p) => !p.order_external_id)
        .map((p) => p.payment_external_id);

    const orderIdsToCheck = Array.from(new Set(
        paymentRows.filter((p) => !!p.order_external_id).map((p) => p.order_external_id as string)
    ));

    if (orderIdsToCheck.length > 0) {
        const { data: existOrders, error: ordErr } = await supabaseAdmin
            .from('v2_orders')
            .select('order_external_id')
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .in('order_external_id', orderIdsToCheck);

        if (ordErr) throw new Error(`[snapshot-inputs] orders read failed: ${ordErr.message}`);

        const existingOrderIds = new Set((existOrders ?? []).map((o: { order_external_id: string }) => o.order_external_id));
        const orphaned = paymentRows
            .filter((p) => p.order_external_id && !existingOrderIds.has(p.order_external_id))
            .map((p) => p.payment_external_id);
        unlinkedPaymentIds.push(...orphaned);
    }

    const zeroPriceSampleItems = ((itemRows ?? []) as Array<{ line_external_id: string; order_external_id: string | null }>)
        .slice(0, 20)
        .map((r) => ({ item_external_id: r.line_external_id, order_external_id: r.order_external_id ?? null }));

    return {
        refunds_count_1d: (refundRows ?? []).length,
        refunds_sample_ids: refundsSampleIds,
        payments_unlinked_1d: unlinkedPaymentIds.length,
        payments_sample_ids: unlinkedPaymentIds.slice(0, 20),
        zero_price_items_1d: (itemRows ?? []).length,
        zero_price_sample_items: zeroPriceSampleItems,
    };
}

export async function seedSnapshotClinicalInputs(args: SeedSnapshotInputsArgs): Promise<{ snapshot_id: string; clinical_inputs: SnapshotClinicalInputs }> {
    const { tenant_id, store_id, run_id, metric_date } = args;
    const clinical_inputs = await buildClinicalInputs(tenant_id, store_id, metric_date);

    const { data: existingSnapshot, error: existingSnapshotErr } = await supabaseAdmin
        .from('v2_snapshots')
        .select('snapshot_id, payload')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('run_id', run_id)
        .order('snapshot_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ snapshot_id: string; payload: Record<string, unknown> | null }>();

    if (existingSnapshotErr) throw new Error(`[snapshot-inputs] snapshot lookup failed: ${existingSnapshotErr.message}`);

    const payloadPatch = {
        metric_date,
        inputs_source: 'snapshot_canonical_v1',
        clinical_inputs,
    };

    if (existingSnapshot?.snapshot_id) {
        const mergedPayload = {
            ...asObject(existingSnapshot.payload),
            ...payloadPatch,
        };
        const { error: updateErr } = await supabaseAdmin
            .from('v2_snapshots')
            .update({ payload: mergedPayload })
            .eq('snapshot_id', existingSnapshot.snapshot_id)
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id);
        if (updateErr) throw new Error(`[snapshot-inputs] snapshot update failed: ${updateErr.message}`);
        return { snapshot_id: existingSnapshot.snapshot_id, clinical_inputs };
    }

    const { data: insertedSnapshot, error: insertErr } = await supabaseAdmin
        .from('v2_snapshots')
        .insert({
            tenant_id,
            store_id,
            run_id,
            snapshot_at: new Date().toISOString(),
            payload: payloadPatch,
        })
        .select('snapshot_id')
        .single<{ snapshot_id: string }>();

    if (insertErr || !insertedSnapshot) {
        throw new Error(`[snapshot-inputs] snapshot insert failed: ${insertErr?.message ?? 'unknown error'}`);
    }

    return { snapshot_id: insertedSnapshot.snapshot_id, clinical_inputs };
}

export async function readSnapshotClinicalInputs(args: {
    tenant_id: string;
    store_id: string;
    run_id: string;
}): Promise<SnapshotClinicalInputs> {
    const { tenant_id, store_id, run_id } = args;

    const { data: snapshot, error } = await supabaseAdmin
        .from('v2_snapshots')
        .select('payload')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('run_id', run_id)
        .order('snapshot_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ payload: Record<string, unknown> | null }>();

    if (error) throw new Error(`[snapshot-inputs] snapshot read failed: ${error.message}`);
    if (!snapshot?.payload) throw new Error('[snapshot-inputs] snapshot payload not found for run');

    const payload = asObject(snapshot.payload);
    const clinicalInputs = asObject(payload['clinical_inputs']);

    return {
        refunds_count_1d: Number(clinicalInputs['refunds_count_1d'] ?? 0),
        refunds_sample_ids: Array.isArray(clinicalInputs['refunds_sample_ids']) ? clinicalInputs['refunds_sample_ids'] as string[] : [],
        payments_unlinked_1d: Number(clinicalInputs['payments_unlinked_1d'] ?? 0),
        payments_sample_ids: Array.isArray(clinicalInputs['payments_sample_ids']) ? clinicalInputs['payments_sample_ids'] as string[] : [],
        zero_price_items_1d: Number(clinicalInputs['zero_price_items_1d'] ?? 0),
        zero_price_sample_items: Array.isArray(clinicalInputs['zero_price_sample_items'])
            ? clinicalInputs['zero_price_sample_items'] as Array<{ item_external_id: string; order_external_id: string | null }>
            : [],
    };
}
