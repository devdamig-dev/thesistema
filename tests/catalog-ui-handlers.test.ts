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
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loadedModule = { exports: {} };
  function requireSource(id: string): unknown {
    if (id === "react") return hooks;
    if (id === "react/jsx-runtime") {
      const element = (type: unknown, props: unknown) => ({ type, props });
      return { jsx: element, jsxs: element };
    }
    if (id === "@/app/actions/catalog") return actions;
    if (id === "@/components/ui/toast") return { useToast: () => ({ toast() {} }) };
    if (id === "@/lib/format") return loadSource(path.join(root, "lib/format.ts"));
    if (id === "@/lib/recipes/quantities") return loadSource(path.join(root, "lib/recipes/quantities.ts"));
    if (id.startsWith("@/components/ui/") || id === "lucide-react") return uiStubs;
    throw new Error(`Unexpected component dependency: ${id}`);
  }
  vm.runInNewContext(source, { exports: loadedModule.exports, module: loadedModule, require: requireSource, console }, { filename: file });
  return loadedModule.exports;
}
const { RecipeEditor } = loadSource(path.join(root, "app/productos/recipe-editor.tsx"));
const ingredient = { id: "i1", name: "Carne", unit: "kg", unitCost: 1000, active: true, supplierId: null, stock: [] };
const baseProps = {
  product: { id: "p1", name: "Hamburguesa", price: 500, cost: 180 },
  ingredients: [ingredient], canEdit: true, onClose() {}, onSaved() {},
};
const submitEvent = { preventDefault() {} };
function submit(harness: Harness): Promise<void> {
  return elements(harness.tree, (node) => node.type === "form")[0].props.onSubmit(submitEvent);
}
async function settle(harness: Harness) {
  await new Promise<void>((resolve) => setImmediate(resolve));
  harness.render();
}
function recipe(items = [{ ingredientId: "i1", quantity: 180, unit: "g", name: "Carne" }], productId = "p1", updatedAt: string | null = "v1") {
  return { ok: true, data: { productId, updatedAt, items } };
}
function reset() {
  actions.getRecipeAction = async () => recipe();
  actions.saveRecipeAction = async () => ({ ok: true, cost: 180 });
}

test("recipe UI previews converted quantities, current costs and gross margin", async () => {
  reset();
  const harness = mount(RecipeEditor, baseProps);
  try {
    await settle(harness);
    assert.match(visibleText(harness.tree), /\$\s*180/);
    assert.match(visibleText(harness.tree), /0,18 kg/);
    assert.match(visibleText(harness.tree), /64,0%/);
  } finally { harness.unmount(); }
});

test("recipe UI blocks duplicate submit and closing while saving", async () => {
  reset();
  let closed = 0, saved = 0, refreshed = 0;
  const pendingSave = deferred();
  actions.saveRecipeAction = async () => { saved += 1; return pendingSave.promise; };
  const harness = mount(RecipeEditor, { ...baseProps, onClose() { closed += 1; }, onSaved() { refreshed += 1; } });
  try {
    await settle(harness);
    const first = submit(harness);
    await submit(harness);
    harness.render();
    harness.tree.props.onClose();
    assert.equal(saved, 1);
    assert.equal(closed, 0);
    assert.equal(elements(harness.tree, (node) => node.type === "form")[0].props["aria-busy"], true);
    pendingSave.resolve({ ok: true, cost: 180 });
    await first;
    assert.equal(closed, 1);
    assert.equal(refreshed, 1);
  } finally { harness.unmount(); }
});

test("recipe UI ignores a late load after switching products", async () => {
  reset();
  const loads: Record<string, ReturnType<typeof deferred>> = { a: deferred(), b: deferred() };
  actions.getRecipeAction = (id) => loads[id].promise;
  const harness = mount(RecipeEditor, { ...baseProps, product: { ...baseProps.product, id: "a" } });
  try {
    harness.render({ ...baseProps, product: { ...baseProps.product, id: "b" } });
    loads.b.resolve(recipe([{ ingredientId: "i1", quantity: 200, unit: "g", name: "Carne" }], "b"));
    await settle(harness);
    loads.a.resolve(recipe([{ ingredientId: "i1", quantity: 999, unit: "g", name: "Carne" }], "a"));
    await settle(harness);
    assert.equal(elements(harness.tree, (node) => node.type === "input" && node.props.type === "number")[0].props.value, "200");
  } finally { harness.unmount(); }
});

test("recipe UI rejects incompatible units before calling the server", async () => {
  reset();
  let saved = 0;
  actions.getRecipeAction = async () => recipe([{ ingredientId: "i1", quantity: 1, unit: "l", name: "Carne" }]);
  actions.saveRecipeAction = async () => { saved += 1; return { ok: true }; };
  const harness = mount(RecipeEditor, baseProps);
  try {
    await settle(harness);
    await submit(harness);
    harness.render();
    assert.equal(saved, 0);
    assert.match(visibleText(harness.tree), /Sin calcular/);
    assert.match(visibleText(harness.tree), /no es compatible/);
  } finally { harness.unmount(); }
});

test("recipe UI does not turn an unknown ingredient cost into zero", async () => {
  reset();
  let saved = 0;
  actions.saveRecipeAction = async () => { saved += 1; return { ok: true }; };
  const harness = mount(RecipeEditor, { ...baseProps, ingredients: [{ ...ingredient, unitCost: null }] });
  try {
    await settle(harness);
    assert.match(visibleText(harness.tree), /sin dato/);
    assert.match(visibleText(harness.tree), /Sin calcular/);
    await submit(harness);
    assert.equal(saved, 0);
  } finally { harness.unmount(); }
});

test("recipe UI keeps a view-only role from submitting mutations", async () => {
  reset();
  let saved = 0;
  actions.saveRecipeAction = async () => { saved += 1; return { ok: true }; };
  const harness = mount(RecipeEditor, { ...baseProps, canEdit: false });
  try {
    await settle(harness);
    await submit(harness);
    assert.equal(saved, 0);
    assert.doesNotMatch(visibleText(harness.tree), /Guardar composición/);
  } finally { harness.unmount(); }
});

test("recipe UI allows optional empty composition and carries its version", async () => {
  reset();
  let payload: any;
  actions.getRecipeAction = async () => recipe([]);
  actions.saveRecipeAction = async (_id, input) => { payload = input; return { ok: true, cost: 180 }; };
  const harness = mount(RecipeEditor, baseProps);
  try {
    await settle(harness);
    assert.match(visibleText(harness.tree), /conserva su costo actual/);
    await submit(harness);
    assert.equal(payload.items.length, 0);
    assert.equal(payload.expectedUpdatedAt, "v1");
  } finally { harness.unmount(); }
});

test("recipe UI preserves the form and unlocks retry after a conflict", async () => {
  reset();
  let saved = 0, closed = 0;
  actions.saveRecipeAction = async () => { saved += 1; return { ok: false, error: "La información cambió. Volvé a cargar." }; };
  const harness = mount(RecipeEditor, { ...baseProps, onClose() { closed += 1; } });
  try {
    await settle(harness);
    await submit(harness);
    harness.render();
    assert.match(visibleText(harness.tree), /Descartar cambios y recargar/);
    assert.equal(closed, 0);
    assert.equal(elements(harness.tree, (node) => node.type === "form")[0].props["aria-busy"], false);
    assert.equal(elements(harness.tree, (node) => node.type === "input" && node.props.type === "number")[0].props.value, "180");
    await submit(harness);
    assert.equal(saved, 2);
  } finally { harness.unmount(); }
});
