import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowDown, ArrowRight } from "lucide-react";
import { supabaseAdmin } from "@v2/lib/supabase";
import { getLatestScore, type ScoreResponse } from "@v2/api/score";
import { getNoScoreBootstrapMessage, type DashboardBootstrapStatus } from "./bootstrap-message";

type StoreSlim = {
    store_id: string;
    display_name: string | null;
    provider_key: string;
};

type DashboardSignal = ScoreResponse["active_signals"][number];

type ScoreHistoryRow = {
    score: number;
    computed_at: string;
};

type MetricsRow = {
    metric_date: string;
    metrics: Record<string, unknown> | null;
};

type BootstrapRow = {
    bootstrap_status: DashboardBootstrapStatus;
};

type TodayMetricCard = {
    label: string;
    value: number | null;
    tone: "neutral" | "danger";
};

type AreaCard = {
    name: "Ventas" | "Reputación" | "Atención" | "Despacho";
    badge: string;
    accent: string;
    badgeClassName: string;
    rows: Array<{ label: string; value: string; tone?: "default" | "danger" | "success" }>;
};

const SURFACE_CARD = "rounded-[28px] border border-[#ddd8ce] bg-white shadow-[0_10px_22px_rgba(15,23,42,0.06)]";
const SURFACE_INSET = "rounded-[22px] border border-[#ebe6dc]";
const SECTION_EYEBROW = "text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#91949d] sm:tracking-[0.24em]";
const CHIP_BASE = "rounded-full px-2.5 py-1 text-[0.62rem] font-black uppercase tracking-[0.1em]";

function signalHeadline(signalKey: string): string {
    if (signalKey === "no_orders_7d") return "Esta semana no vendiste nada";
    if (signalKey === "cancellation_spike") return "Cancelaste el 40% de tus ventas";
    if (signalKey === "unanswered_messages_spike") return "Se te acumulan preguntas sin responder";
    if (signalKey === "claims_opened") return "Tenés reclamos abiertos";
    if (signalKey === "low_activity_14d") return "Todavía no tenés color de reputación";
    return "Hay una alerta que ya te está frenando";
}

function signalAction(signalKey: string): string {
    if (signalKey === "no_orders_7d") return "Revisá precios y publicaciones";
    if (signalKey === "cancellation_spike") return "Verificá tu stock antes de publicar";
    if (signalKey === "unanswered_messages_spike") return "Respondé las preguntas que quedaron abiertas";
    if (signalKey === "claims_opened") return "Entrá a tus reclamos y resolvelos hoy";
    if (signalKey === "low_activity_14d") return "Activá el programa de despegue";
    return "Revisá esta alerta ahora";
}

function signalEffect(signalKey: string): string {
    if (signalKey === "no_orders_7d") return "Menor visibilidad orgánica en los listados";
    if (signalKey === "cancellation_spike") return "Tu reputación caerá a rojo si no frenás esto";
    if (signalKey === "unanswered_messages_spike") return "Perdés respuesta, confianza y conversiones";
    if (signalKey === "claims_opened") return "Tu cuenta queda más expuesta y con más fricción";
    if (signalKey === "low_activity_14d") return "Sin color, el algoritmo limita tu exposición";
    return "Puede afectar tu ritmo de ventas";
}

function signalBadge(signal: DashboardSignal): string {
    if (signal.severity === "critical") return "URGENTE";
    if (signal.severity === "warning") return "IMPORTANTE";
    return "SEGUÍ ESTO";
}

function signalBadgeClassName(signal: DashboardSignal): string {
    if (signal.severity === "critical") return "bg-[#ea4335] text-white";
    if (signal.severity === "warning") return "bg-[#d06b2d] text-white";
    return "bg-[#2563eb] text-white";
}

function signalAccentClassName(signal: DashboardSignal): string {
    if (signal.severity === "critical") return "bg-[#ea4335]";
    if (signal.severity === "warning") return "bg-[#d06b2d]";
    return "bg-[#2563eb]";
}

