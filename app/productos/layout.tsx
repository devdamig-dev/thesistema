import type { ReactNode } from "react";
import { isDatabaseMode } from "@/lib/env";
import DatabaseProductsPage from "./database-products-page";

export default function ProductosLayout({ children }: { children: ReactNode }) {
  if (isDatabaseMode()) return <DatabaseProductsPage />;
  return children;
}
