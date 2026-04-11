import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { acquireJobLock, releaseJobLock } from "@/lib/engine/smartseller/clinical-locks";
import { computeNextClinicalEvents } from "@/lib/engine/smartseller/clinical-engine";
import { reconcileClinicalEvents } from "@/lib/engine/smartseller/clinical-reconcile";
import { loadLatestSnapshots, getInternalSellerUuid, resetScenarioRegistryCache } from "@/lib/engine/smartseller/snapshots";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const startTime = Date.now();

    // 1. Verificación de Seguridad
    const cronSecret = process.env.CLINICAL_CRON_SECRET;
    if (!cronSecret) {
        console.error(JSON.stringify({ level: "error", msg: "CLINICAL_CRON_SECRET is not defined in environment" }));
        return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    }

    const authHeader = req.headers.get("x-cron-secret");
    if (authHeader !== cronSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Lock Global
    const lockAcquired = await acquireJobLock(
        supabaseAdmin,
        'clinical_cron:global',
        300,
        'vercel-cron'
    );

    if (!lockAcquired) {
        console.info(JSON.stringify({ level: "info", msg: "Cron skipped: already locked" }));
        return NextResponse.json({ ok: true, skipped: true, reason: "locked" });
    }

    console.info(JSON.stringify({ level: "info", msg: "Clinical Cron started" }));
    resetScenarioRegistryCache(); // Ensure fresh registry for this run

    const sellerStats: any[] = [];
    const errors: any[] = [];
    let eventsUpserted = 0;
    let eventsResolved = 0;
    let scoreUpdates = 0;

    try {
        // 3. Determinar Sellers Activos (Discovery)
        const limit = parseInt(process.env.CLINICAL_CRON_LIMIT || "50");
        const { data: activeSellers } = await supabaseAdmin
            .from('order_snapshots')
            .select('user_id')
            .order('user_id', { ascending: true });

        const uniqueMeliIds = Array.from(new Set((activeSellers || []).map(s => s.user_id)))
            .filter(id => id && id !== 'TEST_USER')
            .slice(0, limit);

        for (const meliId of uniqueMeliIds) {
            const sellerStartTime = Date.now();
            try {
                const internalUuid = await getInternalSellerUuid(supabaseAdmin, meliId);
                const snapshots = await loadLatestSnapshots(supabaseAdmin, meliId);

                if (!snapshots) {
                    throw new Error("Could not load snapshots");
                }

                const nextEvents = await computeNextClinicalEvents(snapshots);
                const enrichedEvents = nextEvents.map(e => ({
                    ...e,
                    seller_uuid: internalUuid,
                    evidence: { ...e.evidence, ...snapshots.evidence }
                }));

                const report = await reconcileClinicalEvents(supabaseAdmin, internalUuid, enrichedEvents);

                const duration = Date.now() - sellerStartTime;
                sellerStats.push({
                    seller_uuid: meliId,
                    ms: duration,
                    upserted: enrichedEvents.length,
                    resolved: report.resolvedCount,
                    score: report.score
                });

                eventsUpserted += enrichedEvents.length;
                eventsResolved += report.resolvedCount;
                scoreUpdates++;

                console.info(JSON.stringify({
                    level: "info",
                    msg: `Processed seller ${meliId}`,
                    seller_uuid: meliId,
                    ms: duration,
                    upserted: enrichedEvents.length,
                    score: report.score
                }));

            } catch (err: any) {
                const duration = Date.now() - sellerStartTime;
                const errorMsg = err.message || "Unknown error";
                errors.push({ seller_uuid: meliId, error: errorMsg });
                console.error(JSON.stringify({
                    level: "error",
                    msg: `Failed processing seller ${meliId}`,
                    seller_uuid: meliId,
                    error: errorMsg,
                    stack: err.stack?.split('\n').slice(0, 10).join('\n')
                }));
            }
        }

        const totalMs = Date.now() - startTime;
        console.info(JSON.stringify({
            level: "info",
            msg: "Clinical Cron finished",
            total_ms: totalMs,
            processed: sellerStats.length
        }));

        return NextResponse.json({
            ok: true,
            locked: true,
            processed_sellers: sellerStats.length,
            failed_sellers: errors.length,
            events_upserted: eventsUpserted,
            events_resolved: eventsResolved,
            score_updates: scoreUpdates,
            total_ms: totalMs,
            seller_stats: sellerStats,
            errors: errors
        });

    } catch (error: any) {
        console.error(JSON.stringify({
            level: "error",
            msg: "Global Cron Error",
            error: error.message
        }));
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        await releaseJobLock(supabaseAdmin, 'clinical_cron:global');
    }
}
