import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!code || !state) {
        return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
    }

    // Retrieve code_verifier from Supabase
    const { data: stateData, error: stateError } = await supabaseAdmin
        .from("meli_oauth_states")
        .select("code_verifier, expires_at, used_at")
        .eq("state", state)
        .single();

    if (stateError || !stateData) {
        console.error("State verification failed:", stateError);
        return NextResponse.json({ error: "Invalid state or session expired (db)" }, { status: 400 });
    }

    const { code_verifier, expires_at, used_at } = stateData;

    if (used_at) {
        return NextResponse.json({ error: "State already used" }, { status: 400 });
    }

    if (new Date(expires_at) < new Date()) {
        return NextResponse.json({ error: "State expired" }, { status: 400 });
    }

    // Mark state as used
    await supabaseAdmin
        .from("meli_oauth_states")
        .update({ used_at: new Date().toISOString() })
        .eq("state", state);

    // Exchange code for token
    const tokenResponse = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: process.env.MELI_APP_ID!,
            client_secret: process.env.MELI_CLIENT_SECRET!,
            code,
            redirect_uri: process.env.MELI_REDIRECT_URI!,
            code_verifier,
        }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
        console.error("Token exchange failed:", tokenData);
        return NextResponse.json({ error: "Failed to exchange token", details: tokenData }, { status: 400 });
    }

    // Save tokens to Supabase
    const { access_token, refresh_token, expires_in, user_id, scope, token_type } = tokenData;

    const { error: saveError } = await supabaseAdmin
        .from("meli_oauth_tokens")
        .upsert({
            user_id,
            access_token,
            refresh_token,
            expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
            updated_at: new Date().toISOString(), // Ensure updated_at is refreshed
            scope,
            token_type,
            raw: tokenData,
        }, { onConflict: "user_id" });

    if (saveError) {
        console.error("Failed to save tokens:", saveError);
        return NextResponse.json({ error: "Failed to save tokens" }, { status: 500 });
    }

    return NextResponse.redirect(new URL("/dashboard", process.env.NEXT_PUBLIC_APP_URL || "https://mismartdash.vercel.app"));
}
