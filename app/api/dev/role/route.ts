/**
 * Dev-only helper · cambiar el rol del demo context vía cookie.
 *
 * Uso:
 *   GET /api/dev/role?as=accountant
 *   GET /api/dev/role/reset
 *
 * Sólo funciona si NEXT_PUBLIC_APP_MODE=demo. En database mode el rol
 * lo dicta `business_members.role` y este endpoint no hace nada.
 *
 * La cookie `gp_demo_role` se lee desde `getCurrentUserContext()` para
 * que el sidebar adaptativo + middleware guard usen el rol "fake"
 * durante QA.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDatabaseMode } from "@/lib/env";
import type { Role } from "@/lib/permissions";

const VALID_ROLES: Role[] = [
  "owner",
  "admin",
  "manager",
  "accountant",
  "marketing",
  "employee",
  "kitchen",
  "cashier",
  "waiter",
  "delivery",
  "viewer",
];

export async function GET(request: NextRequest) {
  if (isDatabaseMode()) {
    return NextResponse.json({
      ok: false,
      reason: "database_mode_uses_business_members.role",
    });
  }

  const url = request.nextUrl;
  const as = url.searchParams.get("as");
  const response = NextResponse.json({
    ok: true,
    mode: "demo",
    role: as ?? "reset",
    hint: `Recargá cualquier ruta para ver el sidebar adaptado al rol.`,
  });

  if (!as || as === "reset") {
    response.cookies.set("gp_demo_role", "", { maxAge: 0, path: "/" });
    return response;
  }
  if (!VALID_ROLES.includes(as as Role)) {
    return NextResponse.json(
      { ok: false, reason: "invalid_role", valid: VALID_ROLES },
      { status: 400 },
    );
  }
  response.cookies.set("gp_demo_role", as, {
    maxAge: 60 * 60 * 24, // 24h
    path: "/",
    httpOnly: false,
    sameSite: "lax",
  });
  return response;
}
