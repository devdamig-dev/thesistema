"use server";

import { revalidatePath } from "next/cache";
import { connectFudo, testStoredFudoConnection, inspectFudoReadPermissions, disconnectFudo, syncFudoReadOnly, type FudoActionResult } from "@/lib/integrations/fudo/service";

const validBusinessRevision = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const staleBusiness = () => ({ ok: false as const, code: "connection_changed",
  message: "Cambiaste de negocio desde que abriste la pantalla. Actualizá y reintentá." });

const refresh = async (operation: Promise<FudoActionResult>) => {
  const result = await operation;
  revalidatePath("/ajustes/integraciones/fudo");
  revalidatePath("/ajustes");
  return result;
};

export async function connectFudoAction(
  input: { apiKey: string; apiSecret: string },
  expectedBusinessRevision: string,
  expectedConnectionRevision: string | null,
) {
  if (!validBusinessRevision(expectedBusinessRevision)
    || !(expectedConnectionRevision === null || validBusinessRevision(expectedConnectionRevision))) {
    return staleBusiness();
  }
  return refresh(connectFudo(input, expectedBusinessRevision, expectedConnectionRevision));
}
export async function testFudoConnectionAction(expectedBusinessRevision: string) {
  if (!validBusinessRevision(expectedBusinessRevision)) return staleBusiness();
  return refresh(testStoredFudoConnection(expectedBusinessRevision));
}
export async function disconnectFudoAction(expectedBusinessRevision: string) {
  if (!validBusinessRevision(expectedBusinessRevision)) return staleBusiness();
  return refresh(disconnectFudo(expectedBusinessRevision));
}
export async function syncFudoAction(expectedConnectionRevision: string) {
  // Never allow a client to omit the connection/tenant fence and initiate a
  // new foreground batch under whichever business is active by then.
  if (typeof expectedConnectionRevision !== "string" || !/^[a-f0-9]{64}$/.test(expectedConnectionRevision)) {
    return { ok: false as const, code: "connection_changed",
      message: "La conexión Fudo cambió. Actualizá la pantalla y reintentá." };
  }
  return refresh(syncFudoReadOnly(expectedConnectionRevision));
}

// Read-only diagnostics; never returns credentials or provider records.
export async function inspectFudoPermissionsAction(expectedBusinessRevision: string) {
  if (!validBusinessRevision(expectedBusinessRevision)) {
    return { ok: false, message: staleBusiness().message, checks: [] };
  }
  return inspectFudoReadPermissions(expectedBusinessRevision);
}
