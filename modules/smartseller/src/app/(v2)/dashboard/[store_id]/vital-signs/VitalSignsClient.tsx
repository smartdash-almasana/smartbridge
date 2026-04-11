"use client";

import { useMemo, useState } from "react";
import {
    AlertTriangle,
    Clock3,
    MessageCircle,
    ShieldCheck,
    Trophy,
    Truck,
} from "lucide-react";
import type { ScoreResponse } from "@v2/api/score";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export const AREAS = [
    { key: "logistica",      label: "Ventas",      icon: Truck },
    { key: "reputacion",     label: "Reputación",  icon: ShieldCheck },
    { key: "atencion",       label: "Atención",    icon: MessageCircle },
    { key: "competitividad", label: "Despacho",    icon: Trophy },
] as const;

export type AreaKey = (typeof AREAS)[number]["key"];

export type MetricsRow = {
    metric_date: string;
    metrics: Record<string, unknown> | null;
};

type VitalSignsClientProps = {
    scoreData: ScoreResponse | null;
    metricsRow: MetricsRow | null;
};

export type MetricCard = {
    title: string;
    value: string;
    sub: string;
    icon: React.ComponentType<{ className?: string }>;
    alert?: boolean;
};

export type AreaSignal = {
    signal_key: string;
    severity: "info" | "warning" | "critical";
    evidence: Record<string, unknown>;
};

const SURFACE_CARD = "rounded-[28px] border border-[#ddd8ce] bg-white shadow-[0_10px_22px_rgba(15,23,42,0.06)]";
const SURFACE_INSET = "rounded-[20px] border border-[#e8e3da]";
const SECTION_EYEBROW = "text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#667084] sm:text-[10px] sm:tracking-[0.3em]";
const CHIP_BASE = "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.62rem] font-black uppercase tracking-[0.1em]";

// ─── Lógica de datos (sin cambios semánticos) ─────────────────────────────────

function signalLabel(signalKey: string): string {
    if (signalKey === "no_orders_7d") return "Sin ventas en los últimos 7 días";
    if (signalKey === "cancellation_spike") return "Suba de cancelaciones detectada";
    if (signalKey === "unanswered_messages_spike") return "Mensajes sin respuesta";
    if (signalKey === "claims_opened") return "Reclamos activos";
    if (signalKey === "low_activity_14d") return "Actividad por debajo de lo esperado";
    return "Alerta operativa activa";
}

function signalDescription(signal: AreaSignal): string {
    const ev = signal.evidence;
    if (signal.signal_key === "no_orders_7d") {
        const n = ev["orders_created_7d"];
        return n !== undefined ? `${n} órdenes creadas en los últimos 7 días.` : "Sin datos suficientes.";
    }
    if (signal.signal_key === "cancellation_spike") {
        const ratio = ev["ratio"];
        return ratio !== undefined ? `Ratio de cancelación: ${(Number(ratio) * 100).toFixed(1)}% del total de órdenes.` : "Índice elevado de cancelaciones.";
    }
    if (signal.signal_key === "unanswered_messages_spike") {
        const received = ev["messages_received_1d"];
        const answered = ev["messages_answered_1d"];
        if (received !== undefined && answered !== undefined) {
            return `${answered} de ${received} mensajes respondidos hoy.`;
        }
        return "Alta proporción de mensajes sin respuesta.";
    }
    if (signal.signal_key === "claims_opened") {
        const n = ev["claims_opened_14d"];
        return n !== undefined ? `${n} reclamos abiertos en los últimos 14 días.` : "Reclamos activos detectados.";
    }
    if (signal.signal_key === "low_activity_14d") {
        const n = ev["total_activity"];
        return n !== undefined ? `Actividad total en 14 días: ${n}.` : "Actividad por debajo de lo normal.";
    }
    return "Revisá el detalle en Alertas.";
}

