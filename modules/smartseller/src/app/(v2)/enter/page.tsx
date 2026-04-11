import { redirect } from "next/navigation";
import { getPendingInstallation } from "@v2/lib/meli/installations";

type EnterPageProps = {
  searchParams?: Promise<{ next?: string }>;
};

function sanitizeNext(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  return raw;
}

function parseInstallationId(nextPath: string | null): string | null {
  if (!nextPath) return null;
  if (!nextPath.startsWith("/install/meli/complete")) return null;
  const probe = new URL(nextPath, "http://localhost");
  const installationId = probe.searchParams.get("installation_id");
  return installationId || null;
}

export default async function EnterPage({ searchParams }: EnterPageProps) {
  const params = (await searchParams) ?? {};
  const nextPath = sanitizeNext(params.next);
  const installationId = parseInstallationId(nextPath);
  const isInstallNext = Boolean(installationId);

  if (installationId) {
    try {
      const installation = await getPendingInstallation(installationId);
      if (installation.linked_store_id) {
        redirect(`/dashboard/${installation.linked_store_id}`);
      }
    } catch {
      // Keep default /enter UI when installation lookup fails.
    }
  }

  const oauthHref = nextPath
    ? `/api/auth/meli/start?next=${encodeURIComponent(nextPath)}`
    : "/api/auth/meli/start";
  const primaryHref = isInstallNext && nextPath ? nextPath : oauthHref;
  const ctaLabel = isInstallNext ? "Continuar instalación" : "Conectar con Mercado Libre";
  const bodyText = isInstallNext
    ? "Tenes una instalación pendiente. Continuá para finalizar el vínculo y entrar al dashboard."
    : "Conecta tu cuenta de Mercado Libre para ver la historia clinica.";

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Ingresar</h1>
      <p className="mt-2 text-sm text-slate-600">{bodyText}</p>
      <a
        href="/api/auth/login"
        className="mt-4 inline-flex rounded-md border px-5 py-3 text-sm font-medium"
      >
        Ingresar con Google
      </a>
      <a
        href={primaryHref}
        className="mt-6 inline-flex rounded-md bg-primary px-5 py-3 text-sm font-medium text-white hover:bg-[#2968c8]"
      >
        {ctaLabel}
      </a>
    </main>
  );
}
