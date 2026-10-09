import { notFound, redirect } from "next/navigation";
import { checkInternalAdmin } from "@/lib/admin/auth";
import {
  getTelemetryDaily,
  getTelemetryEvents,
  getTelemetryMetrics,
  type TelemetryRange,
  type TelemetryEventsFilters,
} from "@/lib/admin/telemetry-database";
import TelemetriaClient from "./telemetria-client";

const VALID_RANGES: TelemetryRange[] = ["24h", "7d", "30d"];

export const dynamic = "force-dynamic";

export default async function TelemetriaPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const check = await checkInternalAdmin();
  if (!check.allowed) {
    // Si el flag está apagado, devolvemos 404 — preferible a sin-permisos
    // para no exponer la existencia del módulo a un cliente normal.
    if (check.reason === "disabled") notFound();
    if (check.reason === "not-authenticated") redirect("/login?next=/admin/telemetria");
    redirect("/sin-permisos?m=internal_admin&from=/admin/telemetria");
  }

  const params = await searchParams;
  const rangeParam = String(params?.range ?? "7d");
  const range: TelemetryRange = (VALID_RANGES as string[]).includes(rangeParam)
    ? (rangeParam as TelemetryRange)
    : "7d";

  const filters: TelemetryEventsFilters = {
    range,
    module: (params?.module as string) || null,
    user: (params?.user as string) || null,
    status: (["ok", "error", "warn"] as const).includes(params?.status as any)
      ? (params?.status as "ok" | "error" | "warn")
      : null,
    q: (params?.q as string) || null,
    limit: 200,
  };

  const [metrics, daily, events] = await Promise.all([
    getTelemetryMetrics(range),
    getTelemetryDaily(range),
    getTelemetryEvents(filters),
  ]);

  return (
    <TelemetriaClient
      range={range}
      metrics={metrics}
      daily={daily}
      events={events}
      filters={filters}
    />
  );
}
