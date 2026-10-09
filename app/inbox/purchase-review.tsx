"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { purchaseCommitResult } from "@/lib/purchases/service";
import { approveInboxPurchaseAction } from "@/app/actions/inbox-purchases";
import { clearInboxPurchaseJournal, inboxPurchaseJournalKey, parseInboxPurchaseApproval, recoverInboxPurchase, saveInboxPurchaseJournal, type InboxPurchaseApproval, type InboxPurchaseReview, type PurchaseReviewLine } from "@/lib/purchases/inbox";
const field = "w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink";
type PurchaseReviewProps = { review: InboxPurchaseReview; onClose: () => void; onSaved: () => void };
export function InboxPurchaseReviewDialog(props: PurchaseReviewProps) {
  return <PurchaseReviewSession key={inboxPurchaseJournalKey(props.review)} {...props} />;
}
function PurchaseReviewSession({ review: initialReview, onClose, onSaved }: PurchaseReviewProps) {
  // A rerender cannot replace the original optimistic snapshot or pending intent.
  const [review] = useState(initialReview);
  const [branch, setBranch] = useState(review.branchId ?? ""); const [supplier, setSupplier] = useState(review.supplierId); const [date, setDate] = useState(review.purchasedAt); const [method, setMethod] = useState(review.paymentMethod);
  const [kind, setKind] = useState<"" | "summary" | "detailed">(""); const [amount, setAmount] = useState(review.amount); const [items, setItems] = useState(review.items);
  const [error, setError] = useState(""); const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [ready, setReady] = useState(false); const [storageError, setStorageError] = useState(false);
  const [completed, setCompleted] = useState(false); const complete = useRef(false); const active = useRef(false);
  const lock = useRef(false); const frozen = useRef<InboxPurchaseApproval | null>(null); const key = inboxPurchaseJournalKey(review);
  useEffect(() => {
    active.current = true;
    try { const stored = recoverInboxPurchase(sessionStorage.getItem(key), review); if (stored) { frozen.current = stored; setUncertain(true); setBranch(stored.review.branchId); setSupplier(stored.review.supplierId); setDate(stored.review.purchasedAt); setMethod(stored.review.paymentMethod); setKind(stored.review.kind); if (stored.review.kind === "summary") setAmount(stored.review.amount); else setItems(stored.review.items); } else if (review.alreadyApproved) { setStorageError(true); setError("Esta extracción ya fue aprobada. Consultá la compra guardada en Compras."); } }
    catch { setStorageError(true); setError("No pudimos recuperar la revisión guardada. Verificá Compras antes de continuar."); }
    setReady(true);
    return () => { active.current = false; };
  }, [key, review]);
  const patch = (index: number, value: Partial<PurchaseReviewLine>) => setItems(rows => rows.map((row, i) => i === index ? { ...row, ...value } : row));
  async function submit() {
    if (!active.current || lock.current || complete.current || !ready || storageError) return;
    let proposal: InboxPurchaseApproval;
    try { proposal = frozen.current ?? parseInboxPurchaseApproval({ extractionId: review.extractionId, businessId: review.businessId, userId: review.userId, expectedFields: review.expectedFields, review: { branchId: branch, supplierId: supplier, purchasedAt: date, paymentMethod: method, kind, ...(kind === "summary" ? { amount: amount.replace(",", ".") } : { items: items.map(line => ({ ...line, qty: line.qty.replace(",", "."), unitPrice: line.unitPrice.replace(",", ".") })) }) } }); }
    catch (err) { setError(err instanceof Error ? err.message : "Revisá los datos."); return; }
    try { saveInboxPurchaseJournal(sessionStorage, proposal); } catch { setStorageError(true); setError("No pudimos conservar el intento. Habilitá el almacenamiento antes de guardar."); return; }
    const recovering = frozen.current !== null; frozen.current = proposal; lock.current = true; setPending(true); setError("");
    try {
      const result = await approveInboxPurchaseAction(proposal);
      if (!active.current) return;
      if (result?.ok !== true && (result?.ok !== false || ![false, "unknown"].includes(result.persisted) || typeof result.error !== "string")) throw new Error("Respuesta inválida.");
      if (result.ok) {
        const receipt = purchaseCommitResult({ data: result }, { source: "inbox", kind: proposal.review.kind });
        if (!receipt.ok || result.persisted !== true) { setUncertain(true); setError("La respuesta no confirma esta compra. Conservamos la revisión exacta para reintentar."); return; }
        complete.current = true; setCompleted(true); setUncertain(false); try { clearInboxPurchaseJournal(sessionStorage, proposal); } catch { setStorageError(true); setError("La compra quedó confirmada, pero no pudimos limpiar la referencia local. Revisá Compras antes de continuar."); return; }
        try { onSaved(); } catch { setError("La compra quedó confirmada, pero no pudimos actualizar la pantalla. Recargá Compras para verla."); }
        return;
      }
      setError(result.error);
      if (result.persisted === "unknown" || recovering) setUncertain(true);
      else { try { clearInboxPurchaseJournal(sessionStorage, proposal); frozen.current = null; } catch { setStorageError(true); } }
    } catch { if (!active.current) return; setUncertain(true); setError("La compra podría estar guardada. Conservamos esta revisión exacta para reintentar sin duplicarla."); }
    finally { lock.current = false; if (active.current) setPending(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="purchase-review-title"><section className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-line bg-bg-elevated p-6">
    <h2 id="purchase-review-title" className="text-lg font-semibold">Revisar compra</h2><p className="text-sm text-ink-muted">Confirmá los datos reales. El resumen registra un monto sin inventar líneas ni mover stock. El detalle solo mueve stock en los insumos que elijas.</p>
    <fieldset disabled={!ready || pending || uncertain || storageError || completed} className="space-y-4">
      <label className="block text-sm">Sucursal<select aria-label="Sucursal de la compra" className={field} value={branch} disabled={review.branchId !== null} onChange={e => setBranch(e.target.value)}><option value="">Elegí una sucursal</option>{review.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="block text-sm">Proveedor<select aria-label="Proveedor de la compra" className={field} value={supplier} onChange={e => setSupplier(e.target.value)}><option value="">Elegí un proveedor existente</option>{review.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="block text-sm">Fecha de compra<input aria-label="Fecha de compra" type="date" className={field} value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="block text-sm">Medio de pago declarado<input aria-label="Medio de pago de la compra" className={field} maxLength={100} value={method} onChange={e => setMethod(e.target.value)} /></label>
      <label className="block text-sm">Tipo de registro<select aria-label="Tipo de compra" className={field} value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="">Elegí cómo registrar esta compra</option><option value="summary">Resumen de monto, sin stock</option><option value="detailed">Detalle revisado por línea</option></select></label>
      {kind === "summary" && <label className="block text-sm">Monto total<input aria-label="Monto de la compra" inputMode="decimal" className={field} value={amount} onChange={e => setAmount(e.target.value)} /></label>}
      {kind === "detailed" && <>{items.map((line, i) => <div key={i} className="space-y-3 rounded-xl border border-line p-3">
        <label className="block text-sm">Insumo de línea {i + 1}<select aria-label={`Insumo de línea ${i + 1}`} className={field} value={line.ingredientId ?? ""} onChange={e => patch(i, { ingredientId: e.target.value || null })}><option value="">Concepto sin stock</option>{review.ingredients.map(v => <option key={v.id} value={v.id}>{v.name} ({v.unit})</option>)}</select></label>
        <label className="block text-sm">Descripción<input aria-label={`Descripción de línea ${i + 1}`} className={field} maxLength={1000} value={line.description} onChange={e => patch(i, { description: e.target.value })} /></label>
        <div className="grid grid-cols-3 gap-2"><label className="block text-xs">Cantidad<input aria-label={`Cantidad de línea ${i + 1}`} inputMode="decimal" className={field} value={line.qty} onChange={e => patch(i, { qty: e.target.value })} /></label><label className="block text-xs">Unidad<input aria-label={`Unidad de línea ${i + 1}`} className={field} maxLength={40} value={line.unit} onChange={e => patch(i, { unit: e.target.value })} /></label><label className="block text-xs">Precio unitario<input aria-label={`Precio de línea ${i + 1}`} inputMode="decimal" className={field} value={line.unitPrice} onChange={e => patch(i, { unitPrice: e.target.value })} /></label></div>
        {items.length > 1 && <Button variant="ghost" onClick={() => setItems(rows => rows.filter((_, index) => i !== index))}>Quitar línea {i + 1}</Button>}
      </div>)}<Button disabled={items.length >= 100} onClick={() => setItems(rows => [...rows, { ingredientId: null, description: "", qty: "", unit: "", unitPrice: "" }])}>Agregar línea</Button></>}
    </fieldset>
    {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}{uncertain && <p className="text-sm text-warn-400">Resultado sin confirmar. Esta revisión se conserva al cerrar o recargar. No crees otra compra para reemplazarla.</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={pending} onClick={onClose}>{uncertain ? "Cerrar y revisar" : "Cancelar"}</Button><Button disabled={!ready || pending || storageError || completed} onClick={() => void submit()}>{pending ? "Guardando…" : uncertain ? "Reintentar misma revisión" : "Confirmar compra"}</Button></div>
  </section></div>;
}
