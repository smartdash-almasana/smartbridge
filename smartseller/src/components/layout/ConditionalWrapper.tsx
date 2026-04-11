"use client";

import { usePathname } from 'next/navigation';
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";

function isAppShellPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname.includes('/dashboard') ||
    pathname === '/alerts' ||
    pathname === '/vital-signs' ||
    pathname === '/evolution' ||
    pathname.includes('/choose-store') ||
    pathname.includes('/enter')
  );
}

export function ConditionalHeader() {
  const pathname = usePathname();
  if (isAppShellPath(pathname)) {
    return null;
  }
  return <Header />;
}

export function ConditionalFooter() {
  const pathname = usePathname();
  if (isAppShellPath(pathname)) {
    return null;
  }
  return <Footer />;
}
