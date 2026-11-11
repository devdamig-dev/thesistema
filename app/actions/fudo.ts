"use server";

import { revalidatePath } from "next/cache";
import { connectFudo, testStoredFudoConnection, inspectFudoReadPermissions, disconnectFudo, syncFudoReadOnly, type FudoActionResult } from "@/lib/integrations/fudo/service";

const refresh = async (operation: Promise<FudoActionResult>) => {
  const result = await operation;
  revalidatePath("/ajustes/integraciones/fudo");
  revalidatePath("/ajustes");
  return result;
};

export async function connectFudoAction(input: { apiKey: string; apiSecret: string }) {
  return refresh(connectFudo(input));
}
export async function testFudoConnectionAction() {
  return refresh(testStoredFudoConnection());
}
export async function disconnectFudoAction() {
  return refresh(disconnectFudo());
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
export async function inspectFudoPermissionsAction() {
  return inspectFudoReadPermissions();
}
