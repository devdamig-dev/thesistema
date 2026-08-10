/**
 * Middleware de Next.
 *
 * En modo "demo" no interfiere — la app sigue 100% abierta.
 *
 * En modo "database":
 *   1. Exige que Supabase esté configurado; nunca degrada a demo silenciosamente.
 *   2. Refresca la sesión de Supabase en cada request.
 *   3. Si el usuario no tiene sesión y va a una ruta privada,
 *      lo manda a /login.
 *   4. Resuelve el rol + módulos habilitados del usuario y, si la
 *      ruta requiere un módulo que el rol no puede ver, redirige a
 *      /sin-permisos.
 *
 * En database mode sólo /login, /logout y /ayuda son públicos para auth.
 * El Dashboard, onboarding, notificaciones, ajustes y módulos operativos
 * requieren sesión.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canSeeModule, type ModuleKey, type Role } from "@/lib/permissions";
import {
  isPublicPath,
  isSettingsPath,
  moduleForPath,
} from "@/lib/permissions/route-map";
import { logPermissionDenied } from "@/lib/data/activity";

const APP_MODE = (process.env.NEXT_PUBLIC_APP_MODE ?? "demo").toLowerCase();
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function isAuthPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/logout" || pathname === "/ayuda";
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ---------- DEMO MODE GUARD ----------
  // Sólo el modo demo explícito puede funcionar sin Supabase. Si la app está
  // declarada como database, una configuración incompleta debe fallar cerrada.
  if (APP_MODE !== "database") {
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

  // Database mode sin variables críticas: no abrir la aplicación como demo.
  // Dejamos accesible /login para mostrar la aplicación, pero bloqueamos el
  // resto hasta que la configuración del deployment sea corregida.
  if (!SUPA_URL || !SUPA_ANON) {
    if (pathname === "/login") return NextResponse.next();
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.search = "";
    redirect.searchParams.set("error", "database_config");
    return NextResponse.redirect(redirect);
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
  const authPublic = isAuthPublicPath(pathname);

  const { data: { user } } = await supabase.auth.getUser();

  // Importante: PUBLIC_PATHS también se usa para el guard de módulos y contiene
  // rutas como / y /notificaciones. Eso NO significa que sean públicas para
  // autenticación en database mode.
  if (!user && !authPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.search = "";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  // Check onboarding: si el business no completó el setup, redirigir.
  // No aplica a rutas de sistema ni al módulo interno /admin/* — el gate de
  // admin no depende del estado de onboarding del business.
  const onboardingExempt =
    pathname === "/onboarding" ||
    pathname.startsWith("/onboarding/") ||
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname.startsWith("/admin") ||
    (isPublic && pathname !== "/");

  if (user && !onboardingExempt) {
    try {
      const businessId = await resolveBusinessIdFromDb(supabase, user.id);
      const onboarding = businessId
        ? await checkOnboardingCompleted(supabase, businessId)
        : false;
      if (onboarding === false) {
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/onboarding";
        redirect.search = "";
        return NextResponse.redirect(redirect);
      }
    } catch {
      // Best-effort — si falla la query, no bloqueamos navegación de una sesión
      // válida; RLS y las server actions siguen siendo la frontera de datos.
    }
  }

  // Página requiere módulo específico → chequear permiso.
  if (user) {
    const requiredModule = moduleForPath(pathname);
    if (requiredModule) {
      const role = await resolveRoleFromDb(supabase, user.id);
      const enabledModules = await resolveEnabledModulesFromDb(supabase, user.id);
      if (!canSeeModule(role, requiredModule, enabledModules)) {
        try {
          const businessId = await resolveBusinessIdFromDb(supabase, user.id);
          if (businessId) {
            await logPermissionDenied({
              businessId,
              actorId: user.id,
              actorName: user.email ?? null,
              actorRole: role,
              module: requiredModule,
              pathname,
            });
          }
        } catch {
          // ignore — logging es best-effort
        }
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/sin-permisos";
        redirect.search = "";
        redirect.searchParams.set("m", requiredModule);
        redirect.searchParams.set("from", pathname);
        return NextResponse.redirect(redirect);
      }
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

async function resolveBusinessIdFromDb(supabase: any, userId: string): Promise<string | null> {
  const res = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return (res.data as { business_id: string } | null)?.business_id ?? null;
}

async function resolveEnabledModulesFromDb(
  supabase: any,
  userId: string,
): Promise<ModuleKey[] | null> {
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

async function checkOnboardingCompleted(
  supabase: any,
  businessId: string,
): Promise<boolean | null> {
  const res = await supabase
    .from("businesses")
    .select("onboarding_completed")
    .eq("id", businessId)
    .maybeSingle();
  const data = res.data as { onboarding_completed: boolean } | null;
  return data?.onboarding_completed ?? null;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
