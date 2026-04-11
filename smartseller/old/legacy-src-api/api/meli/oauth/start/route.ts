import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function base64URLEncode(str: Buffer) {
    return str
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

function sha256(buffer: Buffer) {
    return crypto.createHash("sha256").update(buffer).digest();
}

export async function GET() {
    const state = crypto.randomUUID();
    const codeVerifier = base64URLEncode(crypto.randomBytes(32));
    const codeChallenge = base64URLEncode(sha256(Buffer.from(codeVerifier)));

    // Persist state to Supabase
    const { error } = await supabaseAdmin.from("meli_oauth_states").insert({
        state,
        code_verifier: codeVerifier,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 mins
    });

    if (error) {
        console.error("Error saving state:", error);
        return NextResponse.json({ error: "Failed to initialize OAuth" }, { status: 500 });
    }

    const clientId = process.env.MELI_APP_ID!;
    const redirectUri = process.env.MELI_REDIRECT_URI!;

    const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        scope: "read write offline_access",
        prompt: "consent",
    });

    const authUrl = `https://auth.mercadolibre.com.ar/authorization?${params.toString()}`;

    console.log(`START state=${state.substring(0, 8)} expires_at=${new Date(Date.now() + 15 * 60 * 1000).toISOString()}`);

    return NextResponse.redirect(authUrl);
}
