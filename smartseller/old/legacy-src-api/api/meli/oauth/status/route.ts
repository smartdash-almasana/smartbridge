import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret) {
    const provided = req.headers.get("x-admin-secret");
    if (!provided || provided !== adminSecret) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
  }

  const { data, error } = await supabaseAdmin
    .from("meli_oauth_tokens")
    .select("expires_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "DB_READ_ERROR" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ has_token: false, reason: "NO_TOKEN_FOUND" }, { status: 404 });
  }

  const nowMs = Date.now();
  const expiresMs = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  const secondsLeft = Math.floor((expiresMs - nowMs) / 1000);
  const isValid = secondsLeft > 60;

  return NextResponse.json(
    {
      has_token: true,
      is_valid: isValid,
      expires_at: data.expires_at,
      seconds_left: secondsLeft,
      updated_at: data.updated_at,
      needs_reauth: !isValid,
    },
    { status: 200 }
  );
}

