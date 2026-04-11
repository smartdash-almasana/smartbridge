import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    AlertCircle,
    ArrowRight,
    ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function ComparisonSection() {
    return (
        <section className="py-20 bg-white border-y border-slate-200">
            <div className="max-w-7xl mx-auto px-4">
                <div className="text-center mb-12">
                    <h2 className="text-4xl lg:text-5xl font-bold mb-4 text-foreground">
                        Una semana operando a ciegas vs. teniendo un copiloto que cuida tu capital
                    </h2>
                    <p className="text-slate-600 max-w-3xl mx-auto text-lg">
                        Esto no es teoría. Es lo que les pasa a miles de vendedores todos los días. Elegí en qué lado querés estar.
                    </p>
                </div>

                <div className="grid md:grid-cols-2 gap-8">
                    {/* Sin SmartSeller */}
                    <Card className="border-red-500/50 bg-[#1a0505] shadow-xl relative overflow-hidden text-red-50">
                        <CardHeader className="relative z-10 border-b border-red-900/30 pb-6">
                            <CardTitle className="flex items-center gap-3 text-2xl text-red-400">
                                <AlertCircle className="h-8 w-8 text-red-500" />
                                Sin SmartSeller
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6 relative z-10 pt-6">
                            <div className="space-y-6">
                                <div className="border-l-4 border-red-600 pl-5">
                                    <p className="font-bold text-white text-lg">Lunes – Falta de stock inesperada</p>
                                    <p className="text-red-200 text-sm mt-1 mb-2">
                                        El producto que más vendés se agotó el finde. Seguís recibiendo pedidos, los cancelás y la reputación se te va al piso.
                                    </p>
                                    <p className="text-red-400 font-bold bg-red-950/50 inline-block px-2 py-1 rounded border border-red-900/50">
                                        💸 Pérdida de ventas y reputación
                                    </p>
                                </div>

                                <div className="border-l-4 border-red-600 pl-5">
                                    <p className="font-bold text-white text-lg">Miércoles – Pérdida de oportunidades</p>
                                    <p className="text-red-200 text-sm mt-1 mb-2">
                                        Bajaron las ventas de golpe. Te das cuenta semanas después.
                                    </p>
                                    <p className="text-red-400 font-bold bg-red-950/50 inline-block px-2 py-1 rounded border border-red-900/50">
                                        💸 Desvío hacia competidores
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Con SmartSeller */}
                    <Card className="border-emerald-500/50 bg-[#021a12] shadow-xl relative overflow-hidden text-emerald-50">
                        <CardHeader className="relative z-10 border-b border-emerald-900/30 pb-6">
                            <CardTitle className="flex items-center gap-3 text-2xl text-emerald-400">
                                <ShieldCheck className="h-8 w-8 text-emerald-500" />
                                Con SmartSeller
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6 relative z-10 pt-6">
                            <div className="space-y-6">
                                <div className="border-l-4 border-emerald-500 pl-5">
                                    <p className="font-bold text-white text-lg">Lunes 9:30 AM – Alerta por WhatsApp</p>
                                    <p className="text-emerald-200 text-sm mt-1 mb-2">
                                        "⚠️ Stock crítico: quedan 5 unidades. Reabastecé para evitar quiebres."
                                    </p>
                                    <p className="text-emerald-400 font-bold bg-emerald-950/50 inline-block px-2 py-1 rounded border border-emerald-900/50 flex items-center gap-2">
                                        ✅ Resolvés el faltante
                                    </p>
                                </div>

                                <div className="border-l-4 border-emerald-500 pl-5">
                                    <p className="font-bold text-white text-lg">Miércoles 2 PM – Alerta por WhatsApp</p>
                                    <p className="text-emerald-200 text-sm mt-1 mb-2">
                                        "📉 Ventas bajaron más de lo habitual. Revisá precios y competencia."
                                    </p>
                                    <p className="text-emerald-400 font-bold bg-emerald-950/50 inline-block px-2 py-1 rounded border border-emerald-900/50 flex items-center gap-2">
                                        ✅ Recuperás competitividad
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="mt-16 p-6 sm:p-10 rounded-2xl bg-slate-900 text-white text-center shadow-2xl">
                    <h3 className="text-3xl lg:text-4xl font-bold mb-6">
                        Con una inversión muy baja, evitás pérdidas muy altas.
                    </h3>
                    <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto mb-8">
                        <div>
                            <p className="text-slate-400 text-sm mb-2 uppercase tracking-wider font-semibold">Costo</p>
                            <p className="text-4xl font-bold text-white">desde $29/mes</p>
                        </div>
                        <div>
                            <p className="text-slate-400 text-sm mb-2 uppercase tracking-wider font-semibold">Ahorro Evitado</p>
                            <p className="text-5xl font-bold text-emerald-400">$8.000+</p>
                        </div>
                        <div>
                            <p className="text-slate-400 text-sm mb-2 uppercase tracking-wider font-semibold">ROI</p>
                            <p className="text-5xl font-bold text-primary">250x+</p>
                        </div>
                    </div>

                    <div className="flex w-full justify-center">
                        <Link href="#wizard" className="w-full md:w-max">
                            <Button
                                size="lg"
                                className="bg-primary hover:bg-primary/90 h-auto min-h-[4rem] px-4 py-4 md:px-8 md:py-3 w-full md:w-max rounded-xl text-sm md:text-base text-center font-bold group shadow-lg shadow-primary/20"
                            >
                                <span className="flex items-center justify-center gap-2">
                                    Probá 30 días GRATIS ahora!
                                    <ArrowRight className="h-5 w-5 md:h-6 md:w-6 group-hover:translate-x-2 transition-transform shrink-0" />
                                </span>
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    );
}
