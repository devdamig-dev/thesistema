"use client";
import {useState} from "react";
import {calculateNetSales,decimalMoney,moneyCents,EMPTY_DEDUCTIONS,DEDUCTION_LABELS,type SalesDeductions} from "@/lib/calculations/operating-costs";
const field="w-full min-w-0 rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink disabled:opacity-60";
export function ClosureTotalsEditor({gross,net,editing,onChange}:{gross:string;net:string;editing:boolean;onChange:(gross:string,net:string,note:string)=>void}) {
  const [mode,setMode]=useState<"auto"|"manual">(editing?"manual":"auto");
  const [rawGross,setRawGross]=useState(gross);const [rawNet,setRawNet]=useState(net);
  const [deductions,setDeductions]=useState<SalesDeductions>({...EMPTY_DEDUCTIONS});
  const [confirmed,setConfirmed]=useState(false);
  function update(nextGross:string,nextNet:string,next:SalesDeductions,nextMode:typeof mode) {
    try {
      if(nextMode==="auto") {const result=calculateNetSales(nextGross,next);onChange(result.grossTotal,result.netTotal,result.note);}
      else onChange(decimalMoney(moneyCents(nextGross)),decimalMoney(moneyCents(nextNet,true)),"");
    }catch{onChange("","","");}
  }
  let preview:ReturnType<typeof calculateNetSales>|null=null;
  let error="";try{preview=calculateNetSales(rawGross,deductions)}catch(e){if(rawGross)error=e instanceof Error?e.message:"Revisá los importes."}
  return <section className="space-y-3 rounded-xl border border-line p-3" aria-label="Cálculo del cierre">
    <label className="block space-y-1 text-xs text-ink-muted">Cómo obtener el neto<select aria-label="Cómo obtener el neto" className={field} value={mode} onChange={e=>{const value=e.target.value as typeof mode;setMode(value);setConfirmed(false);update(rawGross,rawNet,deductions,value)}}><option value="auto">Calcular desde bruto y deducciones</option><option value="manual">Ya tengo el neto informado</option></select></label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block space-y-1 text-xs text-ink-muted">Total bruto<input aria-label="Total bruto" className={field} inputMode="decimal" required value={rawGross} onChange={e=>{setRawGross(e.target.value);setConfirmed(false);update(e.target.value,rawNet,deductions,mode)}}/></label>
      {mode==="manual"?<label className="block space-y-1 text-xs text-ink-muted">Total neto<input aria-label="Total neto" className={field} inputMode="decimal" required value={rawNet} onChange={e=>{setRawNet(e.target.value);update(rawGross,e.target.value,deductions,mode)}}/></label>:
      <div className="space-y-1 text-xs text-ink-muted">Total neto calculado<output aria-label="Total neto calculado" className="block rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink" aria-live="polite">{preview?new Intl.NumberFormat("es-AR",{minimumFractionDigits:2}).format(Number(preview.netTotal)):"Completá el bruto"}</output></div>}
    </div>
    {mode==="auto"&&<>
      <p className="text-xs text-ink-muted">Neto de ventas = bruto − descuentos − devoluciones − comisiones − retenciones − otras deducciones de ventas. No es ganancia ni saldo de efectivo.</p>
      <div className="grid gap-3 sm:grid-cols-2">{Object.entries(DEDUCTION_LABELS).map(([key,label])=><label key={key} className="block space-y-1 text-xs text-ink-muted">{label}<input aria-label={label} className={field} inputMode="decimal" required value={deductions[key as keyof SalesDeductions]} onChange={e=>{const next={...deductions,[key]:e.target.value};setDeductions(next);setConfirmed(false);update(rawGross,rawNet,next,mode)}}/></label>)}</div>
      <p className="text-xs text-ink-muted">Los importes en cero significan que no hubo esa deducción. Los retiros de efectivo y el cambio de caja van en notas; no se descuentan de las ventas. No aplicamos impuestos estimados.</p>
      {error&&<p role="alert" className="text-xs text-warn-300">{error}</p>}
      <label className="flex items-start gap-2 text-xs text-ink-muted"><input className="mt-0.5" type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Revisé las deducciones; las que quedan en cero no aplican a este cierre.</label>
    </>}
  </section>;
}
