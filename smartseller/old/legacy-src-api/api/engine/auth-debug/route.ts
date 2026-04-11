import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

function normalizeSecret(value: string): string {
  return value.replace(/\r/g, "").replace(/\n/g, "").trim();
}

function extractBearerToken(authHeader: string): string {
  const match = authHeader.match(/^\s*Bearer\s+(.+?)\s*$/i);
  return match?.[1] ?? "";
}

function hash8(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export async function GET(req: NextRequest) {
  const rawCronSecret = process.env.CRON_SECRET ?? "";
  const normalizedCronSecret = normalizeSecret(rawCronSecret);
  const authHeader = req.headers.get("authorization") ?? "";
  const rawProvidedToken = extractBearerToken(authHeader);
  const normalizedProvidedToken = normalizeSecret(rawProvidedToken);

  if (!normalizedCronSecret) {
    return NextResponse.json({ error: "CRON_SECRET_NOT_SET" }, { status: 500 });
  }

  if (normalizedProvidedToken !== normalizedCronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    has_cron_secret: normalizedCronSecret.length > 0,
    cron_secret_len: normalizedCronSecret.length,
    cron_secret_has_newlines: rawCronSecret.includes("\r") || rawCronSecret.includes("\n"),
    auth_header_present: authHeader.length > 0,
    provided_len: normalizedProvidedToken.length,
    match: normalizedProvidedToken === normalizedCronSecret,
    expected_hash_prefix: hash8(normalizedCronSecret),
    provided_hash_prefix: hash8(normalizedProvidedToken),
    expected_has_newlines: rawCronSecret.includes("\n"),
    expected_has_carriage_return: rawCronSecret.includes("\r"),
    provided_has_newlines: rawProvidedToken.includes("\n"),
    provided_has_carriage_return: rawProvidedToken.includes("\r"),
  });
}
