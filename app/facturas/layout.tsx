import type { ReactNode } from "react";
import { isDatabaseMode } from "@/lib/env";
import { DatabaseInvoicesView } from "./database-view";
export default function FacturasLayout({ children }: { children: ReactNode }) {
  return isDatabaseMode() ? <DatabaseInvoicesView /> : <>{children}</>;
}
