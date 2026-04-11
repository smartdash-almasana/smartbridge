import { supabaseAdmin } from '@v2/lib/supabase';

export interface MaterializeV3SignalsInput {
    tenant_id: string;
    store_id: string;
    run_id: string;
    metric_date: string;
}

export interface V3SignalWriteResult {
    signal_key: string;
    severity: 'none' | 'info' | 'warning' | 'critical';
    created: boolean;
}

export interface MaterializeV3SignalsResult {
    snapshot_id: string;
    created_count: number;
    signals: V3SignalWriteResult[];
}

interface MetricsDailyRow {
    metric_date: string;
    metrics: Record<string, unknown> | null;
}

function asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function asNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function minusDays(metricDate: string, days: number): string {
    const startIso = `${metricDate}T00:00:00.000Z`;
    const startMs = Date.parse(startIso);
    if (!Number.isFinite(startMs)) {
        throw new Error(`[v3-signals-writer] invalid metric_date: ${metricDate}`);
    }
    const shifted = new Date(startMs - days * 24 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
}

function sumMetric(rows: MetricsDailyRow[], key: string): number {
    let total = 0;
    for (const row of rows) {
        const metrics = asObject(row.metrics);
        total += asNumber(metrics[key]);
    }
    return total;
}

function maxMetric(rows: MetricsDailyRow[], key: string): number {
    let current = 0;
    for (const row of rows) {
        const metrics = asObject(row.metrics);
        current = Math.max(current, asNumber(metrics[key]));
    }
    return current;
}

export async function materializeV3ClinicalSignals(input: MaterializeV3SignalsInput): Promise<MaterializeV3SignalsResult> {
    const { tenant_id, store_id, run_id, metric_date } = input;
    const windowStart7d = minusDays(metric_date, 6);
    const windowStart3d = minusDays(metric_date, 2);

    const { data: metricsRow, error: metricsErr } = await supabaseAdmin
        .from('v3_metrics_daily')
        .select('snapshot_id, metrics')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('metric_date', metric_date)
        .limit(1)
        .maybeSingle<{ snapshot_id: string; metrics: Record<string, unknown> | null }>();
    if (metricsErr) throw new Error(`[v3-signals-writer] metrics lookup failed: ${metricsErr.message}`);
    if (!metricsRow?.snapshot_id) throw new Error('[v3-signals-writer] metrics row not found for metric_date');

    const { data: rows7d, error: rows7dErr } = await supabaseAdmin
        .from('v3_metrics_daily')
        .select('metric_date, metrics')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .gte('metric_date', windowStart7d)
        .lte('metric_date', metric_date)
        .order('metric_date', { ascending: true });
    if (rows7dErr) throw new Error(`[v3-signals-writer] rolling 7d metrics lookup failed: ${rows7dErr.message}`);

    const { data: rows3d, error: rows3dErr } = await supabaseAdmin
        .from('v3_metrics_daily')
        .select('metric_date, metrics')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .gte('metric_date', windowStart3d)
        .lte('metric_date', metric_date)
        .order('metric_date', { ascending: true });
    if (rows3dErr) throw new Error(`[v3-signals-writer] rolling 3d metrics lookup failed: ${rows3dErr.message}`);

    const typed7d = (rows7d ?? []) as MetricsDailyRow[];
    const typed3d = (rows3d ?? []) as MetricsDailyRow[];

    const salesPaid7d = sumMetric(typed7d, 'sales_paid_1d');
    const domainEvents7d = sumMetric(typed7d, 'source_domain_events_1d');
    const webhookEvents7d = sumMetric(typed7d, 'source_webhook_events_1d');
    const activeDays7d = typed7d.filter((row) => {
        const metrics = asObject(row.metrics);
        return asNumber(metrics['source_domain_events_1d']) > 0 || asNumber(metrics['source_webhook_events_1d']) > 0;
    }).length;

    const ordersCreated3d = sumMetric(typed3d, 'orders_created_1d');
    const ordersCancelled3d = sumMetric(typed3d, 'orders_cancelled_1d');
    const cancellationRate3d = ordersCreated3d > 0 ? ordersCancelled3d / ordersCreated3d : 0;

    const currentMetrics = asObject(metricsRow.metrics);
    const unansweredQuestions24h = asNumber(currentMetrics['unanswered_questions_24h_count_1d']);
    const activeClaims = asNumber(currentMetrics['active_claims_count_1d']);
    const shipmentsAtRisk = asNumber(currentMetrics['shipments_at_risk_count_1d']);
    const shipmentsDelayed = asNumber(currentMetrics['shipments_delayed_1d']);

    const noSalesGuard = activeDays7d >= 3 && (domainEvents7d + webhookEvents7d) >= 10;

    const candidates: Array<{
        signal_key: string;
        severity: 'none' | 'info' | 'warning' | 'critical';
        evidence: Record<string, unknown>;
    }> = [
        {
            signal_key: 'no_sales_7d',
            severity: noSalesGuard && salesPaid7d === 0 ? 'critical' : 'none',
            evidence: {
                metric_date,
                window_days: 7,
                sales_paid_7d: salesPaid7d,
                source_domain_events_7d: domainEvents7d,
                source_webhook_events_7d: webhookEvents7d,
                active_days_7d: activeDays7d,
                guardrails_passed: noSalesGuard,
            },
        },
        {
            signal_key: 'cancellation_rate_spike',
            severity: ordersCreated3d < 10
                ? 'none'
                : (cancellationRate3d >= 0.4 ? 'critical' : (cancellationRate3d >= 0.25 ? 'warning' : 'none')),
            evidence: {
                metric_date,
                window_days: 3,
                orders_created_3d: ordersCreated3d,
                orders_cancelled_3d: ordersCancelled3d,
                cancellation_rate_3d: Number(cancellationRate3d.toFixed(4)),
                min_orders_guard: 10,
            },
        },
        {
            signal_key: 'unanswered_questions_24h',
            severity: unansweredQuestions24h >= 3 ? 'critical' : (unansweredQuestions24h >= 1 ? 'warning' : 'none'),
            evidence: {
                metric_date,
                unanswered_questions_24h_count: unansweredQuestions24h,
                warning_threshold: 1,
                critical_threshold: 3,
            },
        },
        {
            signal_key: 'active_claims_count',
            severity: activeClaims >= 5 ? 'critical' : (activeClaims >= 2 ? 'warning' : 'none'),
            evidence: {
                metric_date,
                active_claims_count: activeClaims,
                warning_threshold: 2,
                critical_threshold: 5,
            },
        },
        {
            signal_key: 'shipment_delay_risk',
            severity: (shipmentsAtRisk >= 8 || shipmentsDelayed >= 4)
                ? 'critical'
                : ((shipmentsAtRisk >= 3 || shipmentsDelayed >= 2) ? 'warning' : 'none'),
            evidence: {
                metric_date,
                shipments_at_risk_count: shipmentsAtRisk,
                shipments_delayed_1d: shipmentsDelayed,
                warning_threshold_at_risk: 3,
                critical_threshold_at_risk: 8,
                fallback_rule: 'uses delayed_or_stale_pending_when_deadline_missing',
            },
        },
    ];

    const signalKeys = candidates
        .filter((c) => c.severity !== 'none')
        .map((c) => c.signal_key);

    const existingKeys = new Set<string>();
    if (signalKeys.length > 0) {
        const { data: existingRows, error: existingErr } = await supabaseAdmin
            .from('v3_clinical_signals')
            .select('signal_key')
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .eq('run_id', run_id)
            .in('signal_key', signalKeys);
        if (existingErr) throw new Error(`[v3-signals-writer] existing signals lookup failed: ${existingErr.message}`);
        for (const row of existingRows ?? []) {
            const key = (row as { signal_key?: string }).signal_key;
            if (key) existingKeys.add(key);
        }
    }

    const results: V3SignalWriteResult[] = [];

    for (const candidate of candidates) {
        if (candidate.severity === 'none') {
            results.push({
                signal_key: candidate.signal_key,
                severity: 'none',
                created: false,
            });
            continue;
        }

        const { error: upsertErr } = await supabaseAdmin
            .from('v3_clinical_signals')
            .upsert(
                {
                    tenant_id,
                    store_id,
                    run_id,
                    snapshot_id: metricsRow.snapshot_id,
                    signal_key: candidate.signal_key,
                    severity: candidate.severity,
                    evidence: candidate.evidence,
                },
                { onConflict: 'tenant_id,store_id,run_id,signal_key' }
            );
        if (upsertErr) throw new Error(`[v3-signals-writer] signal upsert failed (${candidate.signal_key}): ${upsertErr.message}`);

        results.push({
            signal_key: candidate.signal_key,
            severity: candidate.severity,
            created: !existingKeys.has(candidate.signal_key),
        });
    }

    return {
        snapshot_id: metricsRow.snapshot_id,
        created_count: results.filter((r) => r.created).length,
        signals: results,
    };
}
