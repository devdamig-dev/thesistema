/**
 * Focused handler regression tests using a minimal deterministic hook harness.
 * They execute the real component source and quantity domain, with stubbed
 * server actions. They do not render a DOM, test React scheduling/accessibility,
 * or replace a browser smoke test against an authenticated database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

type Component = (props: any) => any;
type Harness = {
  hooks: any[];
  effects: (() => void)[];
  index: number;
  props: any;
  tree: any;
  render: (props?: any) => any;
  unmount: () => void;
};
let current: Harness;
const root = process.cwd();
const actions: Record<string, (...args: any[]) => Promise<any>> = {};
function sameDependencies(a?: unknown[], b?: unknown[]) {
  return a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}
const hooks = {
  useState(initial: any) {
    const harness = current;
    const index = harness.index++;
    if (!(index in harness.hooks)) harness.hooks[index] = typeof initial === "function" ? initial() : initial;
    return [harness.hooks[index], (value: any) => {
      harness.hooks[index] = typeof value === "function" ? value(harness.hooks[index]) : value;
    }];
  },
  useRef(initial: any) {
    const index = current.index++;
    if (!(index in current.hooks)) current.hooks[index] = { current: initial };
    return current.hooks[index];
  },
  useMemo<T>(create: () => T, dependencies: unknown[]): T {
    const index = current.index++;
    const previous = current.hooks[index];
    if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
      current.hooks[index] = { value: create(), dependencies };
    }
    return current.hooks[index].value;
  },
  useCallback(callback: (...args: any[]) => any, dependencies: unknown[]) {
    return hooks.useMemo(() => callback, dependencies);
  },
  useEffect(effect: () => void | (() => void), dependencies: unknown[]) {
    const harness = current;
    const index = harness.index++;
    const previous = harness.hooks[index];
    if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
      harness.effects.push(() => {
        previous?.cleanup?.();
        harness.hooks[index] = { dependencies, cleanup: effect() };
      });
    }
  },
};
function mount(component: Component, props: any): Harness {
  const harness: Harness = {
    hooks: [], effects: [], index: 0, props, tree: null,
    render(next = harness.props) {
      harness.props = next;
      harness.index = 0;
      current = harness;
      harness.tree = component(harness.props);
      harness.effects.splice(0).forEach((effect) => effect());
      return harness.tree;
    },
    unmount() { harness.hooks.forEach((hook) => hook?.cleanup?.()); },
  };
  harness.render();
  return harness;
}
function elements(node: any, predicate: (node: any) => boolean): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, predicate));
  return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)];
}
function visibleText(node: any): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join("");
  return visibleText(node.props?.children);
}
function deferred<T = any>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const uiStubs = new Proxy({}, { get: () => function StubComponent() {} });
function loadSource(file: string): Record<string, any> {
  const source = ts.transpileModule(fs.readFileSync(file, "utf8").replace("function ProductForm(", "export function ProductForm("), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loadedModule = { exports: {} };
  function requireSource(id: string): unknown {
    if (id === "react") return hooks;
    if (id === "react/jsx-runtime") {
      const element = (type: unknown, props: unknown) => ({ type, props });
      return { jsx: element, jsxs: element };
    }
    if (id.startsWith("@/app/actions/")) return actions;
    if (id === "@/lib/calculations/operating-costs") return loadSource(path.join(root, "lib/calculations/operating-costs.ts"));
    if (id.startsWith("./")) return uiStubs;
    if (id === "@/components/ui/toast") return { useToast: () => ({ toast() {} }) };
    if (id === "@/lib/format") return loadSource(path.join(root, "lib/format.ts"));
    if (id === "@/lib/recipes/quantities") return loadSource(path.join(root, "lib/recipes/quantities.ts"));
    if (id.startsWith("@/components/ui/") || id === "lucide-react") return uiStubs;
    throw new Error(`Unexpected component dependency: ${id}`);
  }
  vm.runInNewContext(source, { exports: loadedModule.exports, module: loadedModule, require: requireSource, console }, { filename: file });
  return loadedModule.exports;
}

const calc=loadSource(path.join(root,"lib/calculations/operating-costs.ts"));
const {InlineIngredient}=loadSource(path.join(root,"app/productos/inline-ingredient.tsx"));
const {ProductForm}=loadSource(path.join(root,"app/productos/database-products-page.tsx"));
const event={preventDefault(){}};
function change(h:Harness,label:string,value:string){elements(h.tree,n=>n.props?.["aria-label"]===label)[0].props.onChange({target:{value}});h.render();}
function button(h:Harness,label:string){return elements(h.tree,n=>visibleText(n)===label&&typeof n.props?.onClick==="function")[0];}
async function settle(h:Harness){await new Promise(r=>setImmediate(r));h.render();}
test("automatic closure correction replaces obsolete formula and retains prose",()=>{
 const a=calc.calculateNetSales("1000",calc.EMPTY_DEDUCTIONS).note;
 const b=calc.calculateNetSales("2000",{...calc.EMPTY_DEDUCTIONS,commissions:"100"}).note;
 const compose=calc.replaceClosureCalculationNote??((note:string,c:string)=>[note,c].filter(Boolean).join("\n\n"));
 const note=compose("Retiro de caja documentado\n\n"+a,b);
 assert.equal((note.match(/Cálculo de neto de ventas:/g)||[]).length,1);
 assert.ok(note.includes("Retiro de caja documentado"));
 assert.ok(note.includes("neto 1900.00"));
 assert.equal(compose(note,b),note);
 assert.equal(compose("Nota propia: Cálculo de neto de ventas: revisar",""),"Nota propia: Cálculo de neto de ventas: revisar");
});
test("known ingredient rejection preserves fields and enables corrected retry",async()=>{
 let calls=0;
 actions.saveIngredientAction=async()=>{calls++;return {ok:false,persisted:false,error:"Revisá la unidad"}};
 const h=mount(InlineIngredient,{onCreated(){},onClose(){},onBusyChange(){}});
 change(h,"Nombre del insumo","Pan");change(h,"Cantidad que contiene","24");change(h,"Importe total del envase (ARS)","12000");
 button(h,"Guardar y usar en receta").props.onClick();await settle(h);
 assert.equal(elements(h.tree,n=>n.type==="fieldset")[0].props.disabled,false);
 assert.equal(button(h,"Guardar y usar en receta").props.disabled,false);
 assert.ok(visibleText(h.tree).includes("Revisá la unidad"));
 button(h,"Guardar y usar en receta").props.onClick();await settle(h);assert.equal(calls,2);
});
test("uncertain ingredient exception remains blocked to avoid duplicate writes",async()=>{
 actions.saveIngredientAction=async()=>{throw new Error("network")};
 const h=mount(InlineIngredient,{onCreated(){},onClose(){},onBusyChange(){}});
 change(h,"Nombre del insumo","Pan");change(h,"Cantidad que contiene","24");change(h,"Importe total del envase (ARS)","12000");
 button(h,"Guardar y usar en receta").props.onClick();await settle(h);
 assert.equal(elements(h.tree,n=>n.type==="fieldset")[0].props.disabled,true);
});
test("recipe to manual uses editable manual cost and omits recipe payload",()=>{
 let sent:any;
 const h=mount(ProductForm,{product:null,ingredients:[{id:"i1",name:"Pan",active:true,unit:"unit",unitCost:500}],pending:false,canEdit:true,saveError:null,onCancel(){},onIngredientBusyChange(){},onSubmit(v:any){sent=v}});
 // Form state and recipe state, supplied through hook setters rendered by the real component.
 const fields=elements(h.tree,n=>n.type==="input");
 fields[0].props.onChange({target:{value:"Sandwich"}});h.render();
 elements(h.tree,n=>n.type==="input")[1].props.onChange({target:{value:"Comida"}});h.render();
 elements(h.tree,n=>n.type==="input")[2].props.onChange({target:{value:"1000"}});h.render();
 button(h," Agregar insumo").props.onClick();h.render();
 change(h,"Cómo obtener el costo","manual");
 const cost=elements(h.tree,n=>n.type==="input"&&n.props.step==="0.01")[1];
 assert.equal(cost.props.readOnly,false);
 cost.props.onChange({target:{value:"150"}});h.render();
 elements(h.tree,n=>n.type==="form")[0].props.onSubmit(event);
 assert.equal(sent.cost,150);assert.equal("recipeItems" in sent,false);
});


test("ingredient saved but catalog read fails retries read without another create", async () => {
 let writes=0,reads=0,used:any;
 actions.saveIngredientAction=async()=>{writes++;return {ok:true,persisted:true,id:"new-1"}};
 actions.getCatalogDataAction=async()=>{reads++;return reads===1?{ok:false,error:"read failed"}:{ok:true,data:{ingredients:[{id:"new-1",name:"Pan"}]}}};
 const h=mount(InlineIngredient,{onCreated(row:any){used=row},onClose(){},onBusyChange(){}});
 change(h,"Nombre del insumo","Pan");change(h,"Cantidad que contiene","24");change(h,"Importe total del envase (ARS)","12000");
 button(h,"Guardar y usar en receta").props.onClick();await settle(h);
 assert.equal(elements(h.tree,n=>n.type==="fieldset")[0].props.disabled,true);
 assert.equal(button(h,"Verificar insumo guardado").props.disabled,false);
 button(h,"Verificar insumo guardado").props.onClick();await settle(h);
 assert.equal(writes,1);assert.equal(reads,2);assert.equal(used.id,"new-1");
});

test("switching manual back to recipe preserves recipe draft and computes its cost",()=>{
 let sent:any;
 const h=mount(ProductForm,{product:null,ingredients:[{id:"i1",name:"Pan",active:true,unit:"unit",unitCost:500}],pending:false,canEdit:true,saveError:null,onCancel(){},onIngredientBusyChange(){},onSubmit(v:any){sent=v}});
 elements(h.tree,n=>n.type==="input")[0].props.onChange({target:{value:"Sandwich"}});h.render();
 elements(h.tree,n=>n.type==="input")[1].props.onChange({target:{value:"Comida"}});h.render();
 elements(h.tree,n=>n.type==="input")[2].props.onChange({target:{value:"2000"}});h.render();
 button(h," Agregar insumo").props.onClick();h.render();
 elements(h.tree,n=>n.type==="input"&&n.props.step==="any")[0].props.onChange({target:{value:"2"}});h.render();
 change(h,"Cómo obtener el costo","manual");change(h,"Cómo obtener el costo","auto");
 assert.equal(elements(h.tree,n=>n.type==="input"&&n.props.step==="any")[0].props.value,"2");
 elements(h.tree,n=>n.type==="form")[0].props.onSubmit(event);
 assert.equal(sent.cost,1000);assert.equal(sent.recipeItems.length,1);
});
