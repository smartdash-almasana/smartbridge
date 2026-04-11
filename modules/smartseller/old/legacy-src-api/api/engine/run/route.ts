import { NextRequest, NextResponse } from "next/server";
import { runClinicalEngineCycle } from "@/lib/engine/engine-runner";

function normalizeSecret(value: string): string {
  return value.replace(/\r/g, "").replace(/\n/g, "").trim();
}

function extractBearerToken(authHeader: string): string {
  const header = authHeader.trim();
  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return header.slice(7);
}

function validateCronAuth(req: NextRequest): { status: 401 | 500; error: string } | null {
  const authHeader = req.headers.get("authorization") ?? "";
  const provided = normalizeSecret(extractBearerToken(authHeader));
  const expected = normalizeSecret(process.env.CRON_SECRET ?? "");

  if (!expected) {
    return { status: 500, error: "CRON_SECRET_NOT_SET" };
  }

  if (provided !== expected) {
    return { status: 401, error: "Unauthorized" };
  }

  return null;
}

function parseBool(value: string | null): boolean {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

async function handleRun(req: NextRequest) {
  const auth = validateCronAuth(req);
  if (auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const limit = parseLimit(req.nextUrl.searchParams.get("limit"));
  const dryRun = parseBool(req.nextUrl.searchParams.get("dryRun"));

  try {
    const summary = await runClinicalEngineCycle({
      sellerLimit: limit,
      dryRun,
    });
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handleRun(req);
}

export async function GET(req: NextRequest) {
  return handleRun(req);
}
