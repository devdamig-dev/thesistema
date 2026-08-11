/**
 * Middleware de Next.
 *
 * Esta rama `demo` es deliberadamente pública y aislada de Supabase. No debe
 * heredar el NEXT_PUBLIC_APP_MODE=database del proyecto de Vercel.
 */

import { NextResponse, type NextRequest } from "next/server";
import { canSeeModule, type Role } from "@/lib/permissions";
import { isPublicPath, isSettingsPath, moduleForPath } from "@/lib/permissions/route-map";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const demoRole = request.cookies.get("gp_demo_role")?.value as Role | undefined;

  if (demoRole && !isPublicPath(pathname) && !isSettingsPath(pathname)) {
    const requiredModule = moduleForPath(pathname);
    if (requiredModule && !canSeeModule(demoRole, requiredModule, null)) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/sin-permisos";
      redirect.search = "";
      redirect.searchParams.set("m", requiredModule);
      redirect.searchParams.set("from", pathname);
      return NextResponse.redirect(redirect);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
