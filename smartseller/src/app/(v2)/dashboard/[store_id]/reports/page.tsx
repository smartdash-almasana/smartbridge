"use client";

import { useState } from "react";
import {
    BarChart3,
    CalendarDays,
    Check,
    ClipboardList,
    Gauge,
    LayoutGrid,
    MessageSquareWarning,
    Search,
    Sparkles,
    Target,
    Truck,
    UserRoundSearch,
} from "lucide-react";

type ReportType = "resumen" | "riesgos" | "ventas" | "atencion" | "despacho" | "completo";
type RangeType = "7d" | "30d" | "mes" | "anterior";

const reportCards: Array<{
    id: ReportType;
    title: string;
    icon: React.ComponentType<{ className?: string }>;
}> = [
    { id: "resumen", title: "Resumen del negocio", icon: LayoutGrid },
    { id: "riesgos", title: "Riesgos de la cuenta", icon: UserRoundSearch },
    { id: "ventas", title: "Ventas y rendimiento", icon: BarChart3 },
    { id: "atencion", title: "Atencion y reputacion", icon: Gauge },
    { id: "despacho", title: "Despacho y operacion", icon: Truck },
    { id: "completo", title: "Reporte completo", icon: ClipboardList },
];

const mainQuestions = [
    "Que te esta frenando ventas hoy",
    "Donde perdes rentabilidad",
    "Que puede afectar tu reputacion",
    "Que publicaciones necesitan ajustes",
    "Que errores se repiten en la operacion",
    "Donde hay oportunidades rapidas",
];

const previewBlocks = [
    { title: "Resumen rapido", pages: "Pagina 01" },
    { title: "Problemas clave", pages: "Paginas 02-03" },
    { title: "Metricas del periodo", pages: "Paginas 04-05" },
    { title: "Sugerencias practicas", pages: "Paginas 06-07" },
    { title: "Plan de accion", pages: "Pagina 08" },
];

const SURFACE_CARD = "rounded-[28px] border border-[#ddd8ce] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.06)]";
const SURFACE_INSET = "rounded-[20px] border border-[#e8e3da]";
const SECTION_EYEBROW = "text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#5d6470] sm:text-[10px] sm:tracking-[0.32em]";
const CHIP_BASE = "rounded-full px-3 py-1 text-[0.62rem] font-black uppercase tracking-[0.12em]";

