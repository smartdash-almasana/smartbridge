import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function resolveRouteStoreId(): Promise<string> {
    const hdrs = await headers();
    const host = hdrs.get("host");
    const proto = process.env.VERCEL ? "https" : "http";
    const baseUrl = host ? `${proto}://${host}` : process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

    let meRes: Response;
    try {
        meRes = await fetch(`${baseUrl}/api/me`, {
            method: "GET",
            cache: "no-store",
            headers: { cookie: hdrs.get("cookie") ?? "" },
        });
    } catch {
        redirect("/enter");
    }

    if (meRes.status !== 200) {
        redirect("/enter");
    }

    const me = await meRes.json();
    const stores = Array.isArray(me?.stores) ? me.stores : [];
    const storeId = stores[0]?.store_id;

    if (!storeId) {
        redirect("/choose-store");
    }

    return storeId;
}
