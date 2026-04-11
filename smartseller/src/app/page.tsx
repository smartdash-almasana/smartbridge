"use client";

import HeroSection from "@/components/landing/HeroSection";
import VigilantSection from "@/components/landing/VigilantSection";
import MonitoringGrid from "@/components/landing/MonitoringGrid";
import ComparisonSection from "@/components/landing/ComparisonSection";
import { Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";

function FAQItem({ question, answer }: { question: string; answer: string }) {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className="border border-slate-200 rounded-lg overflow-hidden hover:border-primary/50 transition-all bg-white shadow-sm">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
            >
                <span className="font-semibold text-foreground text-left">
                    {question}
                </span>
                <span
                    className={`text-primary transition-transform ${isOpen ? "rotate-180" : ""}`}
                >
                    ▼
                </span>
            </button>
            {isOpen && (
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 text-slate-600">
                    {answer}
                </div>
            )}
        </div>
    );
}

export default function Home() {
    return (
        <div className="min-h-screen bg-white text-slate-900 selection:bg-primary/30">
            <main>
                <HeroSection />

                <MonitoringGrid />

                <ComparisonSection />

                <section className="py-24 bg-white border-y border-slate-200">
                    <div className="max-w-7xl mx-auto px-4">
                        <div className="text-center mb-16">
                            <h2 className="text-4xl lg:text-5xl font-bold text-foreground">
                                +127 vendedores ya gestionan sus riesgos con SmartSeller
                            </h2>
                        </div>

                        <div className="grid md:grid-cols-3 gap-8">
                            {[
                                {
                                    name: "Juan P. – Seller",
                                    stars: 5,
                                    text: "Evité un bloqueo que me hubiera costado una fortuna. La alerta de reputación llegó justo a tiempo.",
                                },
                                {
                                    name: "María L. – PYME",
                                    stars: 5,
                                    text: "Detectó desvíos que no veía. Recuperé capital en un mes. Ahora duermo tranquila.",
                                },
                                {
                                    name: "Carlos R. – Multi-canal",
                                    stars: 5,
                                    text: "El stock crítico me salvó de perder ventas importantes. Lo mejor: no cambié nada de mi sistema.",
                                },
                            ].map((testimonial, i) => (
                                <Card key={i} className="bg-slate-50 border-slate-200">
                                    <CardContent className="pt-8">
                                        <div className="flex mb-4">
                                            {[...Array(testimonial.stars)].map((_, idx) => (
                                                <Star
                                                    key={idx}
                                                    className="h-5 w-5 fill-primary text-primary"
                                                />
                                            ))}
                                        </div>
                                        <p className="text-slate-700 italic mb-6">
                                            "{testimonial.text}"
                                        </p>
                                        <div className="flex items-center gap-3">
                                            <div className="bg-gray-200 rounded-full w-12 h-12" />
                                            <p className="font-semibold text-foreground">
                                                {testimonial.name}
                                            </p>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                </section>

                <VigilantSection />

                <section className="py-24 bg-slate-50">
                    <div className="max-w-3xl mx-auto px-4">
                        <div className="text-center mb-16">
                            <h2 className="text-3xl font-bold text-foreground">
                                Preguntas Frecuentes
                            </h2>
                        </div>
                        <div className="space-y-4">
                            {[
                                {
                                    q: "¿Cómo recibo las alertas?",
                                    a: "Por WhatsApp al instante. También por email si preferís. Vos elegís el canal.",
                                },
                                {
                                    q: "¿Funciona con mi sistema?",
                                    a: "Sí, se integra con Mercado Libre, Tango Gestión, Excel y otros canales de venta.",
                                },
                                {
                                    q: "¿Cuánto cuesta?",
                                    a: "30 días gratis para probar. Planes desde $29/mes según volumen.",
                                },
                                {
                                    q: "¿Puedo cancelar cuando quiera?",
                                    a: "Sí, sin contratos. Cancelás con un clic.",
                                },
                            ].map((faq, i) => (
                                <FAQItem key={i} question={faq.q} answer={faq.a} />
                            ))}
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}
