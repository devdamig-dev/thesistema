import Link from "next/link";
import { randomUUID } from "node:crypto";
import { getBillingView } from "@/lib/billing/server";
import { checkoutSandboxAction } from "./actions";

export const dynamic = "force-dynamic";
const currency = (minor: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(minor / 100);
const statuses: Record<string, string> = {
  creating: "Creando checkout; no repetir una operación incierta", ready: "Checkout listo",
  provider_error: "Requiere revisión", pending: "Pago de prueba pendiente", approved: "Prueba aprobada — sin créditos reales",
  rejected: "Prueba rechazada", cancelled: "Prueba cancelada", refunded: "Prueba reembolsada",
  charged_back: "Contracargo de prueba", review: "Requiere conciliación manual",
};
export default async function AiBillingPage({ searchParams }: { searchParams: Promise<{ checkout_error?: string }> }) {
  const [view, query] = await Promise.all([getBillingView(), searchParams]);
  return <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
    <Link href="/ajustes/ia" className="text-sm underline">Volver a IA</Link>
    <header className="space-y-2"><h1 className="text-3xl font-semibold">Planes y pagos de IA</h1>
      <p className="text-sm text-slate-500">Contratación, packs y seguimiento de pagos por negocio.</p></header>
    <section className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4" aria-label="Entorno de pruebas">
      <h2 className="font-semibold">Mercado Pago · sólo sandbox</h2>
      <p className="mt-1 text-sm">Esta entrega verifica el circuito de pago con cuentas de prueba. No cobra dinero real, no activa planes ni suma créditos utilizables. Los importes ARS son de prueba, no tarifas comerciales ni conversión del catálogo USD.</p>
      <p className="mt-2 text-sm">La renovación automática y la habilitación comercial siguen pendientes. Volver desde Mercado Pago no confirma un pago: el estado se obtiene del registro verificado por servidor.</p>
    </section>
    {query.checkout_error && <p role="alert" className="rounded-lg border p-4">No pudimos abrir el checkout. Revisá el historial antes de iniciar otra prueba; una operación incierta no se reenvía automáticamente.</p>}
    {!view.enabled ? <section className="rounded-xl border p-6"><h2 className="font-semibold">Checkout de pruebas no disponible</h2>
      <p className="mt-2 text-sm">Requiere un owner/admin activo, negocio QA autorizado, migraciones aplicadas y configuración sandbox del servidor. Está bloqueado en Vercel Production.</p>
      <p className="mt-2 text-xs text-slate-500">Estado: {view.reason}</p></section> : <>
      <section aria-label="Planes y packs" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {view.offers.map((offer) => <article key={offer.code} className="flex flex-col rounded-xl border p-5">
          <p className="text-xs uppercase text-slate-500">{offer.kind === "plan" ? "Plan · simulación de contratación" : "Pack · simulación de compra"}</p>
          <h2 className="mt-2 text-xl font-semibold">{offer.title}</h2>
          <p className="mt-3">{offer.credits.toLocaleString("es-AR")} créditos del catálogo</p>
          <p className="my-4 font-medium">{currency(offer.amountMinor)} ARS de prueba</p>
          <form action={checkoutSandboxAction} className="mt-auto">
            <input type="hidden" name="product" value={offer.code}/><input type="hidden" name="request_id" value={randomUUID()}/>
            <button type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Probar checkout</button>
          </form>
        </article>)}
      </section>
      <section className="rounded-xl border p-5"><h2 className="text-xl font-semibold">Últimas pruebas del negocio</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">Actualizá esta página para consultar el estado confirmado por el webhook.</p>
        {!view.history.length ? <p>Todavía no hay intentos de pago.</p> : <ul className="divide-y">
          {view.history.map((order) => <li key={order.id} className="flex flex-col gap-1 py-4 sm:flex-row sm:justify-between">
            <span>{order.title} · {currency(Number(order.amount_minor))} ARS <span className="block text-xs text-slate-500">Referencia {order.id.slice(0, 8)}</span></span>
            <span className="text-sm">{statuses[order.status] ?? "Estado no reconocido; revisar"}</span>
          </li>)}
        </ul>}
      </section>
    </>}
  </main>;
}
