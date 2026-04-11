import {
    Thermometer,
    Truck,
    ShieldAlert,
    Tag,
    PackageX,
    Activity
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MonitoringGrid() {
    const monitoringCards = [
        {
            title: "Atención y Reputación",
            icon: Thermometer,
            items: [
                "Pregunta olvidada: El cliente se enfría. Te avisamos si tardas más de 2 horas en responder.",
                "Alerta en el termómetro: Aviso matemático anticipado antes de que Mercado Libre baje tu color.",
            ]
        },
        {
            title: "Envíos y Despachos",
            icon: Truck,
            items: [
                "Te corre el reloj (SLA): Avisos a las 6h, 2h y 30m antes de tu horario de corte para despachar.",
                "Venta estancada: Órdenes ya pagadas que tu equipo aún no ha comenzado a preparar.",
            ]
        },
        {
            title: "Reclamos y Cancelaciones",
            icon: ShieldAlert,
            items: [
                "Reclamo en puerta: Detectamos fricciones en la mensajería antes de que el cliente inicie una mediación.",
                "Riesgo de cancelación: Tu tasa de cancelaciones sube (por falta de stock) y arriesgas una penalización.",
            ]
        },
        {
            title: "Competitividad de Precios",
            icon: Tag,
            items: [
                "Precio desfasado: Quedaste fuera de precio frente a tu competencia directa y pierdes visitas.",
                "Movimiento rival: Te avisamos al instante si un competidor clave baja su precio.",
            ]
        },
        {
            title: "Stock y Publicaciones",
            icon: PackageX,
            items: [
                "Stock en rojo: Cálculo real de los días que te quedan antes de que la publicación se pause.",
                "Caída de exposición: Alerta si las visitas a tus productos se desploman de un momento a otro.",
            ]
        },
        {
            title: "Salud de la Cuenta",
            icon: Activity,
            items: [
                "Pausa inusual: Cero ventas o preguntas en tu horario pico. Posible pérdida de visibilidad.",
                "Resumen del día: Un reporte claro con los paquetes que debes despachar hoy sin falta.",
            ]
        }
    ];

    return (
        <section className="py-24 bg-slate-50 border-y border-slate-200">
            <div className="max-w-7xl mx-auto px-4">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-12">
                    Protección 360° para tu cuenta de Mercado Libre
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
                    {monitoringCards.map((card, i) => (
                        <Card key={i} className="bg-white border-slate-200 hover:border-primary/50 transition-colors shadow-sm">
                            <CardHeader className="flex flex-row items-center gap-3 pb-2">
                                <card.icon className="w-8 h-8 text-primary shrink-0" />
                                <CardTitle className="text-xl font-semibold text-foreground">
                                    {card.title}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-4 text-slate-600">
                                    {card.items.map((item, idx) => {
                                        const [boldPart, ...rest] = item.split(': ');
                                        return (
                                            <li key={idx} className="text-sm leading-relaxed">
                                                <span className="font-semibold text-foreground">{boldPart}:</span>{" "}
                                                {rest.join(': ')}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                <div className="bg-white p-6 md:p-8 rounded-2xl border border-primary/20 bg-primary/5 text-center shadow-sm">
                    <p className="text-foreground font-medium text-lg max-w-4xl mx-auto">
                        <span className="font-bold text-primary">Alertas filtradas por gravedad.</span> Con las Quiet Hours de SmartSeller, silencia las notificaciones de noche y haz que el teléfono suene solo ante emergencias reales que pongan en riesgo tu reputación.
                    </p>
                </div>
            </div>
        </section>
    );
}
