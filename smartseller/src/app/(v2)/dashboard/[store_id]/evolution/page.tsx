"use client";

import { useState } from "react";
import { ArrowUpRight, Settings, ShieldCheck, TrendingUp, Wrench } from "lucide-react";

const FILTERS = ["7D", "15D", "30D", "90D"] as const;

export default function EvolutionPage() {
    const [timeRange, setTimeRange] = useState<(typeof FILTERS)[number]>("90D");

    const milestones = [
        { date: "May 10", title: "Optimizacion de publicaciones", detail: "Mejor visibilidad", icon: Settings, tone: "bg-[#d06b2d]" },
        { date: "Jun 05", title: "Soporte prioritario", detail: "Resolucion rapida", icon: ShieldCheck, tone: "bg-[#2463eb]" },
        { date: "Jun 20", title: "Ajuste de precios", detail: "Competitividad", icon: Wrench, tone: "bg-[#c45f2b]" },
        { date: "Jul 12", title: "Revision de cuenta", detail: "Limpieza de publicaciones", icon: TrendingUp, tone: "bg-[#0f2347]" },
    ];

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
            <section className="rounded-[28px] bg-[#0f2347] px-6 py-7 text-white shadow-[0_24px_60px_rgba(15,35,71,0.24)]">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h1 className="mt-2 text-4xl font-black tracking-tight">Evolucion del rendimiento</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-200">
                            Seguimiento historico del score, cambios recientes y hitos aplicados para sostener el negocio en una trayectoria estable.
                        </p>
                    </div>

                    <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/5 p-3 sm:grid-cols-2">
                        <div className="rounded-[20px] bg-white px-5 py-4 text-[#0f2347]">
                            <p className="text-sm font-semibold text-slate-500">Score actual</p>
                            <div className="mt-2 flex items-end gap-3">
                                <span className="text-5xl font-black tracking-tight">92</span>
                                <span className="pb-2 text-lg font-bold text-slate-700">En orden</span>
                            </div>
                        </div>
                        <div className="rounded-[20px] bg-white px-5 py-4 text-[#0f2347]">
                            <p className="text-sm font-semibold text-slate-500">Variacion</p>
                            <div className="mt-2 flex items-center gap-2 text-[#0d8f95]">
                                <span className="text-5xl font-black tracking-tight">+5.4</span>
                                <ArrowUpRight className="h-8 w-8" />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="space-y-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h2 className="text-3xl font-black tracking-tight text-slate-900">Evolucion del rendimiento (historial)</h2>
                        <p className="mt-1 text-sm text-slate-600">Filtros para revisar tendencia y accion aplicada.</p>
                    </div>
                    <div className="flex w-full gap-2 rounded-full bg-white p-2 shadow-[0_14px_30px_rgba(15,23,42,0.06)] sm:w-auto">
                        {FILTERS.map((filter) => (
                            <button
                                key={filter}
                                type="button"
                                onClick={() => setTimeRange(filter)}
                                className={`rounded-full px-5 py-2 text-sm font-bold transition ${
                                    timeRange === filter ? "bg-[#2e7db9] text-white shadow-sm" : "text-slate-700 hover:bg-slate-100"
                                }`}
                            >
                                {filter}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                    <h3 className="mb-4 text-2xl font-black tracking-tight text-slate-900">Rendimiento a lo largo del tiempo</h3>
                    <div className="overflow-x-auto">
                        <div className="min-w-[720px] rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f4f9fe_100%)] p-4">
                            <svg viewBox="0 0 920 330" className="h-[320px] w-full">
                                {[40, 90, 140, 190, 240, 290].map((y) => (
                                    <line key={y} x1="60" y1={y} x2="880" y2={y} stroke="#d5e1ee" strokeWidth="1.6" />
                                ))}
                                {[60, 190, 330, 470, 610, 750, 880].map((x) => (
                                    <line key={x} x1={x} y1="40" x2={x} y2="290" stroke="#d5e1ee" strokeWidth="1.2" />
                                ))}
                                <defs>
                                    <linearGradient id="evolutionFill" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#1a90a6" stopOpacity="0.45" />
                                        <stop offset="100%" stopColor="#1a90a6" stopOpacity="0.04" />
                                    </linearGradient>
                                </defs>
                                <path d="M60 280 C120 220, 160 170, 250 185 S360 260, 440 160 S560 180, 650 110 S750 220, 880 55 L880 290 L60 290 Z" fill="url(#evolutionFill)" />
                                <path d="M60 280 C120 220, 160 170, 250 185 S360 260, 440 160 S560 180, 650 110 S750 220, 880 55" fill="none" stroke="#117f92" strokeWidth="8" strokeLinecap="round" />
                                {[150, 410, 530, 705, 880].map((x, index) => {
                                    const yValues = [178, 162, 162, 200, 55];
                                    return <circle key={x} cx={x} cy={yValues[index]} r="9" fill="#fff" stroke="#0f2347" strokeWidth="3" />;
                                })}
                                {["100", "80", "60", "40", "20", "0"].map((label, index) => (
                                    <text key={label} x="20" y={44 + index * 50} fill="#475569" fontSize="16" fontWeight="700">
                                        {label}
                                    </text>
                                ))}
                                {["May 01", "May 15", "Jun 01", "Jun 15", "Jul 01", "Jul 15", "Aug 01"].map((label, index) => (
                                    <text key={label} x={42 + index * 136} y="320" fill="#334155" fontSize="18" fontWeight="700">
                                        {label}
                                    </text>
                                ))}
                            </svg>
                        </div>
                    </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                    <h3 className="mb-6 text-2xl font-black tracking-tight text-slate-900">Acciones aplicadas</h3>
                    <div className="overflow-x-auto">
                        <div className="min-w-[760px]">
                            <div className="relative h-16 rounded-full bg-[#0f2347] px-10">
                                <div className="flex h-full items-center justify-between text-sm font-bold text-slate-200">
                                    <span>May 01</span>
                                    <span>May 15</span>
                                    <span>Jun 01</span>
                                    <span>Jun 15</span>
                                    <span>Jul 01</span>
                                    <span>Jul 15</span>
                                    <span>Aug 01</span>
                                </div>
                                <div className="pointer-events-none absolute inset-0">
                                    {milestones.map((milestone, index) => {
                                        const Icon = milestone.icon;
                                        const positions = ["18%", "42%", "58%", "80%"];
                                        return (
                                            <div key={milestone.title} className="absolute top-0" style={{ left: positions[index] }}>
                                                <div className="-translate-x-1/2">
                                                    <div className={`mx-auto -mt-5 flex h-12 w-12 items-center justify-center rounded-full border-4 border-white text-white shadow-lg ${milestone.tone}`}>
                                                        <Icon className="h-5 w-5" />
                                                    </div>
                                                    <div className="mx-auto h-16 w-[2px] bg-[#c96a34]" />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="grid gap-4 pt-10 sm:grid-cols-2 xl:grid-cols-4">
                                {milestones.map((milestone) => (
                                    <div key={milestone.title} className="text-center">
                                        <p className="text-sm font-black text-slate-900">{milestone.date}: {milestone.title}</p>
                                        <p className="text-sm text-slate-600">({milestone.detail})</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
