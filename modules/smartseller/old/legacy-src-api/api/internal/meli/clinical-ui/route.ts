import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { getValidMeliAccessToken } from '@/lib/meli-auth';
import { POST as runDiagnostics } from '../diagnostics/route';

const ORDER_LIMIT = 300;
const WEBHOOK_LIMIT = 500;
const TIMELINE_LIMIT = 200;
const FV_ORDER_LIMIT = 50;
const FV_ORDER_OFFSET_CAP = 500;
const FV_WINDOW_DAYS = 365;

const TIMELINE_TYPE_ORDER: Record<string, number> = {
    ORDER: 0,
    CLAIM: 1,
    MESSAGE: 2,
    QUESTION: 3
};

function stableTimelineId(entry: any): string {
    const ids = entry?.ids || {};
    return String(
        ids.order_id ??
        ids.claim_id ??
        ids.message_id ??
        ids.question_id ??
        ids.pack_id ??
        ''
    );
}

function normalizeBiomarkerKpis(biomarker: any, zeroShape: Record<string, number> | null) {
    const availability = biomarker.availability || 'NOT_AVAILABLE';
    biomarker.availability = availability;

    if (!biomarker.reason || !String(biomarker.reason).trim()) {
        biomarker.reason = 'Unspecified';
    }

    if (availability === 'NOT_AVAILABLE') {
        biomarker.kpis_30d = null;
        return;
    }

    if (availability === 'ZERO_REAL') {
        biomarker.kpis_30d = zeroShape ? { ...zeroShape } : {};
        return;
    }

    if (biomarker.kpis_30d == null) {
        biomarker.kpis_30d = zeroShape ? { ...zeroShape } : {};
    }
}

function toIsoMonth(dateLike: unknown): string | null {
    if (typeof dateLike !== 'string') return null;
    const ms = Date.parse(dateLike);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString().slice(0, 7);
}

function buildLast12Months() {
    const out: Array<{ month: string; orders_total: number; orders_cancelled: number; questions_total: number; shipments_total: number }> = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        out.push({
            month: d.toISOString().slice(0, 7),
            orders_total: 0,
            orders_cancelled: 0,
            questions_total: 0,
            shipments_total: 0
        });
    }
    return out;
}

