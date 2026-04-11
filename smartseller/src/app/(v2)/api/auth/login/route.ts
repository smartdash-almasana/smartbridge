import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function sanitizeNext(raw: string | null): string | null {
    if (!raw) return null;
    if (!raw.startsWith("/")) return null;
    if (raw.startsWith("//")) return null;
    return raw;
}

export async function GET(req: NextRequest) {
    const cookieStore = await cookies();
    const pendingCookies: Array<{ name: string; value: string; options: any }> = [];

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: () => cookieStore.getAll(),
                setAll: (cookiesToSet) => {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        pendingCookies.push({ name, value, options })
                    );
                },
            },
        }
    );

    const nextPath = sanitizeNext(req.nextUrl.searchParams.get("next"));

    const isProd = process.env.NODE_ENV === "production";
    const redirectBase = isProd ? "https://smartsellerv2.vercel.app" : "http://localhost:3000";
    const redirectTo = `${redirectBase}/api/auth/callback${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`;

    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo,
        },
    });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const res = NextResponse.redirect(data.url);
    pendingCookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
    return res;
}