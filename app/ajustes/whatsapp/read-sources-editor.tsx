"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, PauseCircle, PlayCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { saveWhatsAppReadSource, toggleWhatsAppReadSource } from "@/app/actions/whatsapp-read-sources";
import type { BranchOption } from "./conversation-editor";

export type ReadSource = {
  id: string; label: string; sender_phone: string; branch_id: string;
  enabled: boolean; last_message_at: string | null;
};
const inputClass = "w-full rounded-lg border border-line bg-bg-subtle p-2.5 text-sm text-ink";
export function ReadSourcesEditor({ connected, branches, sources, available }: {
  connected: boolean; branches: BranchOption[]; sources: ReadSource[]; available: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : "");
  const [consent, setConsent] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const canAdd = connected && available && branches.length > 0;
  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Eye className="h-4 w-4" />Fuentes de WhatsApp · solo lectura</CardTitle><Badge tone="default">Sin acceso al equipo</Badge></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-ink-muted">Habilitá el teléfono de una administración, caja o colaborador para que sus <strong>próximos mensajes de texto entrantes</strong> se reciban en el Inbox y se preparen para revisión. No necesita una cuenta de GastroPilot y no puede ejecutar ni confirmar ventas, gastos u otras operaciones.</p>
      <p className="text-xs text-ink-subtle">Meta no permite elegir todos los chats existentes del teléfono ni recuperar automáticamente el historial de WhatsApp. Ingresá el número de origen autorizado. Solo se procesan mensajes recibidos después de habilitarlo.</p>
      {sources.length ? <div className="space-y-2">
        {sources.map(source => <div key={source.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{source.label}</p>
            <p className="text-xs text-ink-muted">+{source.sender_phone} · {branches.find(branch => branch.id === source.branch_id)?.name ?? "Sucursal"}</p>
            <p className="text-xs text-ink-subtle">{source.last_message_at ? `Último mensaje recibido: ${new Date(source.last_message_at).toLocaleString("es-AR")}` : "Sin mensajes recibidos todavía"}</p>
          </div>
          <div className="flex items-center gap-2"><Badge tone={source.enabled ? "success" : "default"}>{source.enabled ? "Lectura activa" : "Pausada"}</Badge>
            <button type="button" disabled={pending} className="inline-flex items-center gap-1 rounded-lg border border-line p-2 text-xs hover:bg-bg-subtle disabled:opacity-50" onClick={() => startTransition(async () => {
              const response = await toggleWhatsAppReadSource(source.id, !source.enabled); setMessage(response.message); setFailed(!response.ok);
              if (response.ok) router.refresh();
            })} aria-label={source.enabled ? "Pausar fuente" : "Reactivar fuente"}>{source.enabled ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}</button>
          </div>
        </div>)}
      </div> : <p className="rounded-lg border border-dashed border-line p-3 text-sm text-ink-muted">No hay fuentes de lectura configuradas.</p>}
      {!available ? <p className="text-sm text-warn-400">La base de datos todavía no tiene habilitado el módulo de fuentes de lectura.</p> : null}
      <form className="grid gap-3" onSubmit={event => {
        event.preventDefault();
        startTransition(async () => {
          const response = await saveWhatsAppReadSource({ label, phone, branchId, consent });
          setMessage(response.message); setFailed(!response.ok);
          if (response.ok) { setLabel(""); setPhone(""); setConsent(false); router.refresh(); }
        });
      }}>
        <label className="space-y-1 text-sm"><span>Nombre para identificar la fuente</span><input className={inputClass} maxLength={100} required disabled={!canAdd || pending} value={label} onChange={event => setLabel(event.target.value)} placeholder="Administración del local" /></label>
        <label className="space-y-1 text-sm"><span>Teléfono autorizado (con código de país)</span><input className={inputClass} type="tel" maxLength={30} required disabled={!canAdd || pending} value={phone} onChange={event => setPhone(event.target.value)} placeholder="+54 9 11 ..." /></label>
        <label className="space-y-1 text-sm"><span>Sucursal donde se revisan sus mensajes</span><select className={inputClass} required disabled={!canAdd || pending} value={branchId} onChange={event => setBranchId(event.target.value)}><option value="">Elegí una sucursal</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label className="flex items-start gap-2 text-xs text-ink-muted"><input className="mt-0.5" type="checkbox" checked={consent} disabled={!canAdd || pending} onChange={event => setConsent(event.target.checked)} /><span>Confirmo que tengo autorización para procesar los mensajes de este número para la gestión del negocio. Se almacenarán en el Inbox con revisión humana y sin ejecución automática.</span></label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" variant="primary" disabled={!canAdd || pending || !consent || !branchId}>{pending ? "Guardando..." : "Habilitar fuente de lectura"}</Button>
          <Link href="/inbox" className="text-sm text-brand-400 hover:underline">Abrir Inbox</Link>
        </div>
        {message ? <p role={failed ? "alert" : "status"} className={failed ? "text-sm text-danger-400" : "text-sm text-ink-muted"}>{message}</p> : null}
      </form>
    </CardContent>
  </Card>;
}