async function fetchFvPayload(externalId: string) {
    let accessToken = '';
    try {
        accessToken = await getValidMeliAccessToken(externalId);
    } catch {
        return {
            enabled: false,
            rows: [] as Array<{ order_id: string; created_at: string | null; status: string | null; raw_payload: any }>,
            sales_count: 0,
            questions_count: 0,
            shipments_count: 0,
            history_12m: { months: buildLast12Months() },
            fv_evidence: {
                generated_at: new Date().toISOString(),
                endpoints: [] as Array<{ name: string; url: string; status: number; latency_ms: number }>,
                totals: { sales_count: 0, questions_count: 0, shipments_count: 0 },
                orders_date_range: { min: null as string | null, max: null as string | null },
                debug: { fetched_orders: 0, pages: 0, invalid_dates: 0 }
            }
        };
    }

    const headers = { Authorization: `Bearer ${accessToken}` };
    const threshold12m = Date.now() - FV_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const endpoints: Array<{ name: string; url: string; status: number; latency_ms: number }> = [];
    const rows: Array<{ order_id: string; created_at: string | null; status: string | null; raw_payload: any }> = [];
    const historyMonths = buildLast12Months();
    const historyByMonth = new Map(historyMonths.map((m) => [m.month, m]));
    let salesCount = 0;
    let questionsCount = 0;
    let shipmentsCount = 0;
    let invalidDates = 0;
    let pages = 0;
    let fetchedOrders = 0;
    let minDate: string | null = null;
    let maxDate: string | null = null;

    for (let offset = 0; offset <= FV_ORDER_OFFSET_CAP; offset += FV_ORDER_LIMIT) {
        const url = `https://api.mercadolibre.com/orders/search?seller=${externalId}&sort=date_desc&limit=${FV_ORDER_LIMIT}&offset=${offset}`;
        const started = Date.now();
        const ordersRes = await fetch(url, { method: 'GET', headers });
        endpoints.push({ name: `orders_page_${pages + 1}`, url, status: ordersRes.status, latency_ms: Date.now() - started });
        pages += 1;
        if (!ordersRes.ok) break;

        const ordersPayload = await ordersRes.json();
        const results = Array.isArray(ordersPayload?.results) ? ordersPayload.results : [];
        if (offset === 0) {
            salesCount = typeof ordersPayload?.paging?.total === 'number' ? ordersPayload.paging.total : results.length;
        }
        if (results.length === 0) break;

        fetchedOrders += results.length;
        let oldestTsInPage = Number.POSITIVE_INFINITY;

        for (const o of results) {
            const createdAt = typeof o?.date_created === 'string'
                ? o.date_created
                : typeof o?.date_closed === 'string'
                    ? o.date_closed
                    : null;
            rows.push({
                order_id: String(o?.id ?? ''),
                created_at: createdAt,
                status: o?.status ?? null,
                raw_payload: o
            });

            if (!createdAt) {
                invalidDates += 1;
                continue;
            }
            const ts = Date.parse(createdAt);
            if (!Number.isFinite(ts)) {
                invalidDates += 1;
                continue;
            }
            oldestTsInPage = Math.min(oldestTsInPage, ts);
            if (ts < threshold12m) continue;

            if (!minDate || ts < Date.parse(minDate)) minDate = createdAt;
            if (!maxDate || ts > Date.parse(maxDate)) maxDate = createdAt;

            const mk = toIsoMonth(createdAt);
            if (!mk) continue;
            const bucket = historyByMonth.get(mk);
            if (!bucket) continue;
            bucket.orders_total += 1;
            if (String(o?.status || '').toLowerCase() === 'cancelled') bucket.orders_cancelled += 1;
            if (o?.shipping?.id) {
                bucket.shipments_total += 1;
                shipmentsCount += 1;
            }
        }

        if (Number.isFinite(oldestTsInPage) && oldestTsInPage < threshold12m) break;
    }

    const questionsUrl = `https://api.mercadolibre.com/questions/search?seller_id=${externalId}&api_version=4&limit=50`;
    const qStarted = Date.now();
    const questionsRes = await fetch(questionsUrl, { method: 'GET', headers });
    endpoints.push({ name: 'questions', url: questionsUrl, status: questionsRes.status, latency_ms: Date.now() - qStarted });
    if (questionsRes.ok) {
        const questionsPayload = await questionsRes.json();
        const questions = Array.isArray(questionsPayload?.questions) ? questionsPayload.questions : [];
        questionsCount = typeof questionsPayload?.total === 'number' ? questionsPayload.total : questions.length;
        for (const q of questions) {
            const mk = toIsoMonth(q?.date_created);
            if (!mk) continue;
            const bucket = historyByMonth.get(mk);
            if (!bucket) continue;
            bucket.questions_total += 1;
        }
    }

    return {
        enabled: true,
        rows,
        sales_count: salesCount,
        questions_count: questionsCount,
        shipments_count: shipmentsCount,
        history_12m: { months: historyMonths },
        fv_evidence: {
            generated_at: new Date().toISOString(),
            endpoints,
            totals: {
                sales_count: salesCount,
                questions_count: questionsCount,
                shipments_count: shipmentsCount,
            },
            orders_date_range: { min: minDate, max: maxDate },
            debug: {
                fetched_orders: fetchedOrders,
                pages,
                invalid_dates: invalidDates
            }
        }
    };
}

