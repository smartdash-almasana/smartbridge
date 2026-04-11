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

    const nextPath =
        sanitizeNext(req.nextUrl.searchParams.get("next")) ?? "/post-login";
    const response = NextResponse.redirect(new URL(nextPath, req.url));

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: () => cookieStore.getAll(),
                setAll: (cookiesToSet) => {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        response.cookies.set(name, value, options);
                    });
                },
            },
        }
    );

    const code = req.nextUrl.searchParams.get("code");
    if (!code) {
        return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return response;
}