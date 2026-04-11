import React, { useState } from "react";
import {
    Check,
    ArrowRight,
    ShieldCheck,
    MessageSquare,
    Database,
    FileText,
    ArrowLeft,
    Loader2,
    Mail,
    LayoutGrid,
    BarChart3,
    AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Tipos de datos
type FormData = {
    system: string;
    priority: string;
    channel: string;
    contact: string;
};

const initialFormData: FormData = {
    system: "",
    priority: "",
    channel: "",
    contact: "",
};

const totalSteps = 4;

export default function WizardForm() {
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState<FormData>(initialFormData);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSubmitted, setIsSubmitted] = useState(false);

    const updateData = (fields: Partial<FormData>) => {
        setFormData((prev) => ({ ...prev, ...fields }));
    };

    const nextStep = () => {
        if (step < totalSteps) {
            setStep(step + 1);
        } else if (step === totalSteps) {
            handleSubmit();
        }
    };

    const prevStep = () => {
        setStep(Math.max(step - 1, 1));
    };

    const progress = (step / totalSteps) * 100;

    const handleSubmit = () => {
        setIsSubmitting(true);
        // V2 PLAN: No server-side persistence yet. Mocking success for the landing.
        setTimeout(() => {
            setIsSubmitting(false);
            setIsSubmitted(true);
            console.log("Diagnóstico Finalizado:", formData);
        }, 1500);
    };

    // Opciones
    const step1Options = [
        { id: "ml", label: "Mercado Libre", icon: LayoutGrid },
        { id: "tango", label: "Tango Gestión", icon: Database },
        { id: "excel", label: "Excel / CSV", icon: FileText },
        { id: "otros", label: "Otros sistemas", icon: BarChart3 },
    ];

    const step2Options = [
        {
            id: "stock",
            label: "Quiebres de stock que me hacen perder ventas",
            icon: AlertTriangle
        },
        {
            id: "reputacion",
            label: "Bloqueo de cuenta por reputación",
            icon: ShieldCheck,
        },
        {
            id: "ventas",
            label: "Caídas de ventas que no veo venir",
            icon: BarChart3,
        },
    ];

    const step3Options = [
        { id: "wa", label: "WhatsApp (llega al toque)", icon: MessageSquare },
        { id: "email", label: "Email", icon: Mail },
    ];

    if (isSubmitted) {
        return (
            <div className="min-h-[400px] flex flex-col items-center justify-center text-center p-6 sm:p-8 bg-slate-50 rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/50">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-md">
                    <Check className="w-8 h-8 sm:w-10 sm:h-10 text-primary" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">
                    ¡Listo! Tu primera alerta está en camino
                </h2>
                <p className="text-base sm:text-lg text-slate-600 max-w-md leading-relaxed">
                    En minutos vas a recibir un ejemplo real por <strong>{formData.channel}</strong>.<br /><br />
                    Vas a ver exactamente cómo SmartSeller te avisa antes de que pierdas guita.<br />
                    Gratis, sin compromiso y sin cambiar nada de tu laburo.
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-xl w-full mx-auto p-4 sm:p-8 rounded-2xl border border-slate-200 bg-slate-50 shadow-xl shadow-slate-200/40">
            <div className="mb-8 sm:mb-10">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 gap-2">
                    <span className="text-foreground text-sm font-bold tracking-widest uppercase flex items-center gap-2">
                        <span className="bg-accent text-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0">
                            {step}
                        </span>
                        Paso {step} de {totalSteps}
                    </span>
                    <span className="text-primary text-xs font-semibold bg-white px-2 py-1 rounded-md shadow-sm border border-slate-100">
                        🚀 60 segundos y listo
                    </span>
                </div>
                <div className="w-full h-2 bg-white rounded-full overflow-hidden shadow-inner border border-slate-100">
                    <div
                        className="h-full bg-gradient-to-r from-primary to-primary/80 transition-all duration-500 ease-out rounded-full"
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
            </div>

            <div className="min-h-[320px] flex flex-col justify-start">
                {step === 1 && (
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <h2 className="text-xl sm:text-2xl font-bold text-foreground">
                                ¿Con qué sistema laburás hoy?
                            </h2>
                            <p className="text-slate-600 text-sm sm:text-base">
                                SmartSeller se conecta directo a lo que ya usás. Elegí el principal.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:gap-4">
                            {step1Options.map((item) => {
                                const isSelected = formData.system === item.label;
                                return (
                                    <Button
                                        key={item.id}
                                        onClick={() => {
                                            updateData({ system: item.label });
                                            nextStep();
                                        }}
                                        variant="outline"
                                        className={`group h-auto min-h-[7rem] py-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 transition-all duration-200 hover:scale-[1.02] whitespace-normal
                      ${isSelected
                                                ? "border-primary bg-white text-foreground shadow-md ring-1 ring-primary/50"
                                                : "border-slate-300 bg-white text-slate-600 hover:bg-accent hover:border-foreground hover:text-foreground"
                                            }`}
                                    >
                                        <item.icon className={`w-8 h-8 shrink-0 transition-colors ${isSelected ? "text-primary" : "text-slate-700 group-hover:text-foreground"}`} />
                                        <span className="font-semibold text-xs sm:text-sm text-center leading-tight">{item.label}</span>
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <h2 className="text-xl sm:text-2xl font-bold text-foreground">
                                ¿Qué te está quitando el sueño hoy?
                            </h2>
                            <p className="text-slate-600 text-sm sm:text-base">
                                Elegí el problema que más guita te está costando.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:gap-4">
                            {step2Options.map((item) => {
                                const isSelected = formData.priority === item.label;
                                return (
                                    <Button
                                        key={item.id}
                                        onClick={() => {
                                            updateData({ priority: item.label });
                                            nextStep();
                                        }}
                                        variant="outline"
                                        className={`group h-auto py-4 px-4 sm:px-6 flex items-center justify-start gap-3 sm:gap-5 rounded-xl border-2 transition-all duration-200 whitespace-normal
                      ${isSelected
                                                ? "border-primary bg-white text-foreground shadow-md ring-1 ring-primary/50"
                                                : "border-slate-300 bg-white text-slate-600 hover:bg-accent hover:border-foreground hover:text-foreground"
                                            }`}
                                    >
                                        <div className={`p-2 rounded-lg shrink-0 transition-colors ${isSelected ? "bg-primary/10" : "bg-slate-100 group-hover:bg-black/10"}`}>
                                            <item.icon className={`w-5 h-5 sm:w-6 sm:h-6 transition-colors ${isSelected ? "text-primary" : "text-slate-500 group-hover:text-foreground"}`} />
                                        </div>
                                        <span className="font-semibold text-sm sm:text-base text-left leading-tight">
                                            {item.label}
                                        </span>
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <h2 className="text-xl sm:text-2xl font-bold text-foreground">
                                ¿Cómo querés que te avisemos?
                            </h2>
                            <p className="text-slate-600 text-sm sm:text-base">
                                Recomendamos WhatsApp: llega al instante y actuás ya.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:gap-4">
                            {step3Options.map((item) => {
                                const isSelected = formData.channel === item.label;
                                return (
                                    <Button
                                        key={item.id}
                                        onClick={() => {
                                            updateData({ channel: item.label });
                                            nextStep();
                                        }}
                                        variant="outline"
                                        className={`group h-auto min-h-[7rem] py-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 transition-all duration-200 whitespace-normal
                      ${isSelected
                                                ? "border-primary bg-white text-foreground shadow-md ring-1 ring-primary/50"
                                                : "border-slate-300 bg-white text-slate-600 hover:bg-accent hover:border-foreground hover:text-foreground"
                                            }`}
                                    >
                                        <item.icon className={`w-8 h-8 shrink-0 transition-colors ${isSelected ? "text-primary" : "text-slate-700 group-hover:text-foreground"}`} />
                                        <span className="font-semibold text-xs sm:text-sm text-center leading-tight">{item.label}</span>
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {step === 4 && (
                    <div className="space-y-6">
                        <div className="p-4 sm:p-5 bg-white rounded-xl border border-primary/20 flex gap-3 sm:gap-4 items-start shadow-sm">
                            <ShieldCheck className="w-6 h-6 sm:w-8 sm:h-8 text-primary mt-1 shrink-0" />
                            <div>
                                <h2 className="text-base sm:text-lg font-bold text-foreground mb-1">
                                    Tu protección arranca en segundos
                                </h2>
                                <p className="text-sm text-slate-600 leading-snug">
                                    Dejanos tu {formData.channel.includes("WhatsApp") ? "celular" : "email"} y en minutos te mandamos tu primera alerta real. Gratis y sin compromiso.
                                </p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <label className="text-sm font-semibold text-foreground ml-1">
                                {formData.channel.includes("WhatsApp") ? "Número de WhatsApp" : "Email"}
                            </label>
                            <Input
                                type={formData.channel.includes("WhatsApp") ? "tel" : "email"}
                                placeholder={
                                    formData.channel.includes("WhatsApp")
                                        ? "+54 9 11 1234 5678"
                                        : "tuemail@empresa.com"
                                }
                                value={formData.contact}
                                onChange={(e) => updateData({ contact: e.target.value })}
                                className="w-full h-12 sm:h-14 text-base sm:text-lg px-4 rounded-xl bg-white border-2 border-slate-200 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all placeholder:text-foreground"
                            />

                            <Button
                                onClick={nextStep}
                                disabled={isSubmitting || formData.contact.length < 5}
                                className="w-full h-12 sm:h-14 bg-primary hover:bg-primary/90 text-white text-base sm:text-lg font-bold rounded-xl shadow-lg shadow-primary/20 transition-all transform active:scale-[0.98]"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin mr-2" />
                                        Activando...
                                    </>
                                ) : (
                                    <span className="flex items-center justify-center">
                                        Recibir mi alerta GRATIS ahora
                                        <ArrowRight className="w-5 h-5 sm:w-6 sm:h-6 ml-2" />
                                    </span>
                                )}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {step >= 1 && step <= totalSteps && (
                <div className="mt-6 sm:mt-8 pt-6 border-t border-slate-200 flex justify-between items-center">
                    {step > 1 ? (
                        <Button
                            onClick={prevStep}
                            variant="ghost"
                            className="flex items-center gap-2 text-slate-500 hover:text-foreground hover:bg-slate-100 px-2 text-sm"
                        >
                            <ArrowLeft className="w-4 h-4" /> Atrás
                        </Button>
                    ) : (
                        <span />
                    )}

                    <p className="flex items-center gap-1.5 text-[10px] sm:text-xs text-slate-500 font-medium text-right sm:text-left">
                        <ShieldCheck className="w-3 h-3 shrink-0" />
                        Privacidad total • No vemos ventas ni precios
                    </p>
                </div>
            )}
        </div>
    );
}
