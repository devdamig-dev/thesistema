/**
 * Middleware de Next.
 *
 * En modo "demo" no interfiere — la app sigue 100% abierta.
 *
 * En modo "database":
 *   1. Refresca la sesión de Supabase en cada request.
 *   2. Si el usuario no tiene sesión y va a una ruta privada,
 *      lo manda a /login.
 *   3. Resuelve el rol + módulos habilitados del usuario y, si la
 *      ruta requiere un módulo que el rol no puede ver, redirige a
 *      `/?denied=<module>`.
 *
 * Rutas públicas: /, /login, /ayuda, /notificaciones, /logout.
 *
 * Settings: hoy se permiten para cualquier usuario autenticado;
 * la granularidad por permiso (settings.team vs settings.business)
 * se chequea en las server actions.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canSeeModule, type ModuleKey, type Role } from "@/lib/permissions";
import {
  isPublicPath,
  isSettingsPath,
  moduleForPath,
} from "@/lib/permissions/route-map";

const APP_MODE = (process.env.NEXT_PUBLIC_APP_MODE ?? "demo").toLowerCase();
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ---------- DEMO MODE GUARD ----------
  // En demo no hay sesión, pero leemos `gp_demo_role` para que el QA
  // del guard funcione igual que en database. Sólo aplicamos guard de
  // módulos — sin redirección a /login.
  if (APP_MODE !== "database" || !SUPA_URL || !SUPA_ANON) {
    const demoRole = request.cookies.get("gp_demo_role")?.value as Role | undefined;
    if (demoRole && !isPublicPath(pathname) && !isSettingsPath(pathname)) {
      const requiredModule = moduleForPath(pathname);
      if (requiredModule && !canSeeModule(demoRole, requiredModule, null)) {
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/";
        redirect.searchParams.set("denied", requiredModule);
        return NextResponse.redirect(redirect);
      }
    }
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

  const isPublic = isPublicPath(pathname);

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  // Página requiere módulo específico → chequear permiso.
  if (user) {
    const requiredModule = moduleForPath(pathname);
    if (requiredModule) {
      // Resolver rol + módulos habilitados del business actual.
      const role = await resolveRoleFromDb(supabase, user.id);
      const enabledModules = await resolveEnabledModulesFromDb(supabase, user.id);
      if (!canSeeModule(role, requiredModule, enabledModules)) {
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/";
        redirect.searchParams.set("denied", requiredModule);
        return NextResponse.redirect(redirect);
      }
    }
    // Settings: dejamos pasar siempre (granularidad en actions).
    if (isSettingsPath(pathname)) {
      // noop
    }
  }

  return response;
}

async function resolveRoleFromDb(supabase: any, userId: string): Promise<Role> {
  const res = await supabase
    .from("business_members")
    .select("role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  const data = res.data as { role: Role } | null;
  return data?.role ?? "viewer";
}

async function resolveEnabledModulesFromDb(
  supabase: any,
  userId: string,
): Promise<ModuleKey[] | null> {
  // Resolver business del usuario
  const memberRes = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  const businessId = (memberRes.data as { business_id: string } | null)?.business_id;
  if (!businessId) return null;

  const modsRes = await supabase
    .from("business_modules")
    .select("module_key")
    .eq("business_id", businessId)
    .eq("enabled", true);
  const mods =
    (modsRes.data as { module_key: ModuleKey }[] | null)?.map((m) => m.module_key) ?? [];
  return mods.length ? mods : null;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
