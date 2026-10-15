"use client";
import {useRef,useState} from "react";
import {saveIngredientAction,getCatalogDataAction,type IngredientRow} from "@/app/actions/catalog";
import {Button} from "@/components/ui/button";
import {RECIPE_UNITS} from "@/lib/recipes/quantities";
import {calculatePackUnitCost} from "@/lib/calculations/operating-costs";
const field="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink";
export function InlineIngredient({onCreated,onClose,onBusyChange}:{onCreated:(row:IngredientRow)=>void;onClose:()=>void;onBusyChange:(busy:boolean)=>void}) {
  const [name,setName]=useState("");const [unit,setUnit]=useState("unit");
  const [quantity,setQuantity]=useState("");const [total,setTotal]=useState("");
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [uncertain,setUncertain]=useState(false);
  const [created,setCreated]=useState(false);
  const lock=useRef(false);const createdId=useRef<string|null>(null);
  let unitCost:number|null=null;
  try{unitCost=calculatePackUnitCost(total,quantity)}catch{ /* Incomplete source data is not a zero cost. */ }
  async function loadSaved() {
    const result=await getCatalogDataAction();
    if(!result.ok) throw new Error("No pudimos verificar el insumo guardado. Revisá el catálogo antes de repetir el alta.");
    const row=result.data.ingredients.find(item=>item.id===createdId.current);
    if(!row) throw new Error("El insumo no apareció en el catálogo. No repitas el alta sin verificarlo.");
    onCreated(row);
  }
  async function save() {
    if(lock.current||uncertain) return;
    if(!name.trim()||name.trim().length>200) return setError("Ingresá el nombre del insumo.");
    if(unitCost===null) return setError("Ingresá cuánto pagaste por el envase y qué cantidad contiene.");
    lock.current=true;setBusy(true);onBusyChange(true);setError("");
    try {
      if(!createdId.current){
        const result=await saveIngredientAction(null,{name:name.trim(),unit,unitCost,active:true,supplierId:null,minimums:[]});
        if(!result.ok){setUncertain(true);setError("No se confirmó el alta. Revisá Insumos antes de repetirla para evitar duplicados.");return;}
        createdId.current=result.id;setCreated(true);
      }
      await loadSaved();
    }catch(error){
      if(!createdId.current)setUncertain(true);
      setError(error instanceof Error?error.message:"No pudimos confirmar el insumo. Revisá el catálogo.");
    }finally{lock.current=false;setBusy(false);onBusyChange(false);}
  }
  return <section aria-label="Crear insumo sin salir del producto" className="space-y-3 rounded-xl border border-brand-500/40 bg-bg p-4">
    <h4 className="text-sm font-semibold text-ink">Nuevo insumo para esta receta</h4>
    <p className="text-xs text-ink-muted">Ingresá los datos del envase o compra: GastroPilot calcula el costo por unidad. No necesitás calcularlo vos.</p>
    <fieldset disabled={busy||uncertain||created} className="space-y-3">
      <label className="block space-y-1 text-xs text-ink-muted">Nombre del insumo<input aria-label="Nombre del insumo" className={field} value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-ink-muted">Unidad del contenido<select aria-label="Unidad del contenido" className={field} value={unit} onChange={e=>setUnit(e.target.value)}>{RECIPE_UNITS.map(value=><option key={value} value={value}>{value==="unit"?"unidades":value}</option>)}</select></label>
        <label className="space-y-1 text-xs text-ink-muted">Cantidad que contiene<input aria-label="Cantidad que contiene" className={field} inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="Por ejemplo, 24 panes o 5 kg"/></label>
      </div>
      <label className="block space-y-1 text-xs text-ink-muted">Importe total del envase (ARS)<input aria-label="Importe total del envase (ARS)" className={field} inputMode="decimal" value={total} onChange={e=>setTotal(e.target.value)} placeholder="Por ejemplo, 12000"/></label>
    </fieldset>
    <p aria-live="polite" className="text-sm text-ink">Costo por {unit==="unit"?"unidad":unit}: <strong>{unitCost===null?"Faltan datos del envase":new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:6}).format(unitCost)}</strong></p>
    <p className="text-xs text-ink-muted">Esto crea el insumo y su costo de referencia. No registra una compra ni modifica el stock.</p>
    {error&&<p role="alert" className="text-xs text-warn-300">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" type="button" disabled={busy||uncertain} onClick={()=>void save()}>{busy?"Verificando…":created?"Verificar insumo guardado":"Guardar y usar en receta"}</Button><Button size="sm" type="button" variant="ghost" disabled={busy} onClick={onClose}>Cerrar insumo</Button></div>
  </section>;
}
