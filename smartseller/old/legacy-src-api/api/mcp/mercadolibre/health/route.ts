import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId =
    req.nextUrl.searchParams.get("userId") ??
    req.nextUrl.searchParams.get("user_id") ??
    req.headers.get("x-meli-user-id");

  if (!userId) {
    return new Response(JSON.stringify({
      error: "missing_context_user_id",
      message: "Provide userId/user_id query param or x-meli-user-id header."
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const userIdValue = userId.match(/^\d+$/)?.[0] ?? null;

  if (userIdValue === null) {
    return new Response(JSON.stringify({
      error: "invalid_context_user_id",
      message: "userId must be digits only."
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // CHECK 1: Runtime Envs
  const envCheck = {
    has_SUPABASE_URL: !!process.env.SUPABASE_URL,
    has_NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    has_SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    has_MELI_CLIENT_ID: !!process.env.MELI_CLIENT_ID,
    has_MELI_APP_ID: !!process.env.MELI_APP_ID,
    has_MELI_CLIENT_SECRET: !!process.env.MELI_CLIENT_SECRET,
    has_MELI_REDIRECT_URI: !!process.env.MELI_REDIRECT_URI
  };

  // CHECK 2: Supabase Connectivity
  let supabaseInitOk = false;
  let supabaseSelectOk = false;
  let supabaseError: string | null = null;
  let tokenStatus = "unknown";
  let hasRefreshToken = false;

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseKey) {
      const sb = createClient(supabaseUrl, supabaseKey);
      supabaseInitOk = true;

      let data: any[] | null = null;
      let error: { message: string } | null = null;

      const result = await sb
        .from("meli_oauth_tokens")
        .select("*")
        .eq("user_id", userIdValue)
        .eq("status", "active");
      data = result.data;
      error = result.error;

      if (error) {
        supabaseError = error.message.substring(0, 160);
      } else {
        supabaseSelectOk = true;
        if (data && data.length > 0) {
          tokenStatus = "present";
          if (data[0].refresh_token) {
            hasRefreshToken = true;
          }
        } else {
          tokenStatus = "missing_in_db";
        }
      }
    } else {
      supabaseError = "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY";
    }
  } catch (e: any) {
    supabaseError = (e.message || String(e)).substring(0, 160);
  }

  // Construct final response
  const responseData = {
    checks: {
      env: envCheck,
      context: {
        userIdProvided: true,
        userIdValue: userIdValue
      },
      supabase: {
        init: supabaseInitOk,
        select: supabaseSelectOk,
        error: supabaseError
      },
      token: tokenStatus,
      hasRefreshToken
    },
    timestamp: new Date().toISOString()
  };

  return new Response(JSON.stringify(responseData, null, 2), {
    status: supabaseSelectOk ? 200 : 503,
    headers: { "Content-Type": "application/json" }
  });
}