export async function POST(req: Request) {
    try {
        // 1. Authorization
        const internalKey = req.headers.get('x-internal-key');
        if (!internalKey || internalKey !== process.env.INTERNAL_DIAGNOSTICS_KEY) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let body;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const { seller_uuid, external_id, months = 12 } = body;

        if (!seller_uuid || !external_id) {
            return NextResponse.json({ error: 'Missing seller_uuid or external_id' }, { status: 400 });
        }

        // 2. Call internal diagnostics (reusing logic cleanly)
        const diagReq = new Request('http://localhost/api/internal/meli/diagnostics', {
            method: 'POST',
            headers: {
                'x-internal-key': internalKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ seller_uuid, external_id })
        });

        const diagRes = await runDiagnostics(diagReq);
        const diagnostics = await diagRes.json();

        const fallbackEnabled = process.env.CLINICAL_UI_FV_FALLBACK === '1';
        const fvData = fallbackEnabled
            ? await fetchFvPayload(String(external_id))
            : {
                enabled: false,
                rows: [] as Array<{ order_id: string; created_at: string | null; status: string | null; raw_payload: any }>,
                sales_count: 0,
                questions_count: 0,
                shipments_count: 0,
                history_12m: { months: buildLast12Months() },
                fv_evidence: {
                    generated_at: new Date().toISOString(),
                    endpoints: [] as Array<{ name: string; url: string; status: number; latency_ms: number }>,
                    totals: { sales_count: 0, questions_count: 0, shipments_count: 0 },
                    orders_date_range: { min: null as string | null, max: null as string | null },
                    debug: { fetched_orders: 0, pages: 0, invalid_dates: 0 }
                }
            };

        const { data: sellerInfo } = await supabaseAdmin
            .from('sellers')
            .select('display_name, market, seller_uuid, external_id')
            .eq('external_id', external_id)
            .maybeSingle();
        const business = {
            display_name: sellerInfo?.display_name ?? `Seller ${external_id}`,
            market: sellerInfo?.market ?? null,
            external_id: String(external_id),
            seller_uuid: sellerInfo?.seller_uuid ?? String(seller_uuid),
        };

        // 3. Process DB records for timeline & snapshots
        // orders (fallback to direct ML if enabled and DB source is unavailable/empty)
        const ordersQuery = await supabaseAdmin
            .from('order_snapshots')
            .select('order_id, created_at, status, raw_payload')
            .eq('user_id', external_id)
            .order('created_at', { ascending: false })
            .limit(ORDER_LIMIT);

        let orderRows = ordersQuery.data ?? null;
        let ordersSource: 'db_order_snapshots' | 'fv_meli' = 'db_order_snapshots';
        const ordersTableUnavailable = Boolean(
            ordersQuery.error?.message &&
            ordersQuery.error.message.toLowerCase().includes('order_snapshots')
        );
        const hasNoOrderRows = !orderRows || orderRows.length === 0;

        if (fallbackEnabled && (ordersTableUnavailable || hasNoOrderRows)) {
            const fvRows = fvData.rows;
            if (fvRows.length > 0) {
                orderRows = fvRows;
                ordersSource = 'fv_meli';
            }
        }

        // questions, claims, messages from webhook events
        const { data: qEvents } = await supabaseAdmin
            .from('webhook_events')
            .select('resource, received_at, raw_payload')
            .eq('user_id', external_id)
            .in('topic', ['questions', 'claims', 'messages'])
            .order('received_at', { ascending: false })
            .limit(WEBHOOK_LIMIT);

        // 4. Build unified timeline
        const timeline: any[] = [];

        if (orderRows) {
            for (const o of orderRows) {
                timeline.push({
                    type: 'ORDER',
                    occurred_at: o.created_at,
                    status: o.status,
                    ids: { order_id: o.order_id }
                });
            }
        }

        if (qEvents) {
            for (const eq of qEvents) {
                let type = 'UNKNOWN';
                let status = 'unknown';
                let ids: any = {};
                let date = eq.received_at;

                const p = eq.raw_payload || {};

                if (eq.resource?.includes('/questions/')) {
                    type = 'QUESTION';
                    status = p.status ? p.status.toLowerCase() : 'unknown';
                    ids = { question_id: p.id || eq.resource.split('/').pop() };
                    date = p.date_created || eq.received_at;
                } else if (eq.resource?.includes('/claims/')) {
                    type = 'CLAIM';
                    status = p.status ? p.status.toLowerCase() : 'unknown';
                    ids = { claim_id: p.id || eq.resource.split('/').pop() };
                    date = p.date_created || eq.received_at;
                } else if (eq.resource?.includes('/messages/') && eq.resource?.includes('/packs/')) {
                    type = 'MESSAGE';
                    status = p.status ? p.status.toLowerCase() : 'unknown';
                    const packMatch = eq.resource.match(/packs\/([^\/]+)/);
                    if (packMatch) ids.pack_id = packMatch[1];
                    ids.message_id = p.id;
                    date = p.date_available || eq.received_at;
                }

                if (type !== 'UNKNOWN') {
                    timeline.push({ type, occurred_at: date, status, ids });
                }
            }
        }

        timeline.sort((a, b) => {
            const byDate = new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
            if (byDate !== 0) return byDate;
            const byType = (TIMELINE_TYPE_ORDER[a.type] ?? 99) - (TIMELINE_TYPE_ORDER[b.type] ?? 99);
            if (byType !== 0) return byType;
            return stableTimelineId(a).localeCompare(stableTimelineId(b));
        });
        const timelineWasCapped = timeline.length > TIMELINE_LIMIT;
        const finalTimeline = timeline.slice(0, TIMELINE_LIMIT);

        // 5. Build Monthly Snapshots (on-the-fly V1)
        const monthlyData: Record<string, any> = {};
        const now = new Date();
        for (let i = 0; i < months; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthStr = d.toISOString().slice(0, 7);
            monthlyData[monthStr] = {
                month: monthStr,
                orders: { total: 0, cancelled: 0 },
                questions: { total: 0 },
                claims: { opened: 0 }
            };
        }

        if (orderRows) {
            for (const o of orderRows) {
                const m = o.created_at.slice(0, 7);
                if (monthlyData[m]) {
                    monthlyData[m].orders.total++;
                    if (o.status === 'cancelled') monthlyData[m].orders.cancelled++;
                }
            }
        }
        if (qEvents) {
            for (const eq of qEvents) {
                const eventDate = eq.received_at || new Date().toISOString();
                const m = eventDate.slice(0, 7);
                if (monthlyData[m]) {
                    if (eq.resource?.includes('/questions/')) monthlyData[m].questions.total++;
                    if (eq.resource?.includes('/claims/') && (eq.raw_payload as any)?.status === 'opened') monthlyData[m].claims.opened++;
                }
            }
        }
        const monthly_snapshots = Object.values(monthlyData).sort((a: any, b: any) => a.month.localeCompare(b.month)); // ascending

        // 6. Clinical State & Pulses
        let last_successful_sale_at = null;
        let last_order_at = null;

        if (orderRows && orderRows.length > 0) {
            last_order_at = orderRows[0].created_at;
            const lastSuccess = orderRows.find(o => o.status === 'paid');
            if (lastSuccess) last_successful_sale_at = lastSuccess.created_at;
        }

        let clinical_state = 'Activo';
        if (diagnostics.error === 'missing_token') {
            clinical_state = 'Inhabilitado';
        } else if (last_successful_sale_at) {
            const msSinceLastSale = Date.now() - new Date(last_successful_sale_at).getTime();
            const daysSince = msSinceLastSale / (1000 * 3600 * 24);
            if (daysSince > 365) clinical_state = 'Hibernación profunda';
            else if (daysSince > 180) clinical_state = 'Apagado comercial';
            else if (daysSince > 90) clinical_state = 'Hipometabolismo';
        } else if (last_order_at) {
            const msSinceLastOrder = Date.now() - new Date(last_order_at).getTime();
            const daysSince = msSinceLastOrder / (1000 * 3600 * 24);
            if (daysSince > 180) clinical_state = 'Apagado comercial';
            else if (daysSince > 90) clinical_state = 'Hipometabolismo';
        } else {
            clinical_state = 'Apagado comercial'; // fallback
        }

        // 7. Biomarkers Mapped from Diagnostics
        const biomarkers: Record<string, any> = {};
        const diagResults = diagnostics.results || [];

        const getBiomarker = (mod: string) => {
            const found = diagResults.find((r: any) => r.module === mod);
            if (!found) return { availability: 'NOT_AVAILABLE', reason: 'Unmeasured', last_event_at: null, kpis_30d: {} };
            return {
                availability: found.availability || found.outcome,
                reason: found.note || found.outcome,
                last_event_at: null,
                kpis_30d: {}
            };
        };

        const dOrders = getBiomarker('orders');
        const dShipments = getBiomarker('shipments');
        const dQuestions = getBiomarker('questions');
        const dClaims = getBiomarker('claims');
        const dMessages = getBiomarker('messages');
        const dItems = getBiomarker('items');

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).getTime();
        let oCount = 0, oCancelled = 0, qCount = 0, qUnanswered = 0, cOpened = 0;

        for (const e of finalTimeline) {
            if (e.type === 'ORDER') {
                if (!dOrders.last_event_at) dOrders.last_event_at = e.occurred_at;
                if (new Date(e.occurred_at).getTime() >= thirtyDaysAgo) {
                    oCount++;
                    if (e.status === 'cancelled') oCancelled++;
                }
            }
            if (e.type === 'QUESTION') {
                if (!dQuestions.last_event_at) dQuestions.last_event_at = e.occurred_at;
                if (new Date(e.occurred_at).getTime() >= thirtyDaysAgo) {
                    qCount++;
                    if (e.status === 'unanswered' || e.status === 'under_review') qUnanswered++;
                }
            }
            if (e.type === 'CLAIM') {
                if (!dClaims.last_event_at) dClaims.last_event_at = e.occurred_at;
                if (new Date(e.occurred_at).getTime() >= thirtyDaysAgo) {
                    if (e.status === 'opened') cOpened++;
                }
            }
            if (e.type === 'MESSAGE') {
                if (!dMessages.last_event_at) dMessages.last_event_at = e.occurred_at;
            }
        }

        dOrders.kpis_30d = { count: oCount, cancelled: oCancelled };
        dQuestions.kpis_30d = { count: qCount, unanswered: qUnanswered };
        dClaims.kpis_30d = { opened: cOpened };

        // Populate baseline KPI shapes; final null/zero semantics normalized below.
        dShipments.kpis_30d = { late: 0 }; // Requires derivation beyond baseline
        dMessages.kpis_30d = { count: 0 };
        dItems.kpis_30d = { count: 0 };

        normalizeBiomarkerKpis(dOrders, { count: 0, cancelled: 0 });
        normalizeBiomarkerKpis(dShipments, { late: 0 });
        normalizeBiomarkerKpis(dQuestions, { count: 0, unanswered: 0 });
        normalizeBiomarkerKpis(dClaims, { opened: 0 });
        normalizeBiomarkerKpis(dMessages, { count: 0 });
        normalizeBiomarkerKpis(dItems, { count: 0 });

        biomarkers.orders = dOrders;
        biomarkers.shipments = dShipments;
        biomarkers.questions = dQuestions;
        biomarkers.claims = dClaims;
        biomarkers.messages = dMessages;
        biomarkers.items = dItems;

        // Sync availability to monthly buckets
        for (const m of monthly_snapshots) {
            m.orders.availability = dOrders.availability;
            m.questions.availability = dQuestions.availability;
            m.claims.availability = dClaims.availability;
        }

        const orderRowsSafe = orderRows || [];
        const qEventsSafe = qEvents || [];
        const snapshotMonths = monthly_snapshots.map((m: any) => m.month).sort();
        const timelineDates = finalTimeline
            .map((e: any) => e.occurred_at)
            .filter((d: any) => !!d)
            .sort((a: string, b: string) => new Date(a).getTime() - new Date(b).getTime());

        const snapshotsCappedByOrders = orderRowsSafe.length >= ORDER_LIMIT;
        const snapshotsCappedByWebhooks = qEventsSafe.length >= WEBHOOK_LIMIT;
        const snapshotsCapped = snapshotsCappedByOrders || snapshotsCappedByWebhooks;
        const snapshotsCapReason = snapshotsCappedByOrders
            ? 'LIMIT_ORDERS_300'
            : snapshotsCappedByWebhooks
                ? 'LIMIT_WEBHOOKS_500'
                : 'NONE';

        const coverage = {
            requested_months: Number(months) || 12,
            snapshots: {
                from: snapshotMonths[0] ? `${snapshotMonths[0]}-01` : null,
                to: snapshotMonths.length > 0 ? `${snapshotMonths[snapshotMonths.length - 1]}-01` : null,
                capped: snapshotsCapped,
                cap_reason: snapshotsCapReason
            },
            timeline: {
                from: timelineDates[0] || null,
                to: timelineDates.length > 0 ? timelineDates[timelineDates.length - 1] : null,
                capped: timelineWasCapped,
                cap_reason: timelineWasCapped ? 'LIMIT_EVENTS_200' : 'NONE'
            }
        };

        const lastExternalCandidates = [
            dQuestions.last_event_at,
            dClaims.last_event_at,
            dMessages.last_event_at
        ].filter(Boolean) as string[];
        lastExternalCandidates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
        const clinical_state_evidence = {
            last_successful_sale_at,
            last_order_at,
            last_external_activity_at: lastExternalCandidates[0] || null,
            hibernation_window_days: 60,
            commercial_off_window_days: 30
        };

        return NextResponse.json({
            ok: true,
            business,
            clinical_state,
            clinical_source: {
                orders: fallbackEnabled ? 'fv_meli' : ordersSource,
                questions: fallbackEnabled ? 'fv_meli' : 'db_webhook_events',
                shipments: fallbackEnabled ? 'fv_meli' : ordersSource
            },
            clinical_state_evidence,
            pulses: {
                commercial: last_successful_sale_at,
                transactional: last_order_at
            },
            biomarkers: {
                ...biomarkers,
                demo: {
                    sales_count: fvData.sales_count,
                    questions_count: fvData.questions_count,
                    shipments_count: fvData.shipments_count
                }
            },
            demo_indicators: {
                has_sales: fvData.sales_count > 0,
                has_questions: fvData.questions_count > 0,
                has_shipments: fvData.shipments_count > 0
            },
            history_12m: fvData.history_12m,
            fv_evidence: fvData.fv_evidence,
            coverage,
            monthly_snapshots,
            timeline: finalTimeline
        });

    } catch (error: any) {
        console.error('[CLINICAL_UI] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error', msg: error.message }, { status: 500 });
    }
}
