"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveWhatsAppConversation } from "@/app/actions/whatsapp-conversations";
export type MemberOption = { id: string; name: string; phone: string | null; active: boolean };
export type BranchOption = { id: string; name: string };
export function ConversationEditor({ connected, members, branches }: { connected: boolean; members: MemberOption[]; branches: BranchOption[] }) {
  const [memberId, setMember] = useState("");
  const [branchId, setBranch] = useState("");
  const [phone, setPhone] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!connected) return <p className="text-sm text-ink-muted">Vinculá primero la cuenta del negocio. Después podés autorizar acá los chats directos del equipo.</p>;
  if (!members.some(member => member.active)) return <p className="text-sm text-ink-muted">Necesitás una persona activa en Equipo y roles para autorizar su conversación.</p>;
  const selected = members.find(member => member.id === memberId);
  const inputClass = "w-full rounded-lg border border-line bg-bg-subtle p-2.5 text-sm text-ink";
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveWhatsAppConversation({ memberId, branchId: branchId || null, enabled, phone, confirmed });
      setStatus(result.message); if (result.ok) setConfirmed(false);
    });
  }}>
    <label className="block space-y-1 text-sm text-ink"><span>Persona del equipo</span><select required disabled={pending} className={inputClass} value={memberId} onChange={event => { setMember(event.target.value); setPhone(members.find(member => member.id === event.target.value)?.phone || ""); setConfirmed(false); setStatus(null); }}><option value="">Elegí una persona</option>{members.filter(member => member.active).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
    <label className="block space-y-1 text-sm text-ink"><span>WhatsApp de esa persona, con código de país</span><input required type="tel" maxLength={30} disabled={pending || Boolean(selected?.phone)} className={inputClass} placeholder="+54 9 11 …" value={phone} onChange={event => { setPhone(event.target.value); setConfirmed(false); }} /></label>
    <label className="block space-y-1 text-sm text-ink"><span>Sucursal de esta conversación</span><select disabled={pending} className={inputClass} value={branchId} onChange={event => { setBranch(event.target.value); setConfirmed(false); }}><option value="">Según los permisos de la persona</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
    <label className="block space-y-1 text-sm text-ink"><span>Acceso por este chat</span><select className={inputClass} disabled={pending} value={enabled ? "enabled" : "paused"} onChange={event => { setEnabled(event.target.value === "enabled"); setConfirmed(false); }}><option value="enabled">Autorizar</option><option value="paused">Pausar</option></select></label>
    <label className="flex items-start gap-2 text-xs leading-relaxed text-ink-muted"><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5" /><span>Confirmo que este teléfono pertenece a la persona seleccionada y que {enabled ? "puede operar" : "debe dejar de operar"} por WhatsApp con sus permisos actuales.</span></label>
    <Button variant="primary" size="sm" disabled={pending || !confirmed || !memberId || !phone} type="submit">{pending ? "Guardando…" : "Guardar autorización"}</Button>
    {status ? <p role="status" className="text-sm text-ink-muted">{status}</p> : null}
  </form>;
}
