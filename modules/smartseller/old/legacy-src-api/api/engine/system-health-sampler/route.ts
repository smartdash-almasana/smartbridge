import { NextRequest, NextResponse } from "next/server";
import { evaluateAlerts, persistSnapshot, upsertAlertsAndNotify } from "@/lib/ops/system-health";
import type { OpsHealthPayload } from "@/lib/ops/system-health";

function normalizeSecret(value: string): string {
    return value.replace(/\r/g, "").replace(/\n/g, "").trim();
}

function validateCronAuth(req: NextRequest): boolean {
    const provided = normalizeSecret(req.headers.get("x-cron-secret") ?? "");
    const expected = normalizeSecret(process.env.CRON_SECRET ?? "");
    return !!expected && provided === expected;
}

export async function GET(req: NextRequest) {
    if (!validateCronAuth(req)) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // Call ops-health internally using the same cron secret
    const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
        "http://localhost:3000";

    let payload: OpsHealthPayload;

    try {
        const res = await fetch(`${baseUrl}/api/engine/ops-health`, {
            method: "GET",
            headers: {
                "x-cron-secret": process.env.CRON_SECRET ?? "",
            },
        });

        if (!res.ok) {
            return NextResponse.json(
                { ok: false, error: "ops_health_fetch_failed", status: res.status },
                { status: 502 }
            );
        }

        payload = (await res.json()) as OpsHealthPayload;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ ok: false, error: "ops_health_unreachable", detail: message }, { status: 502 });
    }

    // 1. Persist snapshot
    await persistSnapshot(payload);

    // 2. Evaluate alert rules
    const evals = evaluateAlerts(payload);

    // 3. Upsert alerts + enqueue transition notifications
    await upsertAlertsAndNotify(evals);

    const firing = evals.filter((e) => e.firing).map((e) => e.alert_key);
    const resolved = evals.filter((e) => !e.firing).map((e) => e.alert_key);

    return NextResponse.json({
        ok: true,
        ts: new Date().toISOString(),
        engine_status: payload.engine_status,
        alerts: { firing, resolved },
    });
}
