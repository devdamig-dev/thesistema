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
 *   4. Resuelve un único negocio activo. Si hay más de una membership y no
 *      existe selector de tenant, falla cerrado en vez de elegir uno arbitrario.
 *   5. Resuelve rol + módulos dentro de ese mismo negocio.
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

type BusinessResolution = {
  businessId: string | null;
  ambiguous: boolean;
};

function isAuthPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname === "/ayuda" ||
    pathname === "/restablecer-contrasena"
  );
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Supabase Password Recovery vuelve a /login?recovery=1&code=... en PKCE.
  // Interceptamos el código antes de que el browser client pueda consumirlo y
  // lo enviamos a un Route Handler server-side que crea la sesión en cookies.
  if (
    APP_MODE === "database" &&
    pathname === "/login" &&
    request.nextUrl.searchParams.get("recovery") === "1"
  ) {
    const code = request.nextUrl.searchParams.get("code");
    if (code) {
      const callback = request.nextUrl.clone();
      callback.pathname = "/api/auth/callback";
      callback.search = "";
      callback.searchParams.set("code", code);
      callback.searchParams.set("flow", "recovery");
      callback.searchParams.set("next", "/restablecer-contrasena");
      return NextResponse.redirect(callback);
    }
  }

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

  if (!user && !authPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.search = "";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  let business: BusinessResolution = { businessId: null, ambiguous: false };
  if (user) {
    business = await resolveBusinessFromDb(supabase, user.id);

    if (business.ambiguous && pathname !== "/sin-permisos" && pathname !== "/logout") {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/sin-permisos";
      redirect.search = "";
      redirect.searchParams.set("reason", "multiple_businesses");
      redirect.searchParams.set("from", pathname);
      return NextResponse.redirect(redirect);
    }
  }

  const onboardingExempt =
    pathname === "/onboarding" ||
    pathname.startsWith("/onboarding/") ||
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname === "/restablecer-contrasena" ||
    pathname.startsWith("/admin") ||
    pathname === "/sin-permisos" ||
    (isPublic && pathname !== "/");

  if (user && !onboardingExempt) {
    try {
      const onboarding = business.businessId
        ? await checkOnboardingCompleted(supabase, business.businessId)
        : false;
      if (onboarding === false) {
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/onboarding";
        redirect.search = "";
        return NextResponse.redirect(redirect);
      }
    } catch {
      // Best-effort para errores transitorios de lectura. Las server actions y
      // RLS siguen siendo la frontera de escritura/datos.
    }
  }

  if (user) {
    const requiredModule = moduleForPath(pathname);
    if (requiredModule) {
      const role = business.businessId
        ? await resolveRoleFromDb(supabase, user.id, business.businessId)
        : "viewer";
      const enabledModules = business.businessId
        ? await resolveEnabledModulesFromDb(supabase, business.businessId)
        : [];

      if (!canSeeModule(role, requiredModule, enabledModules)) {
        try {
          if (business.businessId) {
            await logPermissionDenied({
              businessId: business.businessId,
              actorId: user.id,
              actorName: user.email ?? null,
              actorRole: role,
              module: requiredModule,
              pathname,
            });
          }
        } catch {
          // logging best-effort
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

async function resolveBusinessFromDb(supabase: any, userId: string): Promise<BusinessResolution> {
  const res = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
    .limit(2);

  if (res.error) return { businessId: null, ambiguous: false };

  const rows = (res.data as { business_id: string }[] | null) ?? [];
  if (rows.length > 1) return { businessId: null, ambiguous: true };
  return { businessId: rows[0]?.business_id ?? null, ambiguous: false };
}

async function resolveRoleFromDb(
  supabase: any,
  userId: string,
  businessId: string,
): Promise<Role> {
  const res = await supabase
    .from("business_members")
    .select("role")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .maybeSingle();
  const data = res.data as { role: Role } | null;
  return data?.role ?? "viewer";
}

async function resolveEnabledModulesFromDb(
  supabase: any,
  businessId: string,
): Promise<ModuleKey[]> {
  const modsRes = await supabase
    .from("business_modules")
    .select("module_key")
    .eq("business_id", businessId)
    .eq("enabled", true);
  if (modsRes.error) return [];
  return (modsRes.data as { module_key: ModuleKey }[] | null)?.map((m) => m.module_key) ?? [];
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
