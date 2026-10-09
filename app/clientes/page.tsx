import { getCustomersPageDataAction } from "@/app/actions/customers-page";
import { isDatabaseMode } from "@/lib/env";
import { getCurrentUserContext } from "@/lib/data/auth";
import { hasPermission } from "@/lib/permissions";
import { customers as demoCustomers } from "@/lib/mock-data";
import { CustomersClient } from "./customers-client";

export default async function ClientesPage() {
  const databaseMode = isDatabaseMode();
  if (databaseMode) {
    const initial = await getCustomersPageDataAction().catch(() => ({ ok: false as const, error: "No pudimos cargar los clientes reales." }));
    return <CustomersClient databaseMode initial={initial} />;
  }
  const ctx = await getCurrentUserContext();
  return <CustomersClient databaseMode={false} initial={{ ok: true, data: {
    customers: demoCustomers.map((row, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: row.nombre, channel: row.canal, phone: null, email: null, notes: null, active: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    })), canManage: hasPermission(ctx.role, "customers.manage"), truncated: false,
  } }} />;
}
