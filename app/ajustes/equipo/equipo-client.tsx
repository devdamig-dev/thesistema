"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Clock,
  Mail,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastPresets, useToast } from "@/components/ui/toast";
import {
  SettingsCard,
  SettingRow,
  Toggle,
} from "@/components/ajustes/setting-row";
import {
  inviteUserAction,
  revokeInvitationAction,
  updateMemberRoleAction,
} from "@/app/actions/team";
import {
  PRIMARY_ROLES,
  ROLE_LABELS,
  type Role,
} from "@/lib/permissions";
import type { PendingInvitation, TeamMember } from "@/lib/data/team";
import { cn } from "@/lib/utils";

const ROLE_TONE: Record<string, "brand" | "warn" | "info" | "ai" | "success" | "default"> = {
  owner: "brand",
  admin: "brand",
  manager: "ai",
  accountant: "info",
  marketing: "ai",
  employee: "default",
  kitchen: "warn",
  cashier: "info",
  waiter: "default",
  delivery: "success",
  viewer: "default",
};

export default function EquipoClient({
  members,
  invitations,
}: {
  members: TeamMember[];
  invitations: PendingInvitation[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("manager");

  function handleInvite() {
    if (!inviteEmail.includes("@")) {
      toast({ tone: "warn", title: "Email inválido" });
      return;
    }
    startTransition(async () => {
      const res = await inviteUserAction({ email: inviteEmail, role: inviteRole });
      if (res.ok) {
        toast({
          tone: "success",
          title: "Invitación enviada",
          description: res.persisted
            ? `${inviteEmail} recibirá un link en breve.`
            : "Modo demo · cambio local.",
        });
        setInviteEmail("");
        setInviteOpen(false);
        router.refresh();
      } else {
        toast({ tone: "warn", title: "No pudimos invitar", description: res.error });
      }
    });
  }

  function handleRoleChange(memberId: string, role: Role) {
    startTransition(async () => {
      const res = await updateMemberRoleAction(memberId, role);
      if (res.ok) {
        toast({
          tone: "success",
          title: "Rol actualizado",
          description: res.persisted
            ? "Cambio guardado en Supabase."
            : "Modo demo · cambio local.",
        });
        router.refresh();
      } else {
        toast({ tone: "warn", title: "Error", description: res.error });
      }
    });
  }

  function handleRevoke(invId: string, email: string) {
    if (!confirm(`¿Revocar la invitación a ${email}?`)) return;
    startTransition(async () => {
      const res = await revokeInvitationAction(invId);
      if (res.ok) {
        toast({ tone: "neutral", title: "Invitación revocada" });
        router.refresh();
      } else {
        toast({ tone: "warn", title: "Error", description: res.error });
      }
    });
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Usuarios"
        description="Quiénes pueden entrar a GastroPilot y con qué permisos. Cada rol tiene un set de permisos definido."
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setInviteOpen((v) => !v)}
            disabled={pending}
          >
            <UserPlus className="h-3.5 w-3.5" />
            {inviteOpen ? "Cancelar" : "Invitar usuario"}
          </Button>
        }
      >
        {inviteOpen && (
          <div className="mb-4 rounded-xl border border-ai-400/30 bg-ai-500/[0.06] p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_auto]">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-ink-subtle">
                  Email
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="nuevo@labirra.com"
                  className="w-full rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-ink-subtle">
                  Rol
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Role)}
                  className="w-full rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  {PRIMARY_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button variant="primary" size="md" onClick={handleInvite} disabled={pending}>
                  <Check className="h-4 w-4" />
                  Enviar invitación
                </Button>
              </div>
            </div>
          </div>
        )}

        <ul className="space-y-2">
          {members.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg-subtle/40 p-3"
            >
              <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-400/20 to-brand-600/20 text-[11px] font-semibold text-brand-300">
                {u.fullName
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{u.fullName}</span>
                  {u.canApprove && (
                    <Badge tone="success">
                      <ShieldCheck className="h-3 w-3" /> Aprobador
                    </Badge>
                  )}
                </div>
                {u.email && (
                  <div className="flex items-center gap-1 text-xs text-ink-muted">
                    <Mail className="h-3 w-3" />
                    {u.email}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-[10px] uppercase tracking-wider text-ink-subtle md:inline">
                  Rol
                </span>
                <select
                  value={u.role}
                  onChange={(e) => handleRoleChange(u.id, e.target.value as Role)}
                  disabled={pending || u.role === "owner"}
                  className={cn(
                    "rounded-lg border border-line bg-bg-elevated px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  {PRIMARY_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
      </SettingsCard>

      <SettingsCard
        title="Invitaciones pendientes"
        description="Usuarios invitados que todavía no aceptaron."
      >
        {invitations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-6 text-center text-xs text-ink-muted">
            Sin invitaciones pendientes.
          </div>
        ) : (
          <ul className="space-y-2">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center gap-3 rounded-xl border border-line bg-bg-subtle/40 p-3"
              >
                <div className="grid h-9 w-9 place-items-center rounded-lg border border-warn-500/30 bg-warn-500/10">
                  <Clock className="h-4 w-4 text-warn-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{inv.email}</span>
                    <Badge tone={ROLE_TONE[inv.role] ?? "default"}>
                      {ROLE_LABELS[inv.role]}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-ink-muted">
                    Vence el{" "}
                    {new Date(inv.expiresAt).toLocaleDateString("es-AR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevoke(inv.id, inv.email)}
                  disabled={pending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revocar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard
        title="Acceso del contador"
        description="Tu estudio recibe facturas, cierres y reportes directo en su panel."
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() => toast(ToastPresets.settingsSaved())}
          >
            <Check className="h-3.5 w-3.5" /> Guardar
          </Button>
        }
      >
        <SettingRow label="Estudio contable" hint="Email principal">
          <input
            type="email"
            defaultValue="contador@estudiopiazza.com.ar"
            className="w-full rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </SettingRow>
        <SettingRow label="Envío automático de facturas" hint="Cuando se aprueban en /facturas">
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow label="Resumen semanal por email" hint="Lunes 9:00 hs">
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow label="Compartir cierres diarios" hint="Como CSV adjunto">
          <Toggle />
        </SettingRow>
      </SettingsCard>

      <SettingsCard
        title="Notificaciones del sistema"
        description="Qué le avisa GastroPilot a cada rol."
      >
        <SettingRow label="Movimientos pendientes de aprobación">
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow label="Alertas de stock crítico">
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow label="Recomendaciones de la IA">
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow label="Resumen diario al socio">
          <Toggle defaultChecked />
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
