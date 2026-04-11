import { headers } from 'next/headers';
import { findV3StoresByHumanName, type V3StoreLookupItem } from '@/v3/read-models/store-lookup';

export const dynamic = 'force-dynamic';

interface StorePulseResponse {
    ok: boolean;
    tenant_id: string;
    store_id: string;
    provider_key: string;
    store_status: string;
    current: {
        run_id: string | null;
        metric_date: string | null;
        score: number | null;
        severity_band: 'healthy' | 'warning' | 'critical' | null;
        computed_at: string | null;
        freshness_status: 'fresh' | 'stale' | 'outdated' | 'empty';
        age_seconds: number | null;
        active_signals: Array<{ signal_key: string; severity: 'info' | 'warning' | 'critical' }>;
    };
    recent_runs: Array<{
        run_id: string;
        metric_date: string;
        status: 'running' | 'done' | 'failed';
        score: number | null;
        signal_count: number;
        top_severity: 'info' | 'warning' | 'critical' | null;
    }>;
}

function selectionKey(store: Pick<V3StoreLookupItem, 'tenant_id' | 'store_id'>): string {
    return `${store.tenant_id}::${store.store_id}`;
}

async function fetchStorePulse(store: Pick<V3StoreLookupItem, 'tenant_id' | 'store_id'>): Promise<{
    data: StorePulseResponse | null;
    error: string | null;
}> {
    const hdrs = await headers();
    const host = hdrs.get('host');
    const proto = process.env.VERCEL ? 'https' : 'http';
    const baseUrl = host ? `${proto}://${host}` : process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
    const cronSecret = process.env.CRON_SECRET ?? '';

    if (!cronSecret) {
        return { data: null, error: 'CRON_SECRET missing in runtime environment.' };
    }

    const url = new URL('/api/v3/store-pulse', baseUrl);
    url.searchParams.set('tenant_id', store.tenant_id);
    url.searchParams.set('store_id', store.store_id);

    const response = await fetch(url.toString(), {
        method: 'GET',
        cache: 'no-store',
        headers: { 'x-cron-secret': cronSecret },
    });

    const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | StorePulseResponse | null;
    if (!response.ok) {
        const message = body && typeof body === 'object' && 'error' in body ? String(body.error ?? 'Unknown error') : 'Unknown error';
        return { data: null, error: `store-pulse request failed (${response.status}): ${message}` };
    }

    return { data: body as StorePulseResponse, error: null };
}