export default function DashboardReportsPage() {
    const [selectedReport, setSelectedReport] = useState<ReportType>("completo");
    const [selectedRange, setSelectedRange] = useState<RangeType>("30d");
    const [selectedQuestion, setSelectedQuestion] = useState(0);
    const [aiEnabled, setAiEnabled] = useState(true);

    return (
        <div className="mx-auto w-full max-w-6xl px-2 sm:px-0">
            <div className="mb-8 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 sm:gap-3 sm:text-[11px] sm:tracking-[0.2em]">
                <span>Reportes</span>
                <span>/</span>
                <span className="text-slate-900">Crear reporte</span>
            </div>

            <div className="grid gap-5 sm:gap-7 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-7 sm:space-y-8">
                    <section>
                        <h1 className="text-2xl font-black tracking-[-0.03em] text-[#06102c] sm:text-3xl lg:text-[2.8rem]">Crear reporte</h1>
                        <p className="mt-4 max-w-3xl text-[0.92rem] leading-7 text-slate-600 sm:text-[1rem] sm:leading-8">
                            Elegi que queres mirar primero para tomar decisiones claras y mover tu negocio con foco.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#031a44] text-[10px] font-black text-white">01</span>
                            <p className={SECTION_EYEBROW}>Tipo de reporte</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {reportCards.map((card) => {
                                const Icon = card.icon;
                                const active = selectedReport === card.id;
                                return (
                                    <button
                                        key={card.id}
                                        type="button"
                                        onClick={() => setSelectedReport(card.id)}
                                        className={`relative min-h-[142px] rounded-[18px] border p-4 text-left transition sm:min-h-[156px] sm:p-5 ${
                                            active
                                                ? "border-[#031a44] bg-[#031a44] text-white shadow-[0_14px_30px_rgba(3,26,68,0.3)]"
                                                : "border-[#e7e2d9] bg-[#f8f8f7] text-slate-900 hover:border-slate-300"
                                        }`}
                                    >
                                        {card.id === "completo" ? (
                                            <span className={`absolute right-3 top-2 bg-[#b5f3b0] text-[#0d4921] ${CHIP_BASE}`}>
                                                Recomendado
                                            </span>
                                        ) : null}
                                        <Icon className={`mb-10 h-5 w-5 ${active ? "text-[#9fe1a9]" : "text-[#9ca3af]"}`} />
                                        <p className="text-[0.92rem] font-black leading-5 tracking-[-0.01em]">{card.title}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section className="space-y-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#031a44] text-[10px] font-black text-white">02</span>
                            <p className={SECTION_EYEBROW}>Periodo de analisis</p>
                        </div>
                        <div className={`${SURFACE_INSET} bg-white p-2.5 sm:p-3.5`}>
                            <div className="grid gap-2 sm:grid-cols-4">
                                {[
                                    { id: "7d" as const, label: "Ultimos 7 dias" },
                                    { id: "30d" as const, label: "Ultimos 30 dias" },
                                    { id: "mes" as const, label: "Este mes" },
                                    { id: "anterior" as const, label: "Mes anterior" },
                                ].map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        onClick={() => setSelectedRange(option.id)}
                                        className={`rounded-[12px] px-4 py-3 text-[0.84rem] font-bold transition ${
                                            selectedRange === option.id
                                                ? "bg-[#031a44] text-white shadow-[0_8px_16px_rgba(3,26,68,0.25)]"
                                                : "text-slate-700 hover:bg-[#f5f6f8]"
                                        }`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                            <button type="button" className="mt-3 inline-flex items-center gap-2 rounded-[12px] px-3 py-2 text-[0.84rem] font-semibold text-slate-700 hover:bg-[#f5f6f8]">
                                <CalendarDays className="h-4 w-4" />
                                Personalizar rango
                            </button>
                        </div>
                    </section>

                    <section className="space-y-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#031a44] text-[10px] font-black text-white">03</span>
                            <p className={SECTION_EYEBROW}>Contenido del reporte</p>
                        </div>
                        <div className={`${SURFACE_CARD} p-4 sm:p-6`}>
                            <div className="grid gap-6 sm:gap-8 md:grid-cols-2">
                                <div>
                                    <p className="mb-4 inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-500">
                                        <span className="h-1.5 w-1.5 rounded-full bg-[#8be28d]" />
                                        Resultados
                                    </p>
                                    <div className="space-y-3">
                                        {[
                                            "Ventas y facturacion",
                                            "Cancelaciones",
                                            "Reclamos abiertos",
                                            "Estado de reputacion",
                                        ].map((item) => (
                                            <div key={item} className="flex items-start gap-3 text-[0.84rem] font-semibold text-slate-800">
                                                <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-[4px] bg-[#031a44] text-white">
                                                    <Check className="h-3 w-3" />
                                                </span>
                                                <span>{item}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="mb-4 inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-500">
                                        <span className="h-1.5 w-1.5 rounded-full bg-[#8be28d]" />
                                        Operacion
                                    </p>
                                    <div className="space-y-3">
                                        {[
                                            "Tiempos de respuesta",
                                            "Ritmo de despacho",
                                            "Publicaciones criticas",
                                            "Pasos recomendados",
                                        ].map((item) => (
                                            <div key={item} className="flex items-start gap-3 text-[0.84rem] font-semibold text-slate-800">
                                                <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-[4px] bg-[#031a44] text-white">
                                                    <Check className="h-3 w-3" />
                                                </span>
                                                <span>{item}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="space-y-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#031a44] text-[10px] font-black text-white">04</span>
                            <p className={SECTION_EYEBROW}>Foco principal del informe</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {mainQuestions.map((question, index) => {
                                const active = selectedQuestion === index;
                                return (
                                    <button
                                        key={question}
                                        type="button"
                                        onClick={() => setSelectedQuestion(index)}
                                        className={`min-h-[80px] rounded-[16px] border px-5 py-4 text-left text-[0.84rem] font-semibold leading-6 transition ${
                                            active
                                                ? "border-[#0f172a] bg-white text-[#111827] shadow-[0_8px_18px_rgba(15,23,42,0.12)]"
                                                : "border-[#e7e2d9] bg-[#fbfbfb] text-slate-700 hover:border-slate-300"
                                        }`}
                                    >
                                        <span className="inline-flex items-center gap-2">
                                            {active ? <Sparkles className="h-4 w-4" /> : null}
                                            {question}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section className={`overflow-hidden ${SURFACE_CARD}`}>
                        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-5 sm:gap-6 sm:px-6 sm:py-6 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#031a44] text-white shadow-[0_10px_20px_rgba(3,26,68,0.22)]">
                                    <Sparkles className="h-6 w-6" />
                                </span>
                                <div>
                                    <h2 className="text-[1.35rem] font-black tracking-[-0.02em] text-slate-900 sm:text-[1.75rem]">Analisis inteligente</h2>
                                    <p className="mt-1 max-w-xl text-[0.84rem] leading-6 text-slate-600">
                                        Si lo activas, sumamos patrones y alertas utiles para que el reporte te marque prioridades.
                                    </p>
                                </div>
                            </div>
                            <div className="inline-flex w-full rounded-full bg-slate-100 p-1.5 sm:w-auto">
                                        <button
                                    type="button"
                                    onClick={() => setAiEnabled(true)}
                                    className={`flex-1 rounded-full px-5 py-2 text-[0.7rem] font-black uppercase tracking-[0.08em] transition sm:flex-none ${
                                        aiEnabled ? "bg-[#031a44] text-white" : "text-slate-500"
                                    }`}
                                >
                                    Activado
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAiEnabled(false)}
                                    className={`flex-1 rounded-full px-5 py-2 text-[0.7rem] font-black uppercase tracking-[0.08em] transition sm:flex-none ${
                                        !aiEnabled ? "bg-[#031a44] text-white" : "text-slate-500"
                                    }`}
                                >
                                    Desactivado
                                </button>
                            </div>
                        </div>
                        <div className="grid gap-4 px-4 py-5 sm:px-6 sm:py-6 sm:grid-cols-2 lg:grid-cols-3">
                            {[
                                { icon: Search, title: "Hallazgos clave", text: "Te muestra lo mas importante sin leer todo el detalle." },
                                { icon: Target, title: "Patrones", text: "Detecta comportamientos que se repiten en periodos similares." },
                                { icon: MessageSquareWarning, title: "Riesgos", text: "Marca desajustes antes de que peguen en ventas o reputacion." },
                            ].map((item) => {
                                const Icon = item.icon;
                                return (
                                    <div key={item.title} className="min-h-[120px] rounded-[18px] border border-[#ece8df] bg-[#f8f8f8] px-4 py-4">
                                        <Icon className="h-4 w-4 text-slate-500" />
                                        <p className="mt-3 text-[0.84rem] font-black text-slate-900">{item.title}</p>
                                        <p className="mt-2 text-[0.72rem] leading-5 text-slate-600">{item.text}</p>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </div>

                <aside className="order-first min-w-0 lg:order-none lg:sticky lg:top-6 lg:h-fit">
                    <section className="rounded-[24px] border border-[#ded9cf] bg-[linear-gradient(180deg,#ffffff_0%,#f7f8fa_100%)] p-5 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
                        <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-slate-600">Vista previa</p>
                        <div className="mt-4 space-y-2.5">
                            {previewBlocks.map((block) => (
                                <div key={block.title} className="min-h-[72px] rounded-[14px] border border-[#e6e1d8] bg-[#f5f6f8] px-3 py-3">
                        <p className="text-[0.84rem] font-bold text-slate-900">{block.title}</p>
                                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{block.pages}</p>
                                </div>
                            ))}
                        </div>

                        <div className="mt-4 rounded-[16px] border border-[#e6e1d8] bg-[#f5f6f8] px-4 py-4">
                            <p className="text-[0.84rem] leading-6 text-slate-700">
                                Se arma un PDF de <span className="font-black text-slate-900">8 paginas</span> con datos del periodo y pasos recomendados para accionar hoy.
                            </p>
                        </div>

                        <button
                            type="button"
                            className="mt-5 inline-flex w-full items-center justify-center rounded-[16px] bg-[#031a44] px-4 py-3 text-[0.84rem] font-black uppercase tracking-[0.08em] text-white shadow-[0_10px_22px_rgba(3,26,68,0.28)] transition hover:bg-[#021232]"
                        >
                            Generar reporte PDF
                        </button>
                        <button
                            type="button"
                            className="mt-3 inline-flex w-full items-center justify-center rounded-[16px] border border-[#ebe6dc] bg-white px-4 py-3 text-[0.84rem] font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                            Ver antes de descargar
                        </button>
                    </section>
                </aside>
            </div>
        </div>
    );
}
