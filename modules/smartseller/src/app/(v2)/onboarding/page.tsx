export default function OnboardingPage() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Onboarding</h1>
      <p className="mt-2 text-sm text-slate-600">
        Conecta tu cuenta de Mercado Libre para empezar.
      </p>
      <a
        href="/api/auth/meli/start"
        className="mt-6 inline-flex rounded-md bg-primary px-5 py-3 text-sm font-medium text-white hover:bg-[#2968c8]"
      >
        Conectar con Mercado Libre
      </a>
    </main>
  );
}
