/**
 * Middleware de Next.
 *
 * - En modo "demo" no hace nada — la app sigue 100% abierta.
 * - En modo "database":
 *     - Refresca la sesión de Supabase en cada request.
 *     - Si el usuario no tiene sesión y va a una ruta privada,
 *       lo manda a /login.
 *
 * Rutas públicas en modo database: /, /login, /ayuda y assets.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const APP_MODE = (process.env.NEXT_PUBLIC_APP_MODE ?? "demo").toLowerCase();
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const PUBLIC_PATHS = ["/login", "/ayuda"];

export async function middleware(request: NextRequest) {
  if (APP_MODE !== "database" || !SUPA_URL || !SUPA_ANON) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(SUPA_URL, SUPA_ANON, {
    cookies: {
      get: (name: string) => request.cookies.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value, ...options });
      },
      remove: (name: string, options: CookieOptions) => {
        request.cookies.set({ name, value: "", ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (!user && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: [
    // Excluye assets y APIs internas.
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
