import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { notFound, redirect } from "next/navigation";
import { getLatestScore, type ScoreResponse } from "@v2/api/score";
import { supabaseAdmin } from "@v2/lib/supabase";
import VitalSignsClient from "./VitalSignsClient";

type StoreSlim = {
    store_id: string;
    display_name: string | null;
    provider_key: string;
};

type MetricsRow = {
    metric_date: string;
    metrics: Record<string, unknown> | null;
};

async function getSessionStores(): Promise<StoreSlim[] | null> {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: () => cookieStore.getAll(),
                setAll: () => { },
            },
        },
    );

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const { data: memberships, error } = await supabase
        .from("v2_store_memberships")
        .select(`
            store_id,
            v2_stores (
                store_id,
                display_name,
                provider_key
            )
        `)
        .eq("user_id", session.user.id);

    if (error) return null;

    return (memberships ?? [])
        .map((membership) => membership.v2_stores as unknown as StoreSlim | null)
        .filter((store): store is StoreSlim => Boolean(store))
        .map((store) => ({
            store_id: store.store_id,
            display_name: store.display_name ?? null,
            provider_key: store.provider_key,
        }));
}

export default async function VitalSignsPage({
    params,
}: {
    params: Promise<{ store_id: string }>;
}) {
    const stores = await getSessionStores();
    if (!stores) {
        redirect("/enter");
    }

    const { store_id } = await params;
    if (!store_id) notFound();

    const allowed = stores.some((store) => store.store_id === store_id);
    if (!allowed) {
        redirect("/choose-store");
    }

    const [scoreData, metricsResp] = await Promise.all([
        getLatestScore(store_id).catch(() => null),
        supabaseAdmin
            .from("v2_metrics_daily")
            .select("metric_date,metrics")
            .eq("store_id", store_id)
            .order("metric_date", { ascending: false })
            .limit(1)
            .maybeSingle<MetricsRow>(),
    ]);

    return (
        <VitalSignsClient
            scoreData={scoreData as ScoreResponse | null}
            metricsRow={(metricsResp.data ?? null) as MetricsRow | null}
        />
    );
}
