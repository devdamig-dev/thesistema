"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createEmployeeManualAction, getEmployeeManualAction, updateEmployeeManualAction } from "@/app/actions/employees-page";
import { employeeTextLimits, employeeNumericFields, employeeRpcFields, isEmployeeId, employeeToFields, validateEmployeeFields,
  type EmployeeCreateInput, type EmployeeFields, type EmployeeRow } from "@/lib/employees/domain";

const inputClass = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand-500 disabled:opacity-60";
const empty: EmployeeFields = { fullName: "", role: "", shift: "", branchId: "", monthlyHours: "0", monthlyCost: "0", pendingAdvance: "0", absences: "0", lateArrivals: "0" };

export function EmployeeForm({ employee, branches, draftScope, onSaved, onCancel, onBusyChange }: {
  employee?: EmployeeRow; branches: { id: string; name: string }[]; draftScope: string; onSaved: (employee: EmployeeRow) => void;
  onCancel: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [row, setRow] = useState(employee);
  const [fields, setFields] = useState<EmployeeFields>(employee ? employeeToFields(employee) : empty);
  const [attempt, setAttempt] = useState<EmployeeCreateInput | null>(null);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [verifiedAbsent, setVerifiedAbsent] = useState(false);
  const busy = useRef(false);
  const storageKey = `thesistema:employee-create:v1:${draftScope}`;

  useEffect(() => {
    if (!employee) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const saved = JSON.parse(raw) as EmployeeCreateInput;
          if (!isEmployeeId(saved.id) || validateEmployeeFields(saved)) throw new Error("invalid draft");
          setAttempt(saved); setFields(saved);
          setError("Hay un alta pendiente de confirmar en esta pestaña. Verificá el resultado para retomarla sin duplicarla.");
        }
      } catch { setError("No pudimos recuperar el intento anterior. Habilitá el almacenamiento de esta pestaña antes de continuar."); setBlocked(true); }
    }
    setReady(true);
  }, [storageKey, employee]);

  function setBusy(value: boolean) { busy.current = value; setPending(value); onBusyChange?.(value); }
  function finish(saved: EmployeeRow) {
    if (!row) {
      try { sessionStorage.removeItem(storageKey); } catch {
        // The stable ID remains recoverable; opening again verifies this same row.
      }
    }
    setAttempt(null);
    onSaved(saved);
  }
  async function sendCreate(request: EmployeeCreateInput, recovery: boolean) {
    if (busy.current) return;
    setBusy(true); setError(""); setVerifiedAbsent(false);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(request));
    } catch { setBusy(false); setError("No pudimos guardar el identificador del intento en esta pestaña. Habilitá su almacenamiento para continuar de forma segura."); return; }
    setAttempt(request);
    try {
      const result = await createEmployeeManualAction(request);
      if (result.ok) { finish(result.employee); return; }
      setError("message" in result ? result.message : result.error);
      if (!recovery && result.persisted === false && (!("status" in result) || result.status === "rejected")) {
        sessionStorage.removeItem(storageKey); setAttempt(null);
      }
    } catch { setError("La conexión se interrumpió. Verificá si el empleado se guardó antes de continuar."); }
    finally { setBusy(false); }
  }
  async function verify() {
    if (busy.current) return;
    const id = attempt?.id ?? row?.id;
    if (!id) return;
    setBusy(true); setVerifiedAbsent(false);
    try {
      const result = await getEmployeeManualAction(id);
      if (!result.ok) { setError(result.error); return; }
      if (result.employee) {
        if (attempt) {
          const expected = JSON.stringify(employeeRpcFields(attempt));
          const actual = JSON.stringify(employeeRpcFields(employeeToFields(result.employee)));
          if (expected === actual && result.employee.active) finish(result.employee);
          else {
            sessionStorage.removeItem(storageKey); setAttempt(null); setRow(result.employee); setFields(employeeToFields(result.employee)); setBlocked(false);
            setError("El empleado ya existe con otros cambios. Cargamos el estado guardado para que lo revises.");
          }
        }
        else { setRow(result.employee); setFields(employeeToFields(result.employee)); setBlocked(false); setError("Se cargaron los datos guardados. Revisalos antes de volver a editar."); }
      } else if (attempt) { setVerifiedAbsent(true); setError("Todavía no aparece registrado. Podés reenviar exactamente este intento con el mismo identificador, sin crear un duplicado."); }
      else setError("El empleado ya no está disponible.");
    } catch { setError("No pudimos verificar el resultado. Conservamos el intento para que lo revises cuando vuelva la conexión."); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || blocked || attempt || !ready) return;
    const validation = validateEmployeeFields(fields);
    if (validation) { setError(validation); return; }
    if (!row) { await sendCreate({ ...fields, id: crypto.randomUUID() }, false); return; }
    setBusy(true); setError("");
    try {
      const result = await updateEmployeeManualAction({ ...fields, id: row.id, expectedUpdatedAt: row.updatedAt });
      if (result.ok) { finish(result.employee); return; }
      setError("message" in result ? result.message : result.error);
      if ("status" in result && result.status !== "rejected") setBlocked(true);
    } catch { setError("No pudimos confirmar el cambio. Recargá los datos guardados antes de continuar."); setBlocked(true); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4 p-6">
    <fieldset disabled={pending || !!attempt || blocked || !ready} className="space-y-4">
      <p className="text-xs text-ink-muted">Ficha operativa de nómina. El rol describe su trabajo; no crea una cuenta ni cambia permisos de acceso. Los importes son saldos manuales, no pagos.</p>
      {(["fullName", "role", "shift"] as const).map((key) => <label key={key} className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-muted">{{ fullName: "Nombre completo *", role: "Rol operativo *", shift: "Turno" }[key]}</span>
        <input className={inputClass} required={key !== "shift"} maxLength={employeeTextLimits[key]} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />
      </label>)}
      <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-muted">Sucursal *</span><select aria-label="Sucursal *" className={inputClass} required value={fields.branchId} onChange={(e) => setFields({ ...fields, branchId: e.target.value })}><option value="">Elegí una sucursal</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      {!branches.length && <p className="text-sm text-warn-400">Necesitás una sucursal disponible para guardar empleados.</p>}
      <div className="grid gap-4 sm:grid-cols-2">{(Object.keys(employeeNumericFields) as (keyof typeof employeeNumericFields)[]).map((key) => <label key={key} className="block space-y-1.5"><span className="text-xs font-medium text-ink-muted">{employeeNumericFields[key].label}</span><input className={inputClass} required type="number" min="0" max={employeeNumericFields[key].max} step={employeeNumericFields[key].integer ? "1" : "0.01"} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} /></label>)}</div>
    </fieldset>
    {error && <p role="alert" className="rounded-lg border border-warn-500/30 p-3 text-sm text-ink-muted">{error}</p>}
    {(attempt || blocked && row) && <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={pending} onClick={() => void verify()}>{attempt ? "Verificar resultado" : "Recargar datos guardados"}</Button>
      {attempt && verifiedAbsent && <Button type="button" disabled={pending} onClick={() => void sendCreate(attempt, true)}>Reenviar el mismo intento</Button>}
    </div>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cerrar</Button>
      {!attempt && !blocked && <Button type="submit" variant="primary" disabled={pending || !ready || !branches.length}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Guardar empleado</Button>}
    </div>
  </form>;
}
