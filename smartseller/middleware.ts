import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // OAuth allowlist: never intercept Mercado Libre auth flow routes.
  if (pathname.startsWith("/api/auth/meli/")) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/install/meli/complete")) {
    return NextResponse.next();
  }

  // NEVER intercept API routes
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|robots.txt|sitemap.xml).*)"],
};
