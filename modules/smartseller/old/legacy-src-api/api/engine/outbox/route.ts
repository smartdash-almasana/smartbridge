import { NextRequest, NextResponse } from "next/server";
import { runOutboxWorker } from "@/lib/ops/outbox-worker";

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

    try {
        const result = await runOutboxWorker();
        return NextResponse.json({
            ok: true,
            ts: new Date().toISOString(),
            ...result,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[outbox-route] unhandled error:", message);
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
}
