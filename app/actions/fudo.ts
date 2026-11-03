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
export async function syncFudoAction() {
  return refresh(syncFudoReadOnly());
}

// Read-only diagnostics; never returns credentials or provider records.
export async function inspectFudoPermissionsAction() {
  return inspectFudoReadPermissions();
}
