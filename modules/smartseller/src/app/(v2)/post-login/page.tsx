import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

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

export default async function PostLoginPage() {
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
  if (me.stores.length === 1) {
    redirect(`/dashboard/${me.stores[0].store_id}`);
  }

  if (me.stores.length > 1) {
    redirect("/choose-store");
  }

  return (
    <main style={{ maxWidth: 640, margin: "64px auto", padding: "0 16px" }}>
      <h1>Conecta tu tienda de Mercado Libre</h1>
      <p>No encontramos tiendas vinculadas a tu cuenta.</p>
      <p>
        <a href="/api/auth/meli/start">Conectar Mercado Libre</a>
      </p>
    </main>
  );
}