function metricNumber(metrics: Record<string, unknown> | null, key: string): number | null {
    const value = metrics?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildAreaMetricCards(areaKey: AreaKey, metricsRow: MetricsRow | null): MetricCard[] {
    const metrics = metricsRow?.metrics ?? null;
    const period = metricsRow?.metric_date ?? null;
    const sub = period ? `Período: ${period}` : "Sin datos del período";

    if (areaKey === "logistica") {
        const created = metricNumber(metrics, "orders_created_1d");
        const cancelled = metricNumber(metrics, "orders_cancelled_1d");
        const cards: MetricCard[] = [];
        if (created !== null) {
            cards.push({ title: "Órdenes creadas hoy", value: String(created), sub, icon: Truck });
        }
        if (cancelled !== null) {
            cards.push({
                title: "Cancelaciones hoy",
                value: String(cancelled),
                sub,
                icon: AlertTriangle,
                alert: cancelled > 0,
            });
        }
        return cards;
    }

    if (areaKey === "atencion") {
        const received = metricNumber(metrics, "messages_received_1d");
        const answered = metricNumber(metrics, "messages_answered_1d");
        const cards: MetricCard[] = [];
        if (received !== null) {
            cards.push({ title: "Mensajes recibidos hoy", value: String(received), sub, icon: MessageCircle });
        }
        if (answered !== null) {
            cards.push({ title: "Mensajes respondidos hoy", value: String(answered), sub, icon: Clock3 });
        }
        return cards;
    }

    if (areaKey === "reputacion") {
        const claims = metricNumber(metrics, "claims_opened_1d");
        return claims !== null
            ? [{ title: "Reclamos abiertos hoy", value: String(claims), sub, icon: ShieldCheck, alert: claims > 0 }]
            : [];
    }

    // competitividad / despacho — no tiene métricas directas de 1d propias
    return [];
}

function filterSignalsByArea(areaKey: AreaKey, signals: AreaSignal[]): AreaSignal[] {
    const map: Record<AreaKey, string[]> = {
        logistica:      ["cancellation_spike"],
        atencion:       ["unanswered_messages_spike"],
        reputacion:     ["claims_opened"],
        competitividad: ["low_activity_14d", "no_orders_7d"],
    };
    return signals.filter((s) => map[areaKey].includes(s.signal_key));
}

function deriveHealthLabel(score: number | null | undefined): { text: string; good: boolean } {
    if (score === null || score === undefined) return { text: "Sin datos", good: false };
    if (score >= 80) return { text: "Operativo", good: true };
    if (score >= 60) return { text: "Bajo observación", good: false };
    return { text: "Requiere atención", good: false };
}

function deriveEstadoGeneral(
    areaSig: AreaSignal[],
    areaLabel: string,
): string {
    const criticals = areaSig.filter((s) => s.severity === "critical");
    const warnings = areaSig.filter((s) => s.severity === "warning");
    if (criticals.length > 0) {
        return `${areaLabel} tiene ${criticals.length} alerta${criticals.length > 1 ? "s" : ""} crítica${criticals.length > 1 ? "s" : ""} que requieren acción inmediata.`;
    }
    if (warnings.length > 0) {
        return `${areaLabel} tiene ${warnings.length} señal${warnings.length > 1 ? "es" : ""} de advertencia. Revisá los indicadores activos.`;
    }
    return `${areaLabel} no registra alertas activas. Los indicadores del período se muestran abajo.`;
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: AreaSignal["severity"] }) {
    if (severity === "critical") {
        return (
            <span className={`${CHIP_BASE} bg-red-100 text-red-700`}>
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                Crítico
            </span>
        );
    }
    if (severity === "warning") {
        return (
            <span className={`${CHIP_BASE} bg-amber-100 text-amber-700`}>
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Advertencia
            </span>
        );
    }
    return (
        <span className={`${CHIP_BASE} bg-teal-100 text-teal-700`}>
            <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
            Informativo
        </span>
    );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function VitalSignsClient({ scoreData, metricsRow }: VitalSignsClientProps) {
    const [selectedAreaKey, setSelectedAreaKey] = useState<AreaKey>("logistica");

    const allSignals = useMemo(
        () => ((scoreData?.active_signals ?? []) as AreaSignal[]),
        [scoreData],
    );

    const selectedArea = AREAS.find((a) => a.key === selectedAreaKey) ?? AREAS[0];
    const areaLabel = selectedArea.label;

    const areaSignals = useMemo(
        () => filterSignalsByArea(selectedAreaKey, allSignals),
        [selectedAreaKey, allSignals],
    );

    const areaMetricCards = useMemo(
        () => buildAreaMetricCards(selectedAreaKey, metricsRow),
        [selectedAreaKey, metricsRow],
    );

    const score = scoreData?.score ?? null;
    const health = deriveHealthLabel(score);
    const estadoTexto = deriveEstadoGeneral(areaSignals, areaLabel);

    // "A qué prestar atención" — solo señales de TODAS las áreas de prioridad alta
    const topSignals = useMemo(
        () => [...allSignals]
            .filter((s) => s.severity === "critical" || s.severity === "warning")
            .slice(0, 3),
        [allSignals],
    );

    const hasMetrics = areaMetricCards.length > 0;
    const hasSignals = areaSignals.length > 0;

    return (
        <div className="w-full min-w-0 px-2 sm:px-0">
            {/* ── Encabezado de la sección ─────────────────────────────── */}
            <section className="mb-7 border-b border-[#e7e2d9] pb-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="max-w-3xl">
                        <p className={SECTION_EYEBROW}>
                            Estado general
                        </p>
                        <h1 className="mt-2 text-2xl font-black tracking-[-0.03em] text-[#06102c] sm:text-[2.35rem]">
                            Áreas del negocio
                        </h1>
                        <p className="mt-2 max-w-2xl text-[0.92rem] leading-7 text-slate-600">{estadoTexto}</p>
                    </div>
                    <span
                        className={`inline-flex items-center gap-2 rounded-full border border-[#e8e3da] bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.08em] ${
                            health.good
                                ? "text-green-700"
                                : "text-red-700"
                        }`}
                    >
                        <span className={`h-2 w-2 rounded-full ${health.good ? "bg-green-500" : "bg-red-500"}`} />
                        {health.text}
                    </span>
                </div>
            </section>

            {/* ── Tabs de áreas ────────────────────────────────────────── */}
            <div className="mb-7 grid grid-cols-1 gap-1.5 rounded-[16px] border border-[#e7e2d9] bg-[#f5f5f6] p-1.5 min-[320px]:grid-cols-2 sm:flex">
                {AREAS.map((area) => {
                    const active = area.key === selectedAreaKey;
                    const Icon = area.icon;
                    const hasAlert = filterSignalsByArea(area.key, allSignals).some(
                        (s) => s.severity === "critical" || s.severity === "warning",
                    );
                    return (
                        <button
                            key={area.key}
                            type="button"
                            onClick={() => setSelectedAreaKey(area.key)}
                            className={`relative flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-[12px] px-2 py-2 text-[0.68rem] font-bold transition-all min-[320px]:min-h-[50px] sm:min-h-[54px] sm:gap-2 sm:px-3 sm:text-[0.76rem] ${
                                active
                                    ? "bg-white text-[#0f4fe7] shadow-[0_6px_14px_rgba(15,23,42,0.08)]"
                                    : "text-slate-600 hover:bg-[#f0f1f3] hover:text-slate-900"
                            }`}
                        >
                            {hasAlert && !active && (
                                <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-red-500" />
                            )}
                            <Icon className={`hidden h-4 w-4 shrink-0 sm:block ${active ? "text-[#0f4fe7]" : "text-slate-400"}`} />
                            <span className="truncate text-[0.72rem] sm:text-[0.82rem]">{area.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* ── Cuerpo principal: panel izquierdo + columna derecha ──── */}
            <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">

                {/* Panel de métricas del área */}
                <div className="min-w-0 space-y-5 sm:space-y-6">

                    {/* Card principal del panel */}
                    <section className={`relative overflow-hidden ${SURFACE_CARD}`}>
                        <div className="absolute inset-y-0 left-0 w-[4px] bg-[#1463ea]" />
                        <div className="flex flex-col items-start justify-between gap-3 border-b border-[#eee9e0] bg-[linear-gradient(180deg,#fbfbf8_0%,#f6f7fb_100%)] px-4 py-4 sm:flex-row sm:items-center sm:gap-0 sm:px-6 sm:py-5">
                            <div>
                                <p className={SECTION_EYEBROW}>
                                    Panel de {areaLabel}
                                </p>
                                {score !== null && (
                                    <p className="mt-0.5 text-[0.68rem] text-slate-400">
                                        Score global del negocio: {score}/100
                                    </p>
                                )}
                            </div>
                            {hasSignals ? (
                                <span className={`${CHIP_BASE} border border-red-200 bg-red-50 text-red-600`}>
                                    <AlertTriangle className="h-3 w-3" />
                                    Con alertas
                                </span>
                            ) : (
                                <span className={`${CHIP_BASE} border border-green-200 bg-green-50 text-green-600`}>
                                    En orden
                                </span>
                            )}
                        </div>

                        <div className="p-4 sm:p-6">
                            {/* Métricas de tarjetas */}
                            {hasMetrics ? (
                                <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                    {areaMetricCards.map((card) => {
                                        const Icon = card.icon;
                                        return (
                                            <div
                                                key={card.title}
                                                className={`min-h-[150px] rounded-[18px] border p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${
                                                    card.alert
                                                        ? "border-red-200 bg-[linear-gradient(180deg,#fff7f7_0%,#fff0f0_100%)]"
                                                        : "border-[#ebe6dc] bg-[linear-gradient(180deg,#ffffff_0%,#f8f9fb_100%)]"
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <p className="text-[0.65rem] font-black uppercase tracking-[0.14em] text-slate-500">
                                                        {card.title}
                                                    </p>
                                                    <Icon
                                                        className={`h-4 w-4 shrink-0 ${
                                                            card.alert ? "text-red-400" : "text-slate-400"
                                                        }`}
                                                    />
                                                </div>
                                                <p
                                                    className={`mt-5 text-[1.9rem] font-black tracking-[-0.04em] ${
                                                        card.alert ? "text-red-600" : "text-slate-900"
                                                    }`}
                                                >
                                                    {card.value}
                                                </p>
                                                <p className="mt-2.5 text-[10px] text-slate-400">{card.sub}</p>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="rounded-[22px] border border-[#ebe6dc] bg-slate-50 px-5 py-6 text-sm text-slate-500">
                                    No hay métricas disponibles para{" "}
                                    <span className="font-semibold text-slate-700">{areaLabel}</span>{" "}
                                    en este período.
                                    {!metricsRow && (
                                        <span className="ml-1 text-slate-400">
                                            El sistema aún no registró datos suficientes.
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Alertas activas del área */}
                    <section className={`overflow-hidden ${SURFACE_CARD}`}>
                        <div className="flex items-center justify-between gap-3 border-b border-[#f1ece3] bg-[linear-gradient(180deg,#fbfbf8_0%,#f6f7fb_100%)] px-4 py-4 sm:px-6 sm:py-5">
                            <p className={SECTION_EYEBROW}>
                                Alertas activas en {areaLabel}
                            </p>
                            {hasSignals && (
                                <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-[0.68rem] font-black text-white">
                                    {areaSignals.length}
                                </span>
                            )}
                        </div>

                        {hasSignals ? (
                            <ul className="divide-y divide-slate-100">
                                {areaSignals.map((signal) => (
                                    <li key={signal.signal_key} className="flex flex-col items-start gap-2 px-4 py-4 min-[320px]:flex-row min-[320px]:gap-4 sm:px-6 sm:py-4.5">
                                        <div className="mt-0.5">
                                            <SeverityBadge severity={signal.severity} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[0.92rem] font-black text-slate-900">
                                                {signalLabel(signal.signal_key)}
                                            </p>
                                            <p className="mt-1.5 max-w-[42rem] text-[0.86rem] leading-6 text-slate-500">
                                                {signalDescription(signal)}
                                            </p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="px-4 py-5 text-sm text-slate-500 sm:px-5 sm:py-6">
                                No hay alertas activas para{" "}
                                <span className="font-semibold text-slate-700">{areaLabel}</span>{" "}
                                en este momento.
                            </div>
                        )}
                    </section>
                </div>

                {/* Columna derecha */}
                <div className="min-w-0 space-y-5 sm:space-y-6">

                    {/* Score del negocio */}
                    {score !== null && (
                        <section className={`${SURFACE_CARD} overflow-hidden p-0`}>
                            <div className="border-b border-[#f1ece3] bg-[linear-gradient(180deg,#fbfbf8_0%,#f6f7fb_100%)] px-5 py-4">
                                <p className={SECTION_EYEBROW}>
                                    Salud del negocio
                                </p>
                            </div>
                            <div className="p-4 sm:p-5">
                                <div className="flex items-end gap-2">
                                    <span className="text-[3.15rem] font-black tracking-[-0.05em] text-[#06102c] sm:text-[3.45rem]">{score}</span>
                                    <span className="mb-1 text-base font-bold text-slate-400">/100</span>
                                </div>
                                <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                                    <div
                                        className={`h-2.5 rounded-full transition-all ${
                                            score >= 80
                                                ? "bg-green-500"
                                                : score >= 60
                                                  ? "bg-amber-500"
                                                  : "bg-red-500"
                                        }`}
                                        style={{ width: `${score}%` }}
                                    />
                                </div>
                                <p className="mt-3 text-xs text-slate-400">
                                    Lectura del{" "}
                                    {scoreData?.computed_at
                                        ? new Date(scoreData.computed_at).toLocaleDateString("es-AR", {
                                              day: "numeric",
                                              month: "short",
                                              hour: "2-digit",
                                              minute: "2-digit",
                                          })
                                        : "período actual"}
                                </p>
                            </div>
                        </section>
                    )}

                    {/* A qué prestar atención — señales prioritarias de todo el negocio */}
                    <section className="overflow-hidden rounded-[28px] border border-[#17233f] bg-[linear-gradient(180deg,#07132f_0%,#06102c_100%)] text-white shadow-[0_16px_34px_rgba(3,11,27,0.42)]">
                        <div className="border-b border-white/10 px-4 py-4 sm:px-5">
                            <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.22em] text-blue-300">
                                A qué prestar atención
                            </p>
                        </div>
                        {topSignals.length > 0 ? (
                            <ul className="divide-y divide-white/10">
                                {topSignals.map((signal) => (
                                    <li key={signal.signal_key} className="px-4 py-4 sm:px-5 sm:py-5">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-[0.9rem] font-black text-white">
                                                {signalLabel(signal.signal_key)}
                                            </p>
                                            {signal.severity === "critical" && (
                                                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                                            )}
                                        </div>
                                        <p className="mt-2 text-[0.84rem] leading-6 text-slate-400">
                                            {signalDescription(signal)}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="px-4 py-5 text-sm text-slate-400 sm:px-5 sm:py-6">
                                Sin señales de alta prioridad detectadas en este momento.
                            </div>
                        )}
                    </section>

                    {/* Fuente de datos */}
                    <div className="rounded-[18px] border border-[#ebe6dc] bg-[linear-gradient(180deg,#fafaf8_0%,#f4f5f7_100%)] px-4 py-4">
                        <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.22em] text-slate-400">
                            Fuente de datos
                        </p>
                        <p className="mt-1 text-[0.72rem] leading-5 text-slate-500">
                            Métricas del período más reciente registradas por el motor clínico.{" "}
                            {metricsRow?.metric_date
                                ? `Última lectura: ${metricsRow.metric_date}.`
                                : "Sin lectura disponible aún."}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
