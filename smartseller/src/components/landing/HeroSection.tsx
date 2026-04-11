"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, DollarSign, MessageCircle, Brain } from "lucide-react";
import Image from "next/image";

export default function HeroSection() {
    return (
        <section className="relative py-16 lg:py-24 overflow-hidden bg-accent text-foreground">
            <div className="max-w-7xl mx-auto px-4 lg:px-8">
                <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
                    {/* Columna de Texto */}
                    <div className="space-y-8 text-center lg:text-left">
                        <div className="flex justify-center lg:justify-start mb-6">
                            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/20 border border-primary/40 text-primary text-sm font-bold uppercase tracking-wider">
                                Reducís pérdidas económicas día a día.
                            </div>
                        </div>

                        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight">
                            Dejá de perder capital por errores que no ves.
                            <br />
                            <span className="text-primary block mt-2">
                                SmartSeller te avisa por WhatsApp a tiempo para corregir desvíos.
                            </span>
                        </h1>

                        <p className="text-base lg:text-lg text-foreground mx-auto lg:mx-0 max-w-xl">
                            Te conectás en un minuto a Mercado Libre.
                            Recibís alertas instantáneas cuando algo anda mal.
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-xl mx-auto lg:mx-0">
                            <div className="flex items-start gap-3 text-left">
                                <DollarSign className="h-6 w-6 text-primary mt-1 flex-shrink-0" />
                                <div>
                                    <p className="font-semibold text-foreground">
                                        Cuidás el capital de tu negocio.
                                    </p>
                                    <p className="text-foreground text-sm leading-snug">
                                        El márgen de tiempo justo antes de que el daño esté hecho.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3 text-left">
                                <MessageCircle className="h-6 w-6 text-primary mt-1 flex-shrink-0" />
                                <div>
                                    <p className="font-semibold text-foreground">
                                        Alertas por WhatsApp
                                    </p>
                                    <p className="text-foreground text-sm leading-snug">
                                        Mensaje directo al celular para reaccionar rápido.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3 text-left sm:col-span-2">
                                <Brain className="h-6 w-6 text-primary mt-1 flex-shrink-0" />
                                <div>
                                    <p className="font-semibold text-foreground">
                                        No necesitás cambiar tu forma de trabajar.
                                    </p>
                                    <p className="text-foreground text-sm leading-snug">
                                        SmartSeller monitorea por vos.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 flex flex-col items-center lg:items-start">
                            <Link href="/enter">
                                <Button className="bg-primary hover:bg-primary/90 h-14 sm:h-16 px-8 sm:px-10 rounded-xl text-lg sm:text-xl font-bold shadow-xl transition-all hover:scale-105 group w-full sm:w-auto">
                                    Probá 30 días GRATIS ahora
                                    <ArrowRight className="ml-3 h-6 w-6 group-hover:translate-x-2 transition-transform" />
                                </Button>
                            </Link>
                            <p className="text-sm text-foreground mt-3">
                                Sin tarjeta • Cancelá cuando quieras • Empezás hoy
                            </p>
                        </div>
                    </div>

                    {/* Imagen */}
                    <div className="relative flex items-center justify-center lg:justify-end mx-auto mt-8 lg:mt-0 w-full">
                        <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full opacity-50 scale-110 -z-10"></div>
                        <div className="relative z-10 w-full max-w-lg lg:max-w-none h-[400px] sm:h-[500px]">
                            <Image
                                src="/images/vendedor.jpg"
                                alt="Vendedor argentino sacando provecho de SmartSeller"
                                fill
                                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                className="object-cover rounded-2xl shadow-2xl border border-black/5 hover:shadow-primary/20 transition-shadow duration-500 lg:-mr-8"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