function evidenceLabel(key: string): string {
    if (key === "orders_created_7d") return "Qué pasó";
    if (key === "orders_cancelled_1d") return "Cancelaciones hoy";
    if (key === "orders_created_1d") return "Ventas hoy";
    if (key === "ratio") return "Ratio actual";
    if (key === "messages_received_1d") return "Mensajes recibidos hoy";
    if (key === "messages_answered_1d") return "Mensajes respondidos hoy";
    if (key === "claims_opened_14d") return "Reclamos en 14 días";
    if (key === "claims_opened_1d") return "Reclamos hoy";
    if (key === "questions_received_1d") return "Preguntas nuevas";
    if (key === "unanswered_questions_24h_count_1d") return "Preguntas pendientes";
    return key.replace(/_/g, " ");
}

function evidenceSummary(signal: DashboardSignal): string {
    const firstEntry = Object.entries(signal.evidence)[0];
    if (!firstEntry) return "Hay una señal activa que necesita atención.";
    return `${evidenceLabel(firstEntry[0])}: ${String(firstEntry[1])}`;
}

function parseMetricValue(metrics: Record<string, unknown> | null, key: string): number | null {
    const value = metrics?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatMetricValue(value: number | null): string {
    if (value === null) return "-";
    return new Intl.NumberFormat("es-AR").format(value);
}

function buildTodayMetrics(metricsRow: MetricsRow | null): TodayMetricCard[] {
    const metrics = metricsRow?.metrics ?? null;
    return [
        { label: "Ventas", value: parseMetricValue(metrics, "orders_created_1d"), tone: "neutral" },
        { label: "Cancelaciones", value: parseMetricValue(metrics, "orders_cancelled_1d"), tone: "danger" },
        {
            label: "Preguntas nuevas",
            value: parseMetricValue(metrics, "questions_received_1d") ?? parseMetricValue(metrics, "messages_received_1d"),
            tone: "neutral",
        },
        { label: "Reclamos nuevos", value: parseMetricValue(metrics, "claims_opened_1d"), tone: "neutral" },
    ];
}

function buildAreaCards(metricsRow: MetricsRow | null, scoreData: ScoreResponse | null): AreaCard[] {
    const metrics = metricsRow?.metrics ?? null;
    const sales = parseMetricValue(metrics, "orders_created_1d");
    const cancellations = parseMetricValue(metrics, "orders_cancelled_1d");
    const questions = parseMetricValue(metrics, "questions_received_1d") ?? parseMetricValue(metrics, "messages_received_1d");
    const unanswered = parseMetricValue(metrics, "unanswered_questions_24h_count_1d");
    const claims = parseMetricValue(metrics, "claims_opened_1d");

    return [
        {
            name: "Ventas",
            badge: sales === 0 ? "CRÍTICO" : "ACTIVO",
            accent: "before:bg-[#ea4335]",
            badgeClassName: sales === 0 ? "bg-[#fff0f0] text-[#ea4335]" : "bg-[#e9f9ef] text-[#15803d]",
            rows: [
                { label: "Monto (mes)", value: "$0" },
                { label: "Órdenes", value: formatMetricValue(sales) },
                { label: "Cancelado", value: `${formatMetricValue(cancellations)}%`, tone: cancellations && cancellations > 0 ? "danger" : "default" },
            ],
        },
        {
            name: "Reputación",
            badge: scoreData && scoreData.score < 60 ? "SIN COLOR" : "PENDIENTE",
            accent: "before:bg-[#d06b2d]",
            badgeClassName: "bg-[#fff4dd] text-[#b45309]",
            rows: [
                { label: "Calificación", value: "Pendiente" },
                { label: "Reclamos", value: `${formatMetricValue(claims)}%` },
                { label: "Tus cancel.", value: `${formatMetricValue(cancellations)}%`, tone: cancellations && cancellations > 0 ? "danger" : "default" },
            ],
        },
        {
            name: "Atención",
            badge: unanswered && unanswered > 0 ? "EN ALERTA" : "EXCELENTE",
            accent: "before:bg-[#15803d]",
            badgeClassName: unanswered && unanswered > 0 ? "bg-[#fff7ed] text-[#c2410c]" : "bg-[#e9f9ef] text-[#15803d]",
            rows: [
                { label: "Preguntas s/r", value: formatMetricValue(unanswered) },
                { label: "Tiempo rta.", value: unanswered && unanswered > 0 ? "2h" : "0h" },
                { label: "Postventa", value: formatMetricValue(questions) },
            ],
        },
        {
            name: "Despacho",
            badge: "A TIEMPO",
            accent: "before:bg-[#15803d]",
            badgeClassName: "bg-[#e9f9ef] text-[#15803d]",
            rows: [
                { label: "Eficiencia", value: "100%", tone: "success" },
                { label: "Demorados", value: "0" },
                { label: "Envíos hoy", value: "0" },
            ],
        },
    ];
}

function sparklinePath(scores: number[]): string {
    if (scores.length === 0) return "";
    const width = 960;
    const height = 220;
    const step = scores.length === 1 ? 0 : width / (scores.length - 1);

    return scores
        .map((score, index) => {
            const x = index * step;
            const y = height - (score / 100) * (height - 16) - 8;
            return `${index === 0 ? "M" : "L"}${x} ${y}`;
        })
        .join(" ");
}

async function getSessionStores(): Promise<{ stores: StoreSlim[] } | null> {
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

    const stores: StoreSlim[] = (memberships ?? [])
        .map((membership) => membership.v2_stores as unknown as StoreSlim | null)
        .filter((store): store is StoreSlim => Boolean(store))
        .map((store) => ({
            store_id: store.store_id,
            display_name: store.display_name ?? null,
            provider_key: store.provider_key,
        }));

    return { stores };
}

export default async function DashboardPrincipalPage({
    params,
}: {
    params: Promise<{ store_id: string }>;
}) {
    await headers();

    const sessionData = await getSessionStores();
    if (!sessionData) redirect("/enter");

    const { store_id } = await params;
    if (!store_id) notFound();

    const { stores } = sessionData;
    const allowed = stores.some((store) => store.store_id === store_id);
    if (!allowed) redirect("/choose-store");

    const [scoreData, scoreHistoryResp, metricsResp, bootstrapResp] = await Promise.all([
        getLatestScore(store_id).catch(() => null),
        supabaseAdmin
            .from("v2_health_scores")
            .select("score,computed_at")
            .eq("store_id", store_id)
            .order("computed_at", { ascending: false })
            .limit(8),
        supabaseAdmin
            .from("v2_metrics_daily")
            .select("metric_date,metrics")
            .eq("store_id", store_id)
            .order("metric_date", { ascending: false })
            .limit(1)
            .maybeSingle<MetricsRow>(),
        supabaseAdmin
            .from("v2_oauth_installations")
            .select("bootstrap_status")
            .eq("linked_store_id", store_id)
            .order("linked_at", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle<BootstrapRow>(),
    ]);

    const scoreHistory = ((scoreHistoryResp.data ?? []) as ScoreHistoryRow[]).reverse();
    const latestMetrics = (metricsResp.data ?? null) as MetricsRow | null;
    const bootstrap = (bootstrapResp.data ?? null) as BootstrapRow | null;

    const activeSignals = scoreData?.active_signals ?? [];
    const primarySignal = activeSignals[0] ?? null;
    const previousScore = scoreHistory.length >= 2 ? scoreHistory[scoreHistory.length - 2]?.score ?? null : null;
    const delta = scoreData && previousScore !== null ? scoreData.score - previousScore : null;
    const todayMetrics = buildTodayMetrics(latestMetrics);
    const areaCards = buildAreaCards(latestMetrics, scoreData);
    const sparklineScores = scoreHistory.map((row) => row.score).filter((value) => Number.isFinite(value));
    const worstScore = sparklineScores.length > 0 ? Math.min(...sparklineScores) : null;
    const calibrationMessage = getNoScoreBootstrapMessage(bootstrap?.bootstrap_status ?? null);

    return (
        <div className="space-y-7 px-2 pb-10 sm:px-0">
            <section className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1.85fr)_320px]">
                <article className={`${SURFACE_CARD} px-4 py-5 sm:px-8 sm:py-8 lg:px-9`}>
                    <p className={SECTION_EYEBROW}>Cómo está tu negocio hoy</p>
                    <div className="mt-7 grid gap-6 lg:grid-cols-[1.05fr_1fr] lg:items-center">
                        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
                            <div className="flex min-w-0 items-end leading-none">
                                <span className="text-[3.5rem] font-black tracking-[-0.08em] text-[#0f1117] sm:text-[4.4rem]">{scoreData ? scoreData.score : "--"}</span>
                                <span className="pb-2 text-[1.7rem] font-black tracking-[-0.06em] text-[#c5c8cf] sm:text-[2.35rem]">/100</span>
                            </div>
                            <div className="hidden h-16 w-px bg-[#ece8de] lg:block" />
                        </div>
                        <div className="min-w-0 max-w-[27rem]">
                            <div className="flex items-center gap-2 text-[0.92rem] font-black leading-none text-[#e12f2f] sm:text-[1.1rem]">
                                <ArrowDown className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
                                <span>Perdés fuerza</span>
                            </div>
                            <p className="mt-3 text-[0.86rem] font-semibold leading-[1.42] text-[#2d313a] sm:text-[0.98rem] sm:leading-[1.28]">
                                Hoy tenés problemas operativos que ya están frenando tus ventas.
                            </p>
                        </div>
                    </div>

                    <div className="mt-8 border-t border-[#ece8de] pt-7">
                        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                            <div>
                                <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#9ea2aa]">Si seguís así</p>
                                <p className="mt-2 max-w-[35rem] text-[1.02rem] font-semibold leading-7 text-[#21252c]">
                                    {primarySignal
                                        ? "Podés cerrar el mes con menor exposición en listados y caída de ingresos."
                                        : scoreData
                                          ? "Podés mantener el ritmo si seguís corrigiendo los puntos que hoy te frenan."
                                          : calibrationMessage}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-[1.55rem] font-black leading-none tracking-[-0.05em] text-[#e12f2f] sm:text-[1.8rem]">
                                    {delta !== null ? `${Math.abs(delta)} pts` : scoreData ? `${scoreData.score} pts` : "--"}
                                </p>
                                <p className="mt-1 text-xs font-black uppercase tracking-[0.16em] text-[#a6a9b1]">Proyección cierre</p>
                            </div>
                        </div>
                    </div>
                </article>

                <aside className={`${SURFACE_CARD} px-4 py-6 sm:px-7 sm:py-8`}>
                    <p className={SECTION_EYEBROW}>Hoy en tu negocio</p>
                    <div className="mt-8 space-y-5">
                        {todayMetrics.map((item) => (
                            <div key={item.label} className="grid min-h-[46px] grid-cols-[1fr_auto] items-center gap-4 border-b border-[#f0ece4] pb-4 last:border-b-0 last:pb-0">
                                <span className="text-[0.84rem] font-semibold text-[#444853]">{item.label}</span>
                                <span className={`text-[1rem] font-black tabular-nums sm:text-[1.05rem] ${item.tone === "danger" && (item.value ?? 0) > 0 ? "text-[#e12f2f]" : "text-[#101219]"}`}>
                                    {formatMetricValue(item.value)}
                                </span>
                            </div>
                        ))}
                    </div>
                </aside>
            </section>

            <section className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1.85fr)_320px]">
                <article className={`${SURFACE_CARD} px-4 py-5 sm:px-7 sm:py-7`}>
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className={SECTION_EYEBROW}>Lo que te está frenando hoy</p>
                        </div>
                        <Link
                            href={`/dashboard/${store_id}/alerts`}
                            className="hidden rounded-full border border-[#e5dfd3] px-4 py-2 text-sm font-bold text-[#2f3138] transition hover:bg-[#f5f2ea] md:inline-flex"
                        >
                            Ver alertas
                        </Link>
                    </div>

                    <div className="mt-6 space-y-4">
                        {activeSignals.length > 0 ? (
                            activeSignals.slice(0, 3).map((signal) => (
                                <article key={signal.signal_key} className={`relative overflow-hidden ${SURFACE_INSET} bg-[#faf9f6] px-4 py-4 sm:px-6 sm:py-5`}>
                                    <div className={`absolute inset-y-0 left-0 w-[3px] ${signalAccentClassName(signal)}`} />
                                    <div className="space-y-4 pl-1">
                                        <div className="flex flex-wrap items-center gap-2.5">
                                            <span className={`${CHIP_BASE} ${signalBadgeClassName(signal)}`}>
                                                {signalBadge(signal)}
                                            </span>
                                            <h3 className="text-[0.98rem] font-black leading-tight text-[#161616]">{signalHeadline(signal.signal_key)}</h3>
                                        </div>
                                        <div className="grid gap-5 text-[0.78rem] leading-6 text-[#33353a] md:grid-cols-2">
                                            <div>
                                                <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.16em] text-[#969aa3]">Qué pasó</p>
                                                <p className="mt-1">{evidenceSummary(signal)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.16em] text-[#969aa3]">Te afecta</p>
                                                <p className="mt-1">{signalEffect(signal.signal_key)}</p>
                                            </div>
                                        </div>
                                        <Link href={`/dashboard/${store_id}/alerts`} className="inline-flex items-center gap-2 text-[0.78rem] font-black text-[#1d4ed8]">
                                            {signalAction(signal.signal_key)}
                                            <ArrowRight className="h-4 w-4" />
                                        </Link>
                                    </div>
                                </article>
                            ))
                        ) : (
                            <div className="rounded-[22px] border border-dashed border-[#ddd7ca] bg-[#faf8f2] px-6 py-8 text-sm font-medium text-[#5d6168]">
                                {scoreData ? "Hoy no aparecen problemas operativos nuevos en esta lectura." : calibrationMessage}
                            </div>
                        )}
                    </div>
                </article>

                <aside className="rounded-[28px] border border-[#17233f] bg-[linear-gradient(178deg,#0a1738_0%,#09122a_100%)] px-4 py-6 text-white shadow-[0_16px_34px_rgba(3,11,27,0.42)] sm:px-7 sm:py-7">
                    <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.22em] text-[#8f98b2]">Recomendación IA</p>
                    <div className="mt-7 space-y-6">
                        <div>
                            <p className="text-[0.66rem] font-extrabold uppercase tracking-[0.18em] text-[#1d6dff]">
                                Resolvé en 10 minutos
                            </p>
                            <h3 className="mt-3 text-[1.6rem] font-black leading-[1.06] tracking-[-0.04em] text-white sm:text-[2.2rem]">
                                Verificá tu
                                <br />
                                stock antes del
                                <br />
                                lunes
                            </h3>
                        </div>
                        <p className="text-[0.84rem] leading-7 text-[#c0c8da] sm:text-[0.92rem]">
                            {primarySignal
                                ? "Tus últimas cancelaciones fueron por falta de stock disponible. Es la acción más urgente para estabilizar tu cuenta y proteger tu salud comercial."
                                : scoreData
                                  ? "No hay una prioridad roja ahora. Sostené este control para no perder tracción comercial."
                                  : calibrationMessage}
                        </p>
                    </div>
                    <div className="mt-12">
                        <Link
                            href={`/dashboard/${store_id}/alerts`}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-[16px] bg-[#1f5ded] px-5 py-3.5 text-[0.84rem] font-black text-white shadow-[0_12px_24px_rgba(31,93,237,0.38)] transition hover:bg-[#1b50cc]"
                        >
                            Revisar stock ahora
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                    </div>
                </aside>
            </section>

            <section className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-4">
                {areaCards.map((card) => (
                    <article
                        key={card.name}
                        className={`relative overflow-hidden rounded-[24px] border border-[#ddd8ce] bg-white px-4 py-4 shadow-[0_10px_20px_rgba(15,23,42,0.05)] before:absolute before:inset-x-0 before:top-0 before:h-[3px] sm:px-5 sm:py-5 ${card.accent.replace("before:inset-y-0 before:left-0 before:w-[4px] ", "")}`}
                    >
                        <div className="space-y-5">
                            <div className="flex items-start justify-between gap-4">
                                <h3 className="text-[0.94rem] font-black tracking-[-0.03em] text-[#151515]">{card.name}</h3>
                                <span className={`${CHIP_BASE} ${card.badgeClassName}`}>
                                    {card.badge}
                                </span>
                            </div>
                            <div className="space-y-3">
                                {card.rows.map((row) => (
                                    <div key={`${card.name}-${row.label}`} className="grid grid-cols-[1fr_auto] items-center gap-4 text-[0.72rem]">
                                        <span className="font-bold uppercase tracking-[0.05em] text-[#7a7f88]">{row.label}</span>
                                        <span
                                            className={`font-black tabular-nums ${
                                                row.tone === "danger"
                                                    ? "text-[#ea4335]"
                                                    : row.tone === "success"
                                                      ? "text-[#15803d]"
                                                      : "text-[#121212]"
                                            }`}
                                        >
                                            {row.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </article>
                ))}
            </section>

            <section className={`${SURFACE_CARD} px-4 py-5 sm:px-8 sm:py-8`}>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                        <p className={SECTION_EYEBROW}>Cómo se movió tu negocio (7d)</p>
                    </div>
                    {sparklineScores.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-8 text-sm font-black">
                            <span className="inline-flex items-center gap-2 text-[#111111]">
                                <span className="h-2.5 w-2.5 rounded-full bg-[#1d4ed8]" />
                                Hoy · {scoreData?.score ?? sparklineScores[sparklineScores.length - 1]}
                            </span>
                            {worstScore !== null ? (
                                <span className="inline-flex items-center gap-2 text-[#9ca3af]">
                                    <span className="h-2.5 w-2.5 rounded-full bg-[#d1d5db]" />
                                    Tu peor momento · {worstScore}
                                </span>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                <div className="mt-8">
                    {sparklineScores.length >= 2 ? (
                        <div className="rounded-[22px] border border-[#e9e4da] bg-[linear-gradient(180deg,#ffffff_0%,#f4f6fb_100%)] px-4 py-5 sm:px-5 sm:py-6">
                            {/* SVG responsive: height scales with container */}
                            <svg viewBox="0 0 960 260" className="h-[132px] w-full sm:h-[180px] lg:h-[220px]">
                                <line x1="0" y1="220" x2="960" y2="220" stroke="#dbe3f2" strokeWidth="2" />
                                <path d={sparklinePath(sparklineScores)} fill="none" stroke="#1d4ed8" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
                                <circle
                                    cx="960"
                                    cy={220 - ((sparklineScores[sparklineScores.length - 1] / 100) * (220 - 16))}
                                    r="5"
                                    fill="#1d4ed8"
                                />
                            </svg>
                        </div>
                    ) : (
                        <div className="rounded-[22px] border border-dashed border-[#ddd7ca] bg-[#faf8f2] px-6 py-8 text-sm font-medium text-[#5d6168]">
                            La evolución se activa cuando haya más de una lectura real de score.
                        </div>
                    )}
                </div>

                <div className="mt-7 rounded-[22px] border border-[#ebe6dc] bg-[#f8f8f8] px-4 py-4">
                    <div className="flex items-start gap-3 text-[0.84rem] italic text-[#33353a]">
                        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#9ca3af]" />
                        <p>
                        {delta !== null
                            ? `${delta < 0 ? `Perdiste ${Math.abs(delta)}` : `Ganaste ${delta}`} puntos de salud comercial esta semana. Mirá los factores que te están frenando arriba.`
                            : scoreData
                              ? `Tu score actual es ${scoreData.score}. Seguimos mostrando solo lecturas reales.`
                              : calibrationMessage}
                        </p>
                    </div>
                </div>
            </section>

            <div className="md:hidden">
                <Link
                    href={`/dashboard/${store_id}/alerts`}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#2563eb] px-5 py-4 text-base font-black text-white"
                >
                    Revisar alertas
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </div>
        </div>
    );
}
