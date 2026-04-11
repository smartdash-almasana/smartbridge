import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldCheck } from "lucide-react";

export default function VigilantSection() {
    return (
        <section className="relative py-16 sm:py-20 overflow-hidden bg-accent">
            <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-96 h-96 bg-indigo-500/30 rounded-full blur-3xl pointer-events-none"></div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
                    {/* Columna de Imagen */}
                    <div className="relative order-1 lg:order-1">
                        <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/30 to-blue-500/30 blur-2xl rounded-3xl transform -rotate-2 scale-105 -z-10"></div>
                        <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-black/5 bg-black/5 backdrop-blur-sm z-10">
                            <Image
                                src="/assets/vendedora3.webp"
                                alt="Vendedor operando tranquilo con SmartSeller"
                                width={600}
                                height={400}
                                className="w-full h-auto object-cover"
                                priority
                            />
                            <div className="absolute inset-0 bg-indigo-900/10 mix-blend-multiply"></div>
                        </div>
                    </div>

                    {/* Columna de Texto */}
                    <div className="space-y-6 order-2 lg:order-2">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-800/50 text-foreground text-xs font-medium border border-indigo-700/50">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Protección 24/7</span>
                        </div>

                        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-foreground leading-tight">
                            SmartSeller es un sistema que monitorea tu negocio de forma continua.
                        </h2>

                        <div className="space-y-4 text-base text-foreground/90 leading-relaxed">
                            <p>
                                Vigila tus números 24/7, te avisa solo cuando hay peligro para ahorrarte muchos problemas.
                            </p>
                            <p className="text-lg font-semibold text-foreground">
                                Vos seguís creciendo. Él protege tus intereses.
                            </p>
                        </div>

                        <div className="pt-2 space-y-3">
                            <Link href="#wizard" className="inline-block w-full sm:w-auto">
                                <Button
                                    size="lg"
                                    className="bg-primary hover:bg-primary/90 text-white font-bold text-base px-6 py-6 h-auto w-full sm:w-auto rounded-xl shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] group whitespace-normal"
                                >
                                    <span className="flex items-center justify-center gap-2">
                                        Probá 30 días GRATIS ahora (sin tarjeta)
                                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform shrink-0" />
                                    </span>
                                </Button>
                            </Link>
                            <p className="text-xs text-indigo-300/80 font-medium text-center sm:text-left">
                                Cancelás cuando quieras • Sin contratos • Empezás hoy
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
