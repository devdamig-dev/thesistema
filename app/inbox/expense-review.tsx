"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { approveInboxExpenseAction } from "@/app/actions/inbox-expenses";
import { inboxExpenseJournalKey, parseInboxExpenseApproval, recoverInboxExpense, type InboxExpenseApproval, type InboxExpenseReview } from "@/lib/expenses/inbox";
const field = "w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink";
export function InboxExpenseReviewDialog({ review, onClose, onSaved }: { review: InboxExpenseReview; onClose: () => void; onSaved: () => void }) {
  const [branch, setBranch] = useState(review.branchId ?? ""); const [name, setName] = useState(review.name); const [category, setCategory] = useState(review.category); const [amount, setAmount] = useState(review.amount); const [date, setDate] = useState(review.dueDate ?? "");
  // A payment method or extracted amount does not prove that payment happened.
  const [status, setStatus] = useState("");
  const [error, setError] = useState(""); const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [ready, setReady] = useState(false); const [storageError, setStorageError] = useState(false);
  const lock = useRef(false); const frozen = useRef<InboxExpenseApproval | null>(null); const key = inboxExpenseJournalKey(review);
  useEffect(() => {
    try {
      const stored = recoverInboxExpense(sessionStorage.getItem(key), review);
      if (stored) { frozen.current = stored; setUncertain(true); setBranch(stored.review.branchId); setName(stored.review.name); setCategory(stored.review.category); setAmount(stored.review.amount); setDate(stored.review.dueDate ?? ""); setStatus(stored.review.status); }
    } catch { setStorageError(true); setError("No pudimos recuperar la revisión guardada. No se enviarán cambios hasta verificar el registro en Gastos."); }
    setReady(true);
  }, [key, review]);
  async function submit() {
    if (lock.current || !ready || storageError) return;
    let proposal: InboxExpenseApproval;
    try { proposal = frozen.current ?? parseInboxExpenseApproval({ extractionId: review.extractionId, businessId: review.businessId, userId: review.userId, expectedFields: review.expectedFields, review: { branchId: branch, name, category, amount: amount.replace(",", "."), dueDate: date || null, status } }); }
    catch (err) { setError(err instanceof Error ? err.message : "Revisá los datos."); return; }
    try { sessionStorage.setItem(key, JSON.stringify(proposal)); }
    catch { setStorageError(true); setError("No pudimos conservar el intento. No se enviaron cambios; revisá el almacenamiento del navegador."); return; }
    const recovering = frozen.current !== null; frozen.current = proposal; lock.current = true; setPending(true); setError("");
    try {
      const result = await approveInboxExpenseAction(proposal);
      if (result.ok) {
        try { sessionStorage.removeItem(key); } catch { setStorageError(true); setError("El gasto quedó confirmado, pero no se pudo limpiar la referencia local. Revisá Gastos antes de continuar."); return; }
        onSaved(); return;
      }
      setError(result.error);
      if (result.persisted === "unknown" || recovering) setUncertain(true);
      else { try { sessionStorage.removeItem(key); frozen.current = null; } catch { setStorageError(true); } }
    } catch { setUncertain(true); setError("El resultado podría estar guardado. Reintentá esta misma revisión; sus datos se conservan al cerrar o recargar."); }
    finally { lock.current = false; setPending(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="expense-review-title"><section className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-line bg-bg-elevated p-6">
    <h2 id="expense-review-title" className="text-lg font-semibold">Revisar gasto</h2>
    <p className="text-sm text-ink-muted">Confirmá concepto, monto y estado contable. Marcar pagado no ejecuta un pago. La fecha del mensaje no se usa como vencimiento.</p>
    <fieldset disabled={!ready || pending || uncertain || storageError} className="space-y-4">
      <label className="block text-sm">Sucursal<select aria-label="Sucursal del gasto" className={field} value={branch} disabled={review.branchId !== null} onChange={(e) => setBranch(e.target.value)}><option value="">Seleccioná una sucursal</option>{review.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="block text-sm">Concepto<input aria-label="Concepto del gasto" className={field} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block text-sm">Categoría<input aria-label="Categoría del gasto" className={field} maxLength={80} value={category} onChange={(e) => setCategory(e.target.value)} /></label>
      <label className="block text-sm">Monto<input aria-label="Monto del gasto" inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="block text-sm">Vencimiento (opcional)<input aria-label="Vencimiento del gasto" type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="block text-sm">Estado contable obligatorio<select aria-label="Estado contable del gasto" className={field} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Elegí el estado revisado</option><option value="pending">Pendiente</option><option value="scheduled">Programado</option><option value="paid">Pagado</option></select></label>
    </fieldset>
    {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
    {uncertain && <p className="text-sm text-warn-400">Resultado sin confirmar. Conservamos esta revisión exacta al cerrar o recargar. No crees otro gasto para reemplazar este intento.</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={pending} onClick={onClose}>{uncertain ? "Cerrar y revisar" : "Cancelar"}</Button><Button disabled={!ready || pending || storageError} onClick={() => void submit()}>{pending ? "Guardando…" : uncertain ? "Reintentar misma revisión" : "Confirmar gasto"}</Button></div>
  </section></div>;
}
