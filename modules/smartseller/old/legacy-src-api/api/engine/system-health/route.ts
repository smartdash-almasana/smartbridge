import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { INCIDENT_CATALOG } from "@/lib/ops/system-health";

function normalizeSecret(value: string): string {
    return value.replace(/\r/g, "").replace(/\n/g, "").trim();
}

function validateCronAuth(req: NextRequest): boolean {
    // Reusing the same auth model: requires CRON_SECRET header
    const provided = normalizeSecret(req.headers.get("x-cron-secret") ?? "");
    const expected = normalizeSecret(process.env.CRON_SECRET ?? "");
    return !!expected && provided === expected;
}

export async function GET(req: NextRequest) {
    if (!validateCronAuth(req)) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    try {
        // 1. Fetch live engine status from ops-health
        // We need to resolve the base URL dynamically or fallback to localhost
        const baseUrl =
            process.env.NEXT_PUBLIC_APP_URL ||
            (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
            "http://localhost:3000";

        const healthRes = await fetch(`${baseUrl}/api/engine/ops-health`, {
            headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
            cache: "no-store",
        });

        let engineStatus = "unknown";
        if (healthRes.ok) {
            const healthData = await healthRes.json();
            engineStatus = healthData.engine_status ?? "unknown";
        } else {
            console.error("[system-health-route] ops-health fetch failed:", healthRes.status);
            engineStatus = "unreachable";
        }

        // 2. Fetch active incidents (firing alerts) from DB
        const { data: alerts, error } = await supabaseAdmin
            .from("system_alerts")
            .select("alert_key, severity, state, first_seen_at, evidence, fingerprint")
            .eq("state", "firing");

        if (error) {
            console.error("[system-health-route] db error:", error.message);
            return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
        }

        const nowTs = Date.now();
        const activeIncidents = (alerts || []).map((alert) => {
            const startTs = new Date(alert.first_seen_at).getTime();
            const durationSeconds = Math.max(0, Math.floor((nowTs - startTs) / 1000));

            // Enrich from static catalog
            const catalogEntry = INCIDENT_CATALOG[alert.alert_key] ?? {
                message: `Unknown alert type: ${alert.alert_key}`,
                next_steps: ["Check runbook for manual diagnosis."]
            };

            return {
                alert_key: alert.alert_key,
                severity: alert.severity,
                since: alert.first_seen_at,
                duration_seconds: durationSeconds,
                message: catalogEntry.message,
                evidence: alert.evidence,
                next_steps: catalogEntry.next_steps
            };
        });

        return NextResponse.json({
            ok: true,
            ts: new Date().toISOString(),
            engine_status: engineStatus,
            active_incidents: activeIncidents,
        });

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
}
