"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { approveInboxClosureAction } from "@/app/actions/inbox-closures";
import { inboxClosureJournalKey, parseInboxClosureApproval, recoverInboxClosure, type InboxClosureApproval, type InboxClosureReview } from "@/lib/closures/inbox";
const field = "w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink";
export function InboxClosureReviewDialog({ review, onClose, onSaved }: { review: InboxClosureReview; onClose: () => void; onSaved: () => void }) {
  const [branch, setBranch] = useState(review.branchId ?? ""); const [date, setDate] = useState(review.closureDate); const [gross, setGross] = useState(review.grossTotal); const [net, setNet] = useState(review.netTotal); const [note, setNote] = useState(review.note);
  const [error, setError] = useState(""); const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [ready, setReady] = useState(false); const [storageError, setStorageError] = useState(false);
  const lock = useRef(false); const frozen = useRef<InboxClosureApproval | null>(null); const key = inboxClosureJournalKey(review);
  useEffect(() => {
    try {
      const stored = recoverInboxClosure(sessionStorage.getItem(key), review);
      if (stored) { frozen.current = stored; setUncertain(true); setBranch(stored.review.branchId); setDate(stored.review.closureDate); setGross(stored.review.grossTotal); setNet(stored.review.netTotal); setNote(stored.review.note); }
    } catch { setStorageError(true); setError("No pudimos recuperar la revisión guardada. No se enviarán cambios hasta verificar el registro en Cierres."); }
    setReady(true);
  }, [key, review]);
  async function submit() {
    if (lock.current || !ready || storageError) return;
    let proposal: InboxClosureApproval;
    try { proposal = frozen.current ?? parseInboxClosureApproval({ extractionId: review.extractionId, businessId: review.businessId, userId: review.userId, expectedFields: review.expectedFields, review: { branchId: branch, closureDate: date, grossTotal: gross.replace(",", "."), netTotal: net.replace(",", "."), note } }); }
    catch (err) { setError(err instanceof Error ? err.message : "Revisá los datos."); return; }
    try { sessionStorage.setItem(key, JSON.stringify(proposal)); }
    catch { setStorageError(true); setError("No pudimos conservar el intento. No se enviaron cambios; revisá el almacenamiento del navegador."); return; }
    const recovering = frozen.current !== null; frozen.current = proposal; lock.current = true; setPending(true); setError("");
    try {
      const result = await approveInboxClosureAction(proposal);
      if (result.ok) {
        try { sessionStorage.removeItem(key); } catch { setStorageError(true); setError("El cierre quedó confirmado, pero no se pudo limpiar la referencia local. Revisá Cierres antes de continuar."); return; }
        onSaved(); return;
      }
      setError(result.error);
      if (result.persisted === "unknown" || recovering) setUncertain(true);
      else { try { sessionStorage.removeItem(key); frozen.current = null; } catch { setStorageError(true); } }
    } catch { setUncertain(true); setError("El resultado podría estar guardado. Reintentá esta misma revisión; sus datos se conservan al cerrar o recargar."); }
    finally { lock.current = false; setPending(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="closure-review-title"><section className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-line bg-bg-elevated p-6">
    <h2 id="closure-review-title" className="text-lg font-semibold">Revisar cierre</h2>
    <p className="text-sm text-ink-muted">Revisá la fecha, el bruto y el neto del resumen operativo. Se conservan el mensaje y la extracción originales. Esta aprobación no crea ventas, gastos, movimientos de stock ni pagos.</p>
    <fieldset disabled={!ready || pending || uncertain || storageError} className="space-y-4">
      <label className="block text-sm">Sucursal<select aria-label="Sucursal del cierre" className={field} value={branch} disabled={review.branchId !== null} onChange={(e) => setBranch(e.target.value)}><option value="">Seleccioná una sucursal</option>{review.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="block text-sm">Fecha del cierre<input aria-label="Fecha del cierre" type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="block text-sm">Total bruto<input aria-label="Total bruto del cierre" inputMode="decimal" className={field} value={gross} onChange={(e) => setGross(e.target.value)} /></label>
      <label className="block text-sm">Total neto<input aria-label="Total neto del cierre" inputMode="decimal" className={field} value={net} onChange={(e) => setNet(e.target.value)} /></label>
      <label className="block text-sm">Nota de revisión<textarea aria-label="Nota de revisión del cierre" className={field} rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </fieldset>
    {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
    {uncertain && <p className="text-sm text-warn-400">Resultado sin confirmar. Conservamos esta revisión exacta al cerrar o recargar. No crees otro cierre para reemplazar este intento.</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={pending} onClick={onClose}>{uncertain ? "Cerrar y revisar" : "Cancelar"}</Button><Button disabled={!ready || pending || storageError} onClick={() => void submit()}>{pending ? "Guardando…" : uncertain ? "Reintentar misma revisión" : "Confirmar cierre"}</Button></div>
  </section></div>;
}
