"use client";

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Menu, X } from 'lucide-react';

export default function Header() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const startHref = '/api/auth/meli/start';

    const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

    const navLinks = [
        { name: 'Producto', href: '#features' },
        { name: 'Precios', href: '#pricing' },
    ];

    return (
        <header className="sticky top-0 z-50 w-full border-b bg-white/90 backdrop-blur-md">
            <div className="container mx-auto flex h-16 items-center justify-between px-4 lg:px-8">

                {/* LOGO */}
                <Link href="/" className="flex items-center gap-2 group">
                    <div className="relative w-[180px] h-[60px]">
                        <Image
                            src="/logo.png"
                            alt="SmartSeller Logo"
                            fill
                            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                            className="transition-transform group-hover:scale-105 object-contain"
                            priority
                        />
                    </div>
                </Link>

                {/* NAVEGACIÓN DESKTOP */}
                <nav className="hidden md:flex items-center gap-8">
                    {navLinks.map((link) => (
                        <Link
                            key={link.name}
                            href={link.href}
                            className="text-sm font-medium text-slate-600 hover:text-accent transition-colors"
                        >
                            {link.name}
                        </Link>
                    ))}
                    <a
                        href={startHref}
                        id="cta-header-desktop"
                        className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-opacity-90 shadow-sm transition-all"
                    >
                        Acceso Clientes
                    </a>
                </nav>

                {/* BOTÓN HAMBURGUESA (Móvil) */}
                <button
                    className="md:hidden p-2 text-primary"
                    onClick={toggleMenu}
                    aria-label="Abrir menú"
                >
                    {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
            </div>

            {/* MENÚ MÓVIL */}
            {isMenuOpen && (
                <div className="md:hidden absolute top-16 left-0 w-full bg-white border-b shadow-xl">
                    <nav className="flex flex-col p-6 gap-5">
                        {navLinks.map((link) => (
                            <Link
                                key={link.name}
                                href={link.href}
                                onClick={toggleMenu}
                                className="text-lg font-medium text-slate-700 hover:text-primary transition-colors"
                            >
                                {link.name}
                            </Link>
                        ))}
                        <hr className="border-slate-100" />
                        <a
                            href={startHref}
                            id="cta-header-mobile"
                            onClick={toggleMenu}
                            className="w-full rounded-lg bg-primary py-3 text-center font-bold text-white block"
                        >
                            Acceso Clientes
                        </a>
                    </nav>
                </div>
            )}
        </header>
    );
}
