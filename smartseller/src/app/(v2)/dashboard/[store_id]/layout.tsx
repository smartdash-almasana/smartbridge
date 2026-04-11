"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Bell, LayoutGrid, Layers, BarChart3, Menu, X, LogOut, Settings } from "lucide-react";

type NavItem = {
    name: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
};

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const routeParams = useParams<{ store_id: string }>();
    const store_id = typeof routeParams?.store_id === "string" ? routeParams.store_id : "";
    const pathname = usePathname();
    const [storeName, setStoreName] = useState("Tienda principal");
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    useEffect(() => {
        fetch("/api/me", { cache: "no-store" })
            .then((res) => res.json())
            .then((data) => {
                const stores = Array.isArray(data?.stores) ? data.stores : [];
                const store = stores.find((item: { store_id: string; display_name?: string }) => item.store_id === store_id);
                setStoreName(store?.display_name ?? "Tienda principal");
            })
            .catch(() => setStoreName("Tienda principal"));
    }, [store_id]);

    const navItems: NavItem[] = [
        { name: "Inicio", href: `/dashboard/${store_id}`, icon: LayoutGrid },
        { name: "Áreas del negocio", href: `/dashboard/${store_id}/vital-signs`, icon: Layers },
        { name: "Alertas", href: `/dashboard/${store_id}/alerts`, icon: Bell },
        { name: "Reportes", href: `/dashboard/${store_id}/reports`, icon: BarChart3 },
    ];

    const closeMobileMenu = () => setIsMobileMenuOpen(false);

    const SidebarContent = () => (
        <div className="flex h-full w-full flex-col bg-white">
            <div className="flex h-20 shrink-0 items-center px-6">
                <span className="text-xl font-black tracking-tight text-[#06102c]">
                    <span className="text-blue-600 mr-2">✦</span>SmartSeller
                </span>
            </div>
            
            <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-2">
                {navItems.map((item) => {
                    const active = pathname === item.href;
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={closeMobileMenu}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                                active
                                    ? "bg-[#1d4ed8] text-white shadow-sm"
                                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            }`}
                        >
                            <Icon className={`h-[18px] w-[18px] ${active ? "text-white" : "text-slate-400"}`} />
                            {item.name}
                        </Link>
                    );
                })}
            </nav>

            <div className="border-t border-slate-100 p-4">
                <div className="space-y-1 mb-4">
                    <Link href={`#`} onClick={closeMobileMenu} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900">
                        <Settings className="h-[18px] w-[18px] text-slate-400" />
                        Configuración
                    </Link>
                    <form action="/api/auth/logout" method="post" className="w-full">
                        <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900">
                            <LogOut className="h-[18px] w-[18px] text-slate-400" />
                            Cerrar sesión
                        </button>
                    </form>
                </div>

                <div className="flex items-center gap-3 px-3 pb-2 pt-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-200 text-sm font-bold text-orange-800">
                        {storeName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-900 truncate max-w-[130px]">{storeName}</span>
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Nivel inicial</span>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex h-screen w-full overflow-hidden bg-[radial-gradient(circle_at_top,#f8fbff_0%,#eef4fb_42%,#f8fafc_100%)] text-slate-900">
            {/* Desktop Sidebar */}
            <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:block z-20">
                <SidebarContent />
            </aside>

            {/* Mobile Header & Overlay */}
            <div className="flex flex-1 flex-col overflow-hidden relative">
                <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden z-10">
                    <span className="text-lg font-black tracking-tight text-[#06102c]">
                        <span className="text-blue-600 mr-2">✦</span>SmartSeller
                    </span>
                    <button
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
                    >
                        {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>
                </header>

                {/* Mobile Menu Overlay */}
                {isMobileMenuOpen && (
                    <div className="absolute inset-0 z-50 flex md:hidden">
                        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeMobileMenu} />
                        <div className="relative flex w-64 h-full flex-col bg-white shadow-2xl">
                            <SidebarContent />
                        </div>
                    </div>
                )}

                {/* Main Content Area */}
                <main className="flex-1 overflow-x-hidden overflow-y-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
                    {children}
                </main>
            </div>
        </div>
    );
}
