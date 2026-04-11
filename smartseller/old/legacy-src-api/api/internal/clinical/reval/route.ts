import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { computeNextClinicalEvents } from "@/lib/engine/smartseller/clinical-engine";
import { reconcileClinicalEvents } from "@/lib/engine/smartseller/clinical-reconcile";
import { loadLatestSnapshots, getInternalSellerUuid } from "@/lib/engine/smartseller/snapshots";

/**
 * Endpoint interno para re-evaluación rápida (On-Demand o Webhook)
 */
export async function POST(req: NextRequest) {
    // 1. Verificación de Seguridad
    const internalSecret = process.env.INTERNAL_SECRET;
    if (!internalSecret) {
        console.error(JSON.stringify({ level: "error", msg: "INTERNAL_SECRET is not defined" }));
        return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    }

    const secret = req.headers.get("x-internal-secret");
    if (secret !== internalSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { sellerId } = body; // Puede ser UUID o ML User ID (string)

        // Validación básica: solo alfanuméricos y guiones
        if (!sellerId || typeof sellerId !== 'string' || !/^[a-zA-Z0-9-]+$/.test(sellerId)) {
            return NextResponse.json({ ok: false, error: "invalid_sellerId" }, { status: 400 });
        }

        console.info(JSON.stringify({ level: "info", msg: `Individual reval started for ${sellerId}`, seller_uuid: sellerId }));

        // discovery de IDs
        const internalUuid = sellerId.includes('-') ? sellerId : await getInternalSellerUuid(supabaseAdmin, sellerId);
        const meliId = sellerId.includes('-') ? 'TODO_LOOKUP' : sellerId;

        // 1. Cargar contexto (Snapshot real)
        const snapshots = await loadLatestSnapshots(supabaseAdmin, meliId === 'TODO_LOOKUP' ? sellerId : meliId);

        if (!snapshots) {
            console.warn(JSON.stringify({ level: "warn", msg: `Could not load snapshots for ${sellerId}`, seller_uuid: sellerId }));
            return NextResponse.json({ error: "Could not load snapshots for seller" }, { status: 404 });
        }

        // 2. Ejecutar motor
        const nextEvents = await computeNextClinicalEvents(snapshots);

        // Inyectar UUID y evidencia
        const enrichedEvents = nextEvents.map(e => ({
            ...e,
            seller_uuid: internalUuid,
            evidence: { ...e.evidence, ...snapshots.evidence }
        }));

        // 3. Reconciliar (Upsert + Resolve)
        const report = await reconcileClinicalEvents(supabaseAdmin, internalUuid, enrichedEvents);

        console.info(JSON.stringify({
            level: "info",
            msg: `Individual reval finished for ${sellerId}`,
            seller_uuid: sellerId,
            score: report.score
        }));

        return NextResponse.json({
            ok: true,
            sellerId: internalUuid,
            activeEventsCount: report.activeCount,
            score: report.score,
            band: report.band,
            drivers: report.drivers
        });

    } catch (error: any) {
        console.error(JSON.stringify({
            level: "error",
            msg: "Clinical Reval Error",
            error: error.message,
            stack: error.stack?.split('\n').slice(0, 10).join('\n')
        }));
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
