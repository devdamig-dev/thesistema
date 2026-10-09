"use client";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import DemoSales from "./demo-sales";
import DatabaseSales from "./database-sales";
export default function VentasPage() { return process.env.NEXT_PUBLIC_APP_MODE === "database" ? <ErrorBoundaryCard module="Ventas"><DatabaseSales /></ErrorBoundaryCard> : <><p className="mb-4 rounded-lg border border-line p-3 text-sm text-ink-muted">Modo demo · Datos ficticios. Las ventas manuales se guardan únicamente en database mode.</p><DemoSales /></>; }
