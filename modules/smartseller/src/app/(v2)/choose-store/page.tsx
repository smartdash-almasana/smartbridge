import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

interface StoreSlim {
  store_id: string;
  display_name: string | null;
  provider_key: string;
}

interface MeResponse {
  user_id: string;
  stores: StoreSlim[];
  redirect: string;
}

function getBaseUrlFromHeaders(hdrs: Headers): string {
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export default async function ChooseStorePage() {
  const hdrs = await headers();
  const cookieHeader = (await cookies()).toString();
  const baseUrl = getBaseUrlFromHeaders(hdrs);

  const meRes = await fetch(`${baseUrl}/api/me`, {
    method: "GET",
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });

  if (!meRes.ok) {
    redirect("/enter");
  }

  const me = (await meRes.json()) as MeResponse;
  const stores = me.stores ?? [];

  if (stores.length === 0) {
    redirect("/onboarding");
  }
  if (stores.length === 1) {
    redirect(`/dashboard/${stores[0].store_id}`);
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Elegi una store</h1>
      <ul className="mt-4 space-y-3">
        {stores.map((store) => (
          <li key={store.store_id} className="rounded border p-4">
            <Link href={`/dashboard/${store.store_id}`} className="text-primary hover:underline">
              {store.display_name ?? `Store ${store.store_id.slice(0, 8)}`}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
