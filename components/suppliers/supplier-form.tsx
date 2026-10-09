"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupplierManualAction, getSupplierManualAction, updateSupplierManualAction } from "@/app/actions/suppliers-page";
import { fieldLabels, isSupplierId, normalizeSupplierFields, supplierFieldLimits, supplierToFields, validateSupplierFields,
  type SupplierCreateInput, type SupplierFields, type SupplierRow } from "@/lib/suppliers/domain";

const inputClass = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand-500 disabled:opacity-60";
const empty: SupplierFields = { name: "", taxId: "", category: "", phone: "", email: "", paymentTerms: "", notes: "" };

export function SupplierForm({ supplier, draftScope, onSaved, onCancel, onBusyChange }: {
  supplier?: SupplierRow; draftScope: string; onSaved: (supplier: SupplierRow) => void;
  onCancel: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [row, setRow] = useState(supplier);
  const [fields, setFields] = useState<SupplierFields>(supplier ? supplierToFields(supplier) : empty);
  const [attempt, setAttempt] = useState<SupplierCreateInput | null>(null);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [verifiedAbsent, setVerifiedAbsent] = useState(false);
  const busy = useRef(false);
  const storageKey = `thesistema:supplier-create:v1:${draftScope}`;

  useEffect(() => {
    if (!supplier) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const saved = JSON.parse(raw) as SupplierCreateInput;
          if (!isSupplierId(saved.id) || validateSupplierFields(saved)) throw new Error("invalid draft");
          setAttempt(saved); setFields(saved);
          setError("Hay un alta pendiente de confirmar en esta pestaña. Verificá el resultado para retomarla sin duplicarla.");
        }
      } catch { setError("No pudimos recuperar el intento anterior. Habilitá el almacenamiento de esta pestaña antes de continuar."); setBlocked(true); }
    }
    setReady(true);
  }, [storageKey, supplier]);

  function setBusy(value: boolean) { busy.current = value; setPending(value); onBusyChange?.(value); }
  function finish(saved: SupplierRow) {
    if (!row) {
      try { sessionStorage.removeItem(storageKey); } catch {
        // The stable ID remains recoverable; opening again verifies this same row.
      }
    }
    setAttempt(null);
    onSaved(saved);
  }
  async function sendCreate(request: SupplierCreateInput, recovery: boolean) {
    if (busy.current) return;
    setBusy(true); setError(""); setVerifiedAbsent(false);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(request));
    } catch { setBusy(false); setError("No pudimos guardar el identificador del intento en esta pestaña. Habilitá su almacenamiento para continuar de forma segura."); return; }
    setAttempt(request);
    try {
      const result = await createSupplierManualAction(request);
      if (result.ok) { finish(result.supplier); return; }
      setError("message" in result ? result.message : result.error);
      if (!recovery && result.persisted === false && (!("status" in result) || result.status === "rejected")) {
        sessionStorage.removeItem(storageKey); setAttempt(null);
      }
    } catch { setError("La conexión se interrumpió. Verificá si el proveedor se guardó antes de continuar."); }
    finally { setBusy(false); }
  }
  async function verify() {
    if (busy.current) return;
    const id = attempt?.id ?? row?.id;
    if (!id) return;
    setBusy(true); setVerifiedAbsent(false);
    try {
      const result = await getSupplierManualAction(id);
      if (!result.ok) { setError(result.error); return; }
      if (result.supplier) {
        if (attempt) finish(result.supplier);
        else { setRow(result.supplier); setFields(supplierToFields(result.supplier)); setBlocked(false); setError("Se cargaron los datos guardados. Revisalos antes de volver a editar."); }
      } else if (attempt) { setVerifiedAbsent(true); setError("Todavía no aparece registrado. Podés reenviar exactamente este intento con el mismo identificador, sin crear un duplicado."); }
      else setError("El proveedor ya no está disponible.");
    } catch { setError("No pudimos verificar el resultado. Conservamos el intento para que lo revises cuando vuelva la conexión."); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || blocked || attempt || !ready) return;
    const validation = validateSupplierFields(fields);
    if (validation) { setError(validation); return; }
    if (!row) { await sendCreate({ ...normalizeSupplierFields(fields), id: crypto.randomUUID() }, false); return; }
    setBusy(true); setError("");
    try {
      const result = await updateSupplierManualAction({ ...fields, id: row.id, expectedUpdatedAt: row.updated_at });
      if (result.ok) { finish(result.supplier); return; }
      setError("message" in result ? result.message : result.error);
      if ("status" in result && result.status !== "rejected") setBlocked(true);
    } catch { setError("No pudimos confirmar el cambio. Recargá los datos guardados antes de continuar."); setBlocked(true); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4 p-6">
    <fieldset disabled={pending || !!attempt || blocked || !ready} className="space-y-4">
      {(["name", "category", "taxId", "phone", "email", "paymentTerms", "notes"] as const).map((key) => <label key={key} className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-muted">{fieldLabels[key]}{key === "name" ? " *" : ""}</span>
        {key === "paymentTerms" || key === "notes"
          ? <textarea className={inputClass} rows={key === "notes" ? 4 : 2} maxLength={supplierFieldLimits[key]} value={fields[key] ?? ""} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />
          : <input className={inputClass} required={key === "name"} type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} maxLength={supplierFieldLimits[key]} value={fields[key] ?? ""} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />}
      </label>)}
    </fieldset>
    {error && <p role="alert" className="rounded-lg border border-warn-500/30 p-3 text-sm text-ink-muted">{error}</p>}
    {(attempt || blocked && row) && <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={pending} onClick={() => void verify()}>{attempt ? "Verificar resultado" : "Recargar datos guardados"}</Button>
      {attempt && verifiedAbsent && <Button type="button" disabled={pending} onClick={() => void sendCreate(attempt, true)}>Reenviar el mismo intento</Button>}
    </div>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cerrar</Button>
      {!attempt && !blocked && <Button type="submit" variant="primary" disabled={pending || !ready}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Guardar proveedor</Button>}
    </div>
  </form>;
}
