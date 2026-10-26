"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UsersRound, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { GroupInfo, GroupReadiness, GroupSummary } from "@/lib/whatsapp/groups";
import type { MemberOption, BranchOption } from "./conversation-editor";

type Saved = { id: string; provider_conversation_id: string; display_name: string; branch_id: string; enabled: boolean; whatsapp_group_members: { member_id: string }[] };
type State = { readiness: GroupReadiness; groups: GroupSummary[]; saved: Saved[] };
type Details = { info: GroupInfo; inviteLink: string; requests: { id: string; phone: string }[] };
const fieldClass = "w-full rounded-lg border border-line bg-bg-subtle p-2.5 text-sm text-ink";

async function groupRequest(body: Record<string, unknown>) {
  const response = await fetch("/api/integrations/whatsapp/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw new Error(data.error || "No pudimos confirmar el resultado. Actualizá la lista antes de repetir la operación.");
  return data;
}

export function GroupEditor({ connected, members, branches }: { connected: boolean; members: MemberOption[]; branches: BranchOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State | null>(null);
  const [selected, setSelected] = useState("");
  const [details, setDetails] = useState<Details | null>(null);
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : "");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [createConfirmed, setCreateConfirmed] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [phoneMemberId, setPhoneMemberId] = useState("");
  const [memberPhone, setMemberPhone] = useState("");
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const saved = state?.saved.find(row => row.provider_conversation_id === selected);
  function run(action: () => Promise<void>) {
    setNotice(null); setFailed(false);
    startTransition(async () => {
      try { await action(); }
      catch (error) { setFailed(true); setNotice(error instanceof Error ? error.message : "No pudimos confirmar la operación."); }
    });
  }
  async function refresh() { const value = await groupRequest({ action: "list" }); setState(value); return value as State; }
  async function viewGroup(id: string) {
    const result = await groupRequest({ action: "details", groupId: id });
    setDetails(result);
  }
  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><UsersRound className="h-4 w-4" />Grupos de trabajo</CardTitle>
      <Badge tone={state?.readiness.ready ? "success" : "default"}>{state?.readiness.ready ? "Disponible" : "Requiere habilitación"}</Badge>
    </CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm text-ink-muted">Creá un grupo exclusivo para tu negocio, invitá al equipo y elegí qué integrantes pueden registrar operaciones. Cada grupo queda asociado a una sucursal.</p>
      <div className="rounded-xl border border-line bg-bg-subtle p-4 text-sm text-ink-muted">
        <p className="font-semibold text-ink">Grupos oficiales de WhatsApp · hasta 8 integrantes</p>
        <p className="mt-1">Meta exige un número de Cloud API con cuenta oficial aprobada (OBA). Los grupos creados en la app del celular no se importan a este listado.</p>
        {state ? <p className="mt-3 text-ink" role="status">{state.readiness.message}</p> : <p className="mt-3">Comprobá primero si el número vinculado cumple los requisitos.</p>}
      </div>
      <Button size="sm" disabled={!connected || pending} onClick={() => run(async () => { await refresh(); })}><RefreshCw className="mr-2 h-3.5 w-3.5" />{pending ? "Comprobando…" : state ? "Actualizar grupos y requisitos" : "Comprobar acceso a grupos"}</Button>
      {!connected ? <p className="text-sm text-ink-muted">Vinculá primero la cuenta de WhatsApp del negocio.</p> : null}
      {state?.readiness.ready ? <>
        {members.some(member => member.active && !member.phone) ? <details className="rounded-xl border border-line p-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink">Completar teléfonos del equipo</summary>
          <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); run(async () => { const result = await groupRequest({ action: "identify_member", memberId: phoneMemberId, phone: memberPhone, confirmed: phoneConfirmed }); setNotice(result.message); setPhoneConfirmed(false); setPhoneMemberId(""); setMemberPhone(""); router.refresh(); }); }}>
            <label className="block space-y-1 text-sm"><span>Persona sin teléfono registrado</span><select required className={fieldClass} value={phoneMemberId} disabled={pending} onChange={event => { setPhoneMemberId(event.target.value); setPhoneConfirmed(false); }}><option value="">Elegí una persona</option>{members.filter(member => member.active && !member.phone).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
            <label className="block space-y-1 text-sm"><span>Teléfono del integrante, con código de país</span><input required type="tel" maxLength={30} className={fieldClass} placeholder="+54 9 11 …" disabled={pending} value={memberPhone} onChange={event => { setMemberPhone(event.target.value); setPhoneConfirmed(false); }} /></label>
            <label className="flex items-start gap-2 text-xs text-ink-muted"><input type="checkbox" checked={phoneConfirmed} disabled={pending} onChange={event => setPhoneConfirmed(event.target.checked)} /><span>Confirmo que el teléfono pertenece a esta persona del equipo.</span></label>
            <Button type="submit" size="sm" disabled={pending || !phoneMemberId || !memberPhone || !phoneConfirmed}>Guardar teléfono del integrante</Button>
          </form>
        </details> : null}
        <details className="rounded-xl border border-line p-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink">Crear un grupo nuevo</summary>
          <form className="mt-4 space-y-3" onSubmit={event => {
            event.preventDefault();
            const id = requestId || crypto.randomUUID(); setRequestId(id);
            run(async () => {
              const result = await groupRequest({ action: "create", requestId: id, subject, description, confirmed: createConfirmed });
              setNotice(result.message); setCreateConfirmed(false); await refresh();
            });
          }}>
            <label className="block space-y-1 text-sm"><span>Nombre del grupo</span><input required maxLength={128} className={fieldClass} disabled={pending} value={subject} placeholder="GastroPilot · Operaciones del local" onChange={event => { setSubject(event.target.value); setRequestId(null); setCreateConfirmed(false); }} /></label>
            <label className="block space-y-1 text-sm"><span>Descripción del grupo</span><textarea maxLength={2048} className={fieldClass} disabled={pending} value={description} onChange={event => { setDescription(event.target.value); setCreateConfirmed(false); }} /></label>
            <label className="flex items-start gap-2 text-xs text-ink-muted"><input type="checkbox" disabled={pending} checked={createConfirmed} onChange={event => setCreateConfirmed(event.target.checked)} /><span>Confirmo la creación de este grupo en la cuenta del negocio. Cada persona ingresará con una invitación y aprobación.</span></label>
            <Button type="submit" variant="primary" size="sm" disabled={pending || !subject.trim() || !createConfirmed}>Solicitar creación del grupo</Button>
          </form>
        </details>
        <label className="block space-y-1 text-sm"><span>Elegí el grupo de trabajo</span><select className={fieldClass} value={selected} disabled={pending} onChange={event => {
          const id = event.target.value; const match = state.saved.find(row => row.provider_conversation_id === id);
          setSelected(id); setDetails(null); setConfirmed(false); setNotice(null); setMemberIds(match?.whatsapp_group_members.map(row => row.member_id) || []); setBranchId(match?.branch_id || (branches.length === 1 ? branches[0].id : ""));
          if (id) run(async () => { await viewGroup(id); });
        }}><option value="">Seleccioná un grupo</option>{state.groups.map(group => <option key={group.id} value={group.id}>{group.subject}</option>)}</select></label>
        {!state.groups.length ? <p className="text-sm text-ink-muted">Todavía no hay grupos oficiales disponibles para este número. Si acabás de crear uno, actualizá la lista cuando Meta lo confirme.</p> : null}
        {selected && details ? <div className="space-y-4 rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{details.info.subject}</h3><Badge tone={saved?.enabled ? "success" : "default"}>{saved?.enabled ? "Autorizado" : saved ? "Pausado" : "Sin configurar"}</Badge></div>
          <p className="text-xs text-ink-muted">{details.info.participants.length} integrantes presentes. Los mensajes anteriores a la autorización no se procesan.</p>
          <form className="space-y-4" onSubmit={event => { event.preventDefault(); run(async () => { const result = await groupRequest({ action: "authorize", groupId: selected, branchId, memberIds, confirmed }); setNotice(result.message); setConfirmed(false); await refresh(); router.refresh(); }); }}>
            <label className="block space-y-1 text-sm"><span>Sucursal del grupo</span><select required className={fieldClass} value={branchId} disabled={pending} onChange={event => { setBranchId(event.target.value); setConfirmed(false); }}><option value="">Elegí una sucursal</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Integrantes autorizados ({memberIds.length}/8)</legend>{members.filter(member => member.active).map(member => <label key={member.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={memberIds.includes(member.id)} disabled={pending || !member.phone || !memberIds.includes(member.id) && memberIds.length >= 8} onChange={event => { setMemberIds(ids => event.target.checked ? [...ids, member.id] : ids.filter(id => id !== member.id)); setConfirmed(false); }} /><span>{member.name}<span className="block text-xs text-ink-muted">{member.phone || "Completá su teléfono antes de autorizarlo"}</span></span></label>)}</fieldset>
            <Link href="/ajustes/equipo" className="inline-block text-xs text-brand-300 underline">Revisar personas y permisos del equipo</Link>
            <p className="text-xs leading-relaxed text-ink-muted">Las respuestas se ven por todos. El asistente usa los permisos comunes de los integrantes presentes y la sucursal del grupo. Una persona sin autorización detiene el procesamiento hasta que revises el acceso.</p>
            <label className="flex items-start gap-2 text-xs text-ink-muted"><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} /><span>Confirmo los integrantes, la sucursal y que las respuestas del asistente serán compartidas en este grupo.</span></label>
            <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" size="sm" disabled={pending || !confirmed || !branchId || !memberIds.length}>Autorizar grupo</Button>{saved?.enabled ? <Button type="button" size="sm" disabled={pending} onClick={() => run(async () => { const result = await groupRequest({ action: "pause", conversationId: saved.id }); setNotice(result.message); await refresh(); router.refresh(); })}>Pausar procesamiento</Button> : null}</div>
          </form>
          <div className="space-y-2 border-t border-line pt-4"><p className="text-sm font-semibold">Invitación al grupo</p><p className="text-xs text-ink-muted">Compartí este enlace con las personas que autorizaste. Podrás aprobar su ingreso cuando lo soliciten.</p><input className={fieldClass} aria-label="Enlace de invitación al grupo" readOnly value={details.inviteLink} /><Button size="sm" disabled={pending} onClick={() => run(async () => { await navigator.clipboard.writeText(details.inviteLink); setNotice("Enlace copiado."); })}>Copiar invitación</Button></div>
          <div className="space-y-2 border-t border-line pt-4"><p className="text-sm font-semibold">Solicitudes para ingresar</p>{details.requests.length ? details.requests.map(request => <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3"><span className="text-sm">+{request.phone}</span><Button size="sm" disabled={pending || !saved?.enabled} onClick={() => run(async () => { const result = await groupRequest({ action: "approve", groupId: selected, joinRequestId: request.id, confirmed: true }); setNotice(result.message); await viewGroup(selected); })}>Aprobar persona autorizada</Button></div>) : <p className="text-xs text-ink-muted">No hay solicitudes pendientes.</p>}<Button size="sm" disabled={pending} onClick={() => run(async () => { await viewGroup(selected); })}>Actualizar integrantes</Button></div>
        </div> : null}
      </> : null}
      {state && !state.readiness.ready && state.saved.some(group => group.enabled) ? <div className="space-y-2">{state.saved.filter(group => group.enabled).map(group => <div key={group.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3"><span className="text-sm">{group.display_name}</span><Button size="sm" disabled={pending} onClick={() => run(async () => { await groupRequest({ action: "pause", conversationId: group.id }); await refresh(); })}>Pausar procesamiento</Button></div>)}</div> : null}
      {notice ? <p role={failed ? "alert" : "status"} className={`text-sm ${failed ? "text-danger-400" : "text-ink-muted"}`}>{notice}</p> : null}
    </CardContent>
  </Card>;
}
