"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { approveInboxAdvanceAction } from "@/app/actions/inbox-advances";
import { advanceJournalKey, parseAdvanceApproval, recoverAdvance, type AdvanceApproval, type AdvanceReview } from "@/lib/advances/inbox";
const field = "w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink";
export function InboxAdvanceReviewDialog({ review, onClose, onSaved }: { review: AdvanceReview; onClose: () => void; onSaved: () => void }) {
  // A detected name never selects a payroll identity, even when there is one match.
  const [employeeId, setEmployeeId] = useState(""); const [amount, setAmount] = useState(review.amount); const [date, setDate] = useState(review.date); const [note, setNote] = useState(""); const [savedBranch, setSavedBranch] = useState<string | null>(null);
  const [error, setError] = useState(""); const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [ready, setReady] = useState(false); const [storageError, setStorageError] = useState(false);
  const lock = useRef(false); const frozen = useRef<AdvanceApproval | null>(null); const key = advanceJournalKey(review);
  const employee = review.employees.find(e => e.id === employeeId);
  const dialog = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current; node?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); if (!lock.current) onClose(); }
      if (event.key !== "Tab" || !node) return;
      const controls = Array.from(node.querySelectorAll<HTMLElement>('button,select,input,textarea,a[href],[tabindex]:not([tabindex="-1"])')).filter(control => !control.matches(":disabled") && control.getAttribute("aria-hidden") !== "true");
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); node.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) { event.preventDefault(); first.focus(); }
    }
    node?.addEventListener("keydown", keyboard);
    return () => { node?.removeEventListener("keydown", keyboard); previous?.focus(); };
  }, [onClose]);
  useEffect(() => {
    try {
      const stored = recoverAdvance(sessionStorage.getItem(key), review);
      if (stored) { frozen.current = stored; setUncertain(true); setSavedBranch(stored.review.branchId); setEmployeeId(stored.review.employeeId); setAmount(stored.review.amount); setDate(stored.review.date); setNote(stored.review.note); }
    } catch { setStorageError(true); setError("No pudimos recuperar la revisión guardada. No se enviarán cambios hasta verificar la auditoría del adelanto."); }
    setReady(true);
  }, [key, review]);
  async function submit() {
    if (lock.current || !ready || storageError || review.closed && !frozen.current) return;
    let proposal: AdvanceApproval;
    try { proposal = frozen.current ?? parseAdvanceApproval({ extractionId: review.extractionId, businessId: review.businessId, userId: review.userId, expectedFields: review.expectedFields, review: { employeeId, expectedEmployeeUpdatedAt: employee?.updatedAt, branchId: employee?.branchId, amount: amount.replace(",", "."), date, note } }); }
    catch (err) { setError(err instanceof Error ? err.message : "Revisá los datos."); return; }
    try { sessionStorage.setItem(key, JSON.stringify(proposal)); }
    catch { setStorageError(true); setError("No pudimos conservar el intento. No se enviaron cambios; revisá el almacenamiento del navegador."); return; }
    const recovering = frozen.current !== null; frozen.current = proposal; lock.current = true; setPending(true); setError("");
    try {
      const result = await approveInboxAdvanceAction(proposal);
      if (result.ok) {
        try { sessionStorage.removeItem(key); } catch { setStorageError(true); setError("El adelanto quedó confirmado, pero no se pudo limpiar la referencia local. Revisá la auditoría antes de continuar."); return; }
        onSaved(); return;
      }
      setError(result.error);
      if (result.persisted === "unknown" || recovering) setUncertain(true);
      else { try { sessionStorage.removeItem(key); frozen.current = null; } catch { setStorageError(true); } }
    } catch { setUncertain(true); setError("El resultado podría estar guardado. Reintentá esta misma revisión; sus datos se conservan al cerrar o recargar."); }
    finally { lock.current = false; setPending(false); }
  }
  const closedWithoutAttempt = review.closed && ready && !uncertain;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="advance-review-title"><section ref={dialog} tabIndex={-1} className="outline-none max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-line bg-bg-elevated p-6">
    <h2 id="advance-review-title" className="text-lg font-semibold">Revisar adelanto</h2>
    <p className="text-sm text-ink-muted">Elegí el empleado exacto y confirmá fecha e importe. Se registra el adelanto informado como pendiente. No se ejecuta ningún pago ni se modifica el saldo manual de adelantos de su ficha.</p>
    {review.detectedName && <p className="text-sm break-words">Nombre detectado: {review.detectedName}</p>}
    {closedWithoutAttempt ? <p className="text-sm break-words">Esta extracción ya está aprobada. Registro: {review.targetAdvanceId ?? "ver auditoría"}.</p> : <fieldset disabled={!ready || pending || uncertain || storageError} className="space-y-4">
      <label className="block text-sm">Empleado exacto<select aria-label="Empleado del adelanto" className={field} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}><option value="">Seleccioná un empleado activo</option>{review.employees.map(e => <option key={e.id} value={e.id}>{e.fullName} · {e.role} · {e.branchName} · {e.id}</option>)}{employeeId && !employee && <option value={employeeId}>Empleado del intento guardado · {employeeId}</option>}</select></label>
      {!review.employees.length && !uncertain && <p className="text-sm text-warn-400">No hay empleados activos disponibles en esta sucursal. Revisá sus fichas en Equipo.</p>}
      {employeeId && <p className="break-all text-xs text-ink-muted">ID: {employeeId}<br />Sucursal: {savedBranch ?? employee?.branchId}</p>}
      <label className="block text-sm">Importe<input aria-label="Importe del adelanto" inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="block text-sm">Fecha del adelanto<input aria-label="Fecha del adelanto" type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="block text-sm">Nota (opcional)<textarea aria-label="Nota del adelanto" className={field} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </fieldset>}
    {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
    {uncertain && <p className="text-sm text-warn-400">Resultado sin confirmar. Conservamos esta revisión exacta al cerrar o recargar. No crees otro adelanto para reemplazar este intento.</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={pending} onClick={onClose}>{uncertain || review.closed ? "Cerrar y revisar" : "Cancelar"}</Button>{!closedWithoutAttempt && <Button disabled={!ready || pending || storageError} onClick={() => void submit()}>{pending ? "Guardando…" : uncertain ? "Reintentar misma revisión" : "Confirmar adelanto"}</Button>}</div>
  </section></div>;
}
