/**
 * Activity feed que lee `activity_logs` reales del business actual.
 *
 * Sólo server. Si no hay business o no hay logs, cae al feed mock
 * (que ya viene del mock-data del Inbox IA).
 */

import {
  CheckCircle2,
  FileText,
  HandCoins,
  Inbox,
  Megaphone,
  Receipt,
  ShoppingCart,
  Sparkles,
  UserPlus,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { listRecentActivity, type ActivityRow } from "@/lib/data/activity";
import { getCurrentUserContext } from "@/lib/data/auth";
import { ActivityFeed } from "./activity-feed";

const ACTION_LABEL: Record<string, string> = {
  "inbox.purchase.approved": "aprobó una compra desde Inbox",
  "inbox.sale.approved": "aprobó una venta desde Inbox",
  "inbox.expense.approved": "aprobó un gasto desde Inbox",
  "inbox.employee_advance.approved": "registró un adelanto desde Inbox",
  "inbox.daily_closure.approved": "aprobó un cierre desde Inbox",
  "inbox.debt_created.approved": "registró una deuda desde Inbox",
  "inbox.debt_payment.approved": "registró un pago de deuda",
  "invoice.approved": "aprobó una factura",
  "debt.created": "registró una nueva deuda",
  "debt.payment.registered": "registró un pago de deuda",
  "debt.settled": "saldó una deuda",
  "debt.settled.manual": "marcó una deuda como saldada",
  "team.invited": "invitó a un usuario al equipo",
};

const ACTION_ICON: Record<string, any> = {
  invoice: FileText,
  inbox: Inbox,
  debt: HandCoins,
  team: UserPlus,
  purchase: ShoppingCart,
  expense: Receipt,
  sale: CheckCircle2,
  closure: Receipt,
  marketing: Megaphone,
  ai: Sparkles,
  advance: Wallet,
};

function actionToLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/[._]/g, " ");
}

function actionToIcon(action: string) {
  const prefix = action.split(".")[0];
  return ACTION_ICON[prefix] ?? Sparkles;
}

function relativeShort(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "hace instantes";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

export async function ActivityFeedReal({
  limit = 10,
  fallbackToMock = true,
}: {
  limit?: number;
  fallbackToMock?: boolean;
}) {
  const ctx = await getCurrentUserContext();
  const logs: ActivityRow[] = ctx.businessId
    ? await listRecentActivity(ctx.businessId, limit)
    : [];

  if (logs.length === 0) {
    if (!fallbackToMock) {
      return (
        <div className="rounded-xl border border-dashed border-line p-8 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-line bg-bg-subtle text-ink-muted">
            <Sparkles className="h-4 w-4" />
          </div>
          <p className="mt-3 text-sm text-ink">Sin actividad reciente</p>
          <p className="text-xs text-ink-muted">
            Las aprobaciones y cambios del equipo aparecen acá en vivo.
          </p>
        </div>
      );
    }
    return <ActivityFeed />;
  }

  return (
    <ul className="space-y-1">
      {logs.map((log) => {
        const Icon = actionToIcon(log.action);
        return (
          <li
            key={log.id}
            className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-bg-subtle"
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-bg-subtle">
              <Icon className="h-4 w-4 text-ink-muted" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm text-ink">
                  <span className="font-medium">{log.actor_name ?? "Sistema"}</span>{" "}
                  <span className="text-ink-muted">{actionToLabel(log.action)}</span>
                </p>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-subtle">
                {log.actor_role && (
                  <>
                    <span>{log.actor_role}</span>
                    <span>·</span>
                  </>
                )}
                <span>{relativeShort(log.created_at)}</span>
                {log.target_type && (
                  <>
                    <span>·</span>
                    <Badge tone="default">{log.target_type}</Badge>
                  </>
                )}
              </div>
              <p className="mt-1 text-xs text-ink-muted line-clamp-1">{log.summary}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
