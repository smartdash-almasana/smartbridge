import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ConditionalHeader, ConditionalFooter } from "@/components/layout/ConditionalWrapper";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://www.smartseller.io'),
    title: "SmartSeller | Inteligencia para Vendedores",
    description: "Plataforma de seguridad operativa y análisis de riesgos para vendedores de Mercado Libre.",
    openGraph: {
        title: "SmartSeller | Inteligencia para Vendedores",
        description: "Diagnóstico GRATIS en 60 segundos. Medí dónde se te va la plata y qué podés ajustar en tu operación.",
        url: "https://www.smartseller.vercel.app",
        siteName: "SmartSeller",
        images: [
            {
                url: "/og-image.jpg",
                width: 1200,
                height: 630,
                alt: "SmartSeller Previene",
            },
        ],
        locale: "es_AR",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "SmartSeller | Inteligencia para Vendedores",
        description: "Sistema clínico-preventivo de alertas y notificaciones para vendedores de Mercado Libre ",
        images: ["/og-image.jpg"],
    },
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="es" className="scroll-smooth">
            <body className={`${inter.className} min-h-screen flex flex-col antialiased bg-background text-foreground`}>
                <ConditionalHeader />
                <main className="flex-grow">
                    {children}
                </main>
                <ConditionalFooter />
            </body>
        </html>
    );
}
