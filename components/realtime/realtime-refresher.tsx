"use client";

import { useRealtimeRefresh } from "@/lib/realtime/use-realtime";

/**
 * Componente "headless" que monta una subscription a una tabla y
 * refresca el router cuando hay cambios. Se monta en páginas server
 * y no renderiza nada.
 *
 *   <RealtimeRefresher tables={["whatsapp_messages", "ai_extractions"]} />
 */
export function RealtimeRefresher({
  tables,
  throttleMs,
}: {
  tables: string | string[];
  throttleMs?: number;
}) {
  const arr = Array.isArray(tables) ? tables : [tables];
  return (
    <>
      {arr.map((t) => (
        <TableSubscription key={t} table={t} throttleMs={throttleMs} />
      ))}
    </>
  );
}

function TableSubscription({ table, throttleMs }: { table: string; throttleMs?: number }) {
  useRealtimeRefresh(table, { throttleMs });
  return null;
}
