import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

async function signOutAndRedirect(req: NextRequest) {
    const cookieStore = await cookies();
    const response = NextResponse.redirect(new URL("/enter", req.url), 303);

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

    await supabase.auth.signOut();
    return response;
}

export async function POST(req: NextRequest) {
    return signOutAndRedirect(req);
}
