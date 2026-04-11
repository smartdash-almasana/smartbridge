import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getClinicalDashboardPayload } from "@/lib/engine/smartseller/clinical-dashboard";
import { loadLatestSnapshots, getInternalSellerUuid } from "@/lib/engine/smartseller/snapshots";
import { computeNextClinicalEvents } from "@/lib/engine/smartseller/clinical-engine";
import { reconcileClinicalEvents } from "@/lib/engine/smartseller/clinical-reconcile";

export const dynamic = "force-dynamic";

/**
 * GET /api/internal/clinical/dashboard
 * Devuelve el payload completo del dashboard clínico para un seller.
 */
export async function GET(req: NextRequest) {
    const internalSecret = process.env.INTERNAL_SECRET;

    if (!internalSecret) {
        console.error(JSON.stringify({ level: "error", msg: "INTERNAL_SECRET not defined" }));
        return NextResponse.json({ ok: false, error: "Configuration Error" }, { status: 500 });
    }

    const secret = req.headers.get("x-internal-secret");
    if (secret !== internalSecret) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const sellerId = searchParams.get("sellerId");
    const refresh = searchParams.get("refresh") === "1";

    if (!sellerId || typeof sellerId !== 'string' || !/^[a-zA-Z0-9-]+$/.test(sellerId)) {
        return NextResponse.json({ ok: false, error: "invalid_sellerId" }, { status: 400 });
    }

    try {
        // 1. Discovery IDs
        const internalUuid = sellerId.includes("-") ? sellerId : await getInternalSellerUuid(supabaseAdmin, sellerId);

        // 2. Refresh opcional (re-ejecutar motor)
        if (refresh) {
            console.info(JSON.stringify({ level: "info", msg: "Dashboard refresh triggered", seller_uuid: sellerId }));

            const meliId = sellerId.includes("-") ? "TODO_LOOKUP" : sellerId;
            const snapshots = await loadLatestSnapshots(supabaseAdmin, meliId === 'TODO_LOOKUP' ? sellerId : meliId);

            if (snapshots) {
                const nextEvents = await computeNextClinicalEvents(snapshots);
                const enrichedEvents = nextEvents.map(e => ({
                    ...e,
                    seller_uuid: internalUuid,
                    evidence: { ...e.evidence, ...snapshots.evidence }
                }));

                await reconcileClinicalEvents(supabaseAdmin, internalUuid, enrichedEvents);
            } else {
                console.warn(JSON.stringify({ level: "warn", msg: "Refresh failed: Snapshots not available", seller_uuid: sellerId }));
            }
        }

        // 3. Obtener Payload final desde DB
        const payload = await getClinicalDashboardPayload(supabaseAdmin, internalUuid);

        console.info(JSON.stringify({
            level: "info",
            msg: "Dashboard payload served",
            seller_uuid: internalUuid,
            refresh,
            active_events: payload.summary.active_count
        }));

        return NextResponse.json(payload);

    } catch (error: any) {
        console.error(JSON.stringify({
            level: "error",
            msg: "Dashboard API Error",
            error: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n')
        }));
        return NextResponse.json({
            ok: false,
            error: "Internal Server Error",
            details: error.message
        }, { status: 500 });
    }
}