export default async function V3StorePulseInternalPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; selected?: string }>;
}) {
    const params = await searchParams;
    const query = (params.q ?? '').trim();
    const selected = (params.selected ?? '').trim();

    let matches: V3StoreLookupItem[] = [];
    let searchError: string | null = null;
    if (query) {
        try {
            matches = await findV3StoresByHumanName(query, 6);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            searchError = message;
        }
    }

    const selectedStore =
        matches.find((store) => selectionKey(store) === selected) ?? (matches.length === 1 ? matches[0] : null);

    let pulseData: StorePulseResponse | null = null;
    let pulseError: string | null = null;
    if (selectedStore) {
        const pulse = await fetchStorePulse(selectedStore);
        pulseData = pulse.data;
        pulseError = pulse.error;
    }

    return (
        <main className="mx-auto max-w-5xl p-6">
            <h1 className="text-2xl font-semibold text-slate-900">V3 Store Pulse (Internal)</h1>
            <p className="mt-2 text-sm text-slate-600">Buscá por nombre de negocio/tienda. Los UUIDs quedan internos.</p>

            <form method="GET" className="mt-6 flex gap-2">
                <input
                    type="text"
                    name="q"
                    defaultValue={query}
                    placeholder="Nombre de negocio o tienda (Mercado Libre)"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white">
                    Buscar
                </button>
            </form>

            {!query ? (
                <section className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    Ingresá el nombre de un negocio para resolver su store y ver el pulso operativo.
                </section>
            ) : null}

            {searchError ? (
                <section className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    Error de búsqueda: {searchError}
                </section>
            ) : null}

            {query && !searchError && matches.length === 0 ? (
                <section className="mt-6 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
                    No se encontraron tiendas para "{query}".
                </section>
            ) : null}

            {matches.length > 1 ? (
                <section className="mt-6 rounded-md border border-slate-200 bg-white p-4">
                    <h2 className="text-sm font-semibold text-slate-900">Seleccioná una tienda</h2>
                    <ul className="mt-3 space-y-2">
                        {matches.map((store) => (
                            <li key={selectionKey(store)} className="flex items-center justify-between rounded border border-slate-200 p-3">
                                <div>
                                    <p className="text-sm font-medium text-slate-900">{store.display_name}</p>
                                    <p className="text-xs text-slate-600">
                                        key: {store.store_key} | {store.provider_key} | {store.store_status}
                                    </p>
                                </div>
                                <form method="GET">
                                    <input type="hidden" name="q" value={query} />
                                    <input type="hidden" name="selected" value={selectionKey(store)} />
                                    <button type="submit" className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700">
                                        Ver pulso
                                    </button>
                                </form>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            {selectedStore ? (
                <section className="mt-6 rounded-md border border-slate-200 bg-white p-4">
                    <h2 className="text-lg font-semibold text-slate-900">{selectedStore.display_name}</h2>
                    <p className="mt-1 text-xs text-slate-600">
                        provider: {selectedStore.provider_key} | status: {selectedStore.store_status} | key: {selectedStore.store_key}
                    </p>

                    {pulseError ? (
                        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{pulseError}</div>
                    ) : null}

                    {pulseData ? (
                        <div className="mt-4 space-y-4">
                            <div className="grid gap-2 rounded border border-slate-200 p-3 text-sm md:grid-cols-3">
                                <p>
                                    <span className="text-slate-500">Score:</span> {pulseData.current.score ?? 'null'}
                                </p>
                                <p>
                                    <span className="text-slate-500">Severidad:</span> {pulseData.current.severity_band ?? 'null'}
                                </p>
                                <p>
                                    <span className="text-slate-500">Freshness:</span> {pulseData.current.freshness_status}
                                </p>
                            </div>

                            <div className="rounded border border-slate-200 p-3">
                                <h3 className="text-sm font-semibold text-slate-900">Señales activas</h3>
                                {pulseData.current.active_signals.length === 0 ? (
                                    <p className="mt-2 text-sm text-slate-600">Sin señales activas.</p>
                                ) : (
                                    <ul className="mt-2 space-y-1 text-sm">
                                        {pulseData.current.active_signals.map((signal) => (
                                            <li key={signal.signal_key} className="text-slate-700">
                                                {signal.signal_key} ({signal.severity})
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            <div className="rounded border border-slate-200 p-3">
                                <h3 className="text-sm font-semibold text-slate-900">Runs recientes</h3>
                                {pulseData.recent_runs.length === 0 ? (
                                    <p className="mt-2 text-sm text-slate-600">Sin runs recientes.</p>
                                ) : (
                                    <div className="mt-2 overflow-x-auto">
                                        <table className="w-full min-w-[520px] text-left text-sm">
                                            <thead className="text-xs text-slate-500">
                                                <tr>
                                                    <th className="py-1">Metric date</th>
                                                    <th className="py-1">Status</th>
                                                    <th className="py-1">Score</th>
                                                    <th className="py-1">Signals</th>
                                                    <th className="py-1">Top severity</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {pulseData.recent_runs.map((run) => (
                                                    <tr key={run.run_id} className="border-t border-slate-100 text-slate-700">
                                                        <td className="py-1">{run.metric_date}</td>
                                                        <td className="py-1">{run.status}</td>
                                                        <td className="py-1">{run.score ?? 'null'}</td>
                                                        <td className="py-1">{run.signal_count}</td>
                                                        <td className="py-1">{run.top_severity ?? 'null'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : null}
                </section>
            ) : null}
        </main>
    );
}
