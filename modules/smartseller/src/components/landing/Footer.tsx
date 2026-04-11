import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Mail, MessageCircle, Github, Twitter, Linkedin } from 'lucide-react';

export default function Footer() {
    const currentYear = new Date().getFullYear();

    const footerSections = [
        {
            title: 'Producto',
            links: [
                { label: 'Características', href: '#alerts' },
                { label: 'Planes y Precios', href: '#pricing' },
                { label: 'Diagnóstico Gratuito', href: '#wizard' },
            ],
        },
        {
            title: 'Soporte',
            links: [
                { label: 'Centro de Ayuda', href: '#' },
                { label: 'Documentación', href: '#' },
            ],
        },
    ];

    const integrations = [
        { name: 'Mercado Libre', icon: '🛒' },
        { name: 'Tango', icon: '📊' },
        { name: 'Excel', icon: '📈' },
        { name: 'AFIP', icon: '🏛️' },
    ];

    const socialLinks = [
        { icon: Twitter, href: '#', label: 'Twitter' },
        { icon: Linkedin, href: '#', label: 'LinkedIn' },
        { icon: Github, href: '#', label: 'GitHub' },
        { icon: MessageCircle, href: '#', label: 'WhatsApp' },
    ];

    return (
        <footer className="bg-accent border-t border-primary/30 text-foreground">
            <div className="max-w-7xl mx-auto px-4 py-16">
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
                    <div className="lg:col-span-1">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="bg-black/10 p-1 rounded-lg">
                                <Image
                                    src="/isologo.png"
                                    alt="SmartSeller Logo"
                                    width={64}
                                    height={64}
                                    style={{ width: 'auto', height: 'auto' }}
                                />
                            </div>
                            <span className="text-lg font-bold tracking-tighter text-foreground">SMARTSELLER</span>
                        </div>
                        <p className="text-foreground text-sm leading-relaxed mb-6">
                            El Motor de Prevención de Riesgos que protege tu capital y te da tranquilidad estratégica.
                        </p>
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-foreground text-sm">
                                <Mail className="h-4 w-4 text-primary" />
                                <a href="mailto:hola@smartseller.io" className="hover:text-foreground transition-colors">
                                    hola@smartseller.io
                                </a>
                            </div>
                        </div>
                    </div>

                    {footerSections.map((section) => (
                        <div key={section.title}>
                            <h3 className="font-bold text-foreground mb-4 text-sm uppercase tracking-wider border-b border-black/5 pb-2 inline-block">
                                {section.title}
                            </h3>
                            <ul className="space-y-3">
                                {section.links.map((link) => (
                                    <li key={link.label}>
                                        <Link
                                            href={link.href}
                                            className="text-slate-700 hover:text-primary transition-colors text-sm font-medium"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}

                    <div>
                        <h3 className="font-bold text-foreground mb-4 text-sm uppercase tracking-wider border-b border-black/5 pb-2 inline-block">
                            Síguenos
                        </h3>
                        <div className="flex gap-3">
                            {socialLinks.map((social) => {
                                const Icon = social.icon;
                                return (
                                    <a
                                        key={social.label}
                                        href={social.href}
                                        className="w-10 h-10 rounded-full bg-black/5 border border-black/5 flex items-center justify-center hover:bg-primary transition-all"
                                    >
                                        <Icon className="h-5 w-5" />
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="border-t border-black/5 pt-12 mb-12">
                    <h3 className="font-semibold text-foreground mb-6 text-sm uppercase tracking-wider text-center md:text-left">
                        Integraciones Nativas
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {integrations.map((integration) => (
                            <div
                                key={integration.name}
                                className="flex items-center justify-center p-4 rounded-xl bg-black/5 border border-black/5 hover:border-primary transition-all"
                            >
                                <div className="text-center">
                                    <div className="text-2xl mb-2 grayscale filter brightness-200">{integration.icon}</div>
                                    <p className="text-xs text-foreground font-medium">{integration.name}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="border-t border-black/5 pt-8 text-center text-slate-700 text-sm">
                    <p className="font-semibold text-foreground">SmartSeller Risk Engine © {currentYear}</p>
                    <p>Hecho con ❤️ en Argentina.</p>
                </div>
            </div>
        </footer>
    );
}
