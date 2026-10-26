"use client";
import { useState } from "react";
import Link from "next/link";
import { X, Users } from "lucide-react";
import type { ChatSnapshot } from "@/lib/chat/types";
import { chatRequest } from "./api";

export function RoomEditor({ data, editing, onClose, onSaved }: { data: ChatSnapshot; editing: boolean; onClose(): void; onSaved(id: string): void }) {
  const [roomId] = useState(() => editing && data.room ? data.room.id : crypto.randomUUID());
  const [name, setName] = useState(editing ? data.room?.name ?? "" : "Administración");
  const [branchId, setBranch] = useState(editing ? data.room?.branch_id ?? "" : data.branches[0]?.id ?? "");
  const [members, setMembers] = useState<string[]>(editing ? data.participants?.map(p => p.member_id).filter(id => data.members.some(m => m.id === id && m.active && (m.branchIds === null || m.branchIds.includes(branchId)))) ?? [data.me.id] : [data.me.id]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await chatRequest({ action: "configure", roomId, branchId, name, memberIds: members });
      onSaved(roomId);
    } catch (e) { setError(e instanceof Error ? e.message : "No pudimos guardar el grupo."); }
    finally { setBusy(false); }
  }
  return <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 p-3" role="dialog" aria-modal="true" aria-labelledby="room-editor-title">
    <form onSubmit={save} className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-bg p-5 shadow-2xl">
      <div className="mb-5 flex items-center justify-between"><h2 id="room-editor-title" className="flex items-center gap-2 text-lg font-semibold"><Users className="h-5 w-5 text-brand-400" />{editing ? "Configurar grupo" : "Nuevo grupo"}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar configuración" className="rounded-lg p-2 hover:bg-bg-elevated"><X className="h-5 w-5" /></button></div>
      <label className="block text-sm">Nombre del grupo<input autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-bg-subtle p-3" /></label>
      <label className="mt-4 block text-sm">Sucursal<select required value={branchId} disabled={editing} onChange={e => { setBranch(e.target.value); setMembers([data.me.id]); }} className="mt-1.5 w-full rounded-lg border border-line bg-bg-subtle p-3"><option value="" disabled>Elegí una sucursal</option>{data.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <fieldset className="mt-5"><legend className="mb-2 text-sm font-medium">Integrantes del negocio</legend><div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-line p-2">{data.members.filter(m => m.active && (m.branchIds === null || m.branchIds.includes(branchId))).map(m => <label key={m.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-bg-elevated"><input type="checkbox" checked={members.includes(m.id)} disabled={m.id === data.me.id} onChange={e => setMembers(ids => e.target.checked ? [...ids, m.id] : ids.filter(id => id !== m.id))} className="h-4 w-4 accent-brand-500" /><span className="text-sm">{m.name}{m.id === data.me.id ? " (vos)" : ""}</span></label>)}</div></fieldset>
      <p className="mt-3 text-xs leading-relaxed text-ink-muted">Cada integrante entra con su cuenta. Los nuevos integrantes ven mensajes desde que se suman. La IA respeta los permisos que comparten todos.</p>
      <Link href="/ajustes/equipo" className="mt-3 inline-block text-sm text-brand-300 underline">Invitar personas en Equipo y roles</Link>
      {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
      <button disabled={busy || !branchId || !name.trim()} className="mt-5 w-full rounded-xl bg-brand-500 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Guardando…" : editing ? "Guardar integrantes y permisos" : "Crear grupo"}</button>
    </form>
  </div>;
}
