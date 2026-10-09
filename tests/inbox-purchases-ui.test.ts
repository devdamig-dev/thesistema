/** Handler-level tests of the real dialog with deterministic hooks and isolated
 * actions/storage. These do not claim DOM, accessibility or browser coverage. */
import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import * as domain from "../lib/purchases/inbox";
import * as service from "../lib/purchases/service";
import type { InboxPurchaseReview } from "../lib/purchases/inbox";
import type { PurchaseCommitResult } from "../lib/purchases/service";

type Harness = { hooks: any[]; effects: (() => void)[]; index: number; props: any; key: unknown; tree: any; render: (props?: any) => any; unmount: () => void };
let current: Harness;
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const hooks = {
  useState(initial: any) { const h = current; const i = h.index++; if (!(i in h.hooks)) h.hooks[i] = typeof initial === "function" ? initial() : initial; return [h.hooks[i], (value: any) => { h.hooks[i] = typeof value === "function" ? value(h.hooks[i]) : value; }]; },
  useRef(initial: any) { const h = current; const i = h.index++; if (!(i in h.hooks)) h.hooks[i] = { current: initial }; return h.hooks[i]; },
  useEffect(effect: () => void | (() => void), deps: unknown[]) { const h = current; const i = h.index++; const prior = h.hooks[i]; if (!prior || !same(prior.deps, deps)) h.effects.push(() => { prior?.cleanup?.(); h.hooks[i] = { deps, cleanup: effect() }; }); },
};
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function review(): InboxPurchaseReview { return { alreadyApproved: false, extractionId: id(10), businessId: id(2), userId: id(1), branchId: id(3), branches: [{ id: id(3), name: "Central" }], suppliers: [{ id: id(4), name: "Proveedor" }], ingredients: [{ id: id(5), name: "Tomate", unit: "kg" }], expectedFields: { supplier: "Proveedor", total_amount: 100, item: "Tomate", quantity: 2 }, supplierId: id(4), purchasedAt: "2026-10-09", paymentMethod: "Efectivo", amount: "100", items: [{ ingredientId: null, description: "Tomate", qty: "2", unit: "kg", unitPrice: "50" }] }; }
const success = (): PurchaseCommitResult => ({ ok: true, persisted: true, id: id(20), replayed: false, source: "inbox", kind: "summary" });
const uncertain = (): PurchaseCommitResult => ({ ok: false, persisted: "unknown", error: "Resultado incierto" });
const rejected = (): PurchaseCommitResult => ({ ok: false, persisted: false, error: "Revisión rechazada" });
let action: (value: any) => Promise<PurchaseCommitResult>;
const calls: any[] = [];
let values: Map<string, string>;
let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => storage });
const loader = Module as any; const original = loader._load;
loader._load = function (name: string, ...args: any[]) {
  const element = (type: unknown, props: unknown, key: unknown) => ({ type, props, key });
  const mocks: any = { react: hooks, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" }, "@/components/ui/button": { Button: "button" }, "@/lib/purchases/inbox": domain, "@/lib/purchases/service": service, "@/app/actions/inbox-purchases": { approveInboxPurchaseAction: async (value: unknown) => { calls.push(JSON.parse(JSON.stringify(value))); return action(value); } } };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const { InboxPurchaseReviewDialog } = require("../app/inbox/purchase-review") as typeof import("../app/inbox/purchase-review");
loader._load = original;
function reset() {
  calls.length = 0; values = new Map();
  storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  action = async value => ({ ...success(), kind: value.review.kind });
}
function mount(props: any = { review: review(), onClose() {}, onSaved() {} }): Harness {
  const h: Harness = { hooks: [], effects: [], index: 0, props, key: undefined, tree: null,
    render(next = h.props) {
      h.props = next;
      const outer: any = InboxPurchaseReviewDialog(h.props);
      if (h.key !== outer.key) { h.unmount(); h.hooks = []; h.key = outer.key; }
      h.index = 0; current = h; h.tree = outer.type(outer.props); h.effects.splice(0).forEach(effect => effect()); return h.tree;
    },
    unmount() { h.hooks.forEach(hook => hook?.cleanup?.()); },
  };
  h.render(); h.render(); return h;
}
function elements(node: any, predicate: (node: any) => boolean): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(n => elements(n, predicate));
  return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)];
}
function text(node: any): string { if (node == null || typeof node === "boolean") return ""; if (typeof node !== "object") return String(node); return Array.isArray(node) ? node.map(text).join("") : text(node.props?.children); }
function field(h: Harness, label: string) { const found = elements(h.tree, n => n.props?.["aria-label"] === label)[0]; assert.ok(found, label); return found; }
function button(h: Harness, label: string) { const found = elements(h.tree, n => n.type === "button" && text(n) === label)[0]; assert.ok(found, label); return found; }
function change(h: Harness, label: string, value: string) { field(h, label).props.onChange({ target: { value } }); h.render(); }
function frozen(h: Harness) { return elements(h.tree, n => n.type === "fieldset")[0].props.disabled; }
async function settle(h: Harness) { await new Promise<void>(resolve => setImmediate(resolve)); h.render(); }
function deferred() { let resolve!: (value: PurchaseCommitResult) => void; const promise = new Promise<PurchaseCommitResult>(r => { resolve = r; }); return { promise, resolve }; }

// Handler callbacks deliberately remain callable even when their rendered
// buttons are disabled, so synchronous duplicate and terminal guards are tested.
test("purchase dialog requires manual kind and summary emits no items or stock flags", async () => {
  reset(); let saved = 0; const h = mount({ review: review(), onClose() {}, onSaved() { saved++; } });
  try {
    assert.equal(field(h, "Tipo de compra").props.value, "");
    button(h, "Confirmar compra").props.onClick(); await settle(h); assert.equal(calls.length, 0);
    change(h, "Tipo de compra", "summary"); change(h, "Monto de la compra", "123,45");
    button(h, "Confirmar compra").props.onClick(); await settle(h);
    assert.equal(calls.length, 1); assert.equal(calls[0].review.amount, "123.45"); assert.equal(Object.hasOwn(calls[0].review, "items"), false);
    assert.deepEqual(calls[0].expectedFields, review().expectedFields); assert.equal(saved, 1); assert.equal(values.size, 0);
    assert.equal(button(h, "Confirmar compra").props.disabled, true); button(h, "Confirmar compra").props.onClick(); await settle(h); assert.equal(calls.length, 1);
  } finally { h.unmount(); }
});

test("purchase dialog detailed lines require explicit stock mappings and preserve user-entered quantities", async () => {
  reset(); const h = mount();
  try {
    change(h, "Tipo de compra", "detailed"); assert.equal(field(h, "Insumo de línea 1").props.value, "");
    change(h, "Insumo de línea 1", id(5)); change(h, "Cantidad de línea 1", "2,125000");
    button(h, "Agregar línea").props.onClick(); h.render();
    for (const [label, value] of [["Descripción de línea 2", "Envío"], ["Cantidad de línea 2", "1"], ["Unidad de línea 2", "servicio"], ["Precio de línea 2", "0"]]) change(h, label, value);
    button(h, "Confirmar compra").props.onClick(); await settle(h);
    assert.deepEqual(calls[0].review.items, [{ ingredientId: id(5), description: "Tomate", qty: "2.125000", unit: "kg", unitPrice: "50" }, { ingredientId: null, description: "Envío", qty: "1", unit: "servicio", unitPrice: "0" }]);
    assert.equal(Object.hasOwn(calls[0].review, "amount"), false);
  } finally { h.unmount(); }
});

test("same-tick duplicate confirmation makes one request and journals before dispatch", async () => {
  reset(); const wait = deferred(); action = async proposal => { assert.equal(values.get(domain.inboxPurchaseJournalKey(proposal)), JSON.stringify(proposal)); return wait.promise; };
  const h = mount();
  try {
    change(h, "Tipo de compra", "summary"); const click = button(h, "Confirmar compra").props.onClick; click(); click(); h.render();
    assert.equal(calls.length, 1); assert.equal(frozen(h), true); assert.equal(button(h, "Cancelar").props.disabled, true);
    wait.resolve(uncertain()); await settle(h); assert.equal(frozen(h), true); assert.equal(button(h, "Reintentar misma revisión").props.disabled, false); assert.equal(values.size, 1);
  } finally { h.unmount(); }
});

test("uncertain purchase stays exact through retry, later rollback, parent refresh and reload", async () => {
  reset(); action = async () => uncertain(); let h = mount();
  try {
    change(h, "Tipo de compra", "summary"); button(h, "Confirmar compra").props.onClick(); await settle(h);
    const first = calls[0]; const journal = values.get(domain.inboxPurchaseJournalKey(first));
    h.render({ ...h.props, review: { ...review(), expectedFields: { changed: true }, amount: "999" } });
    change(h, "Monto de la compra", "888"); action = async () => rejected(); button(h, "Reintentar misma revisión").props.onClick(); await settle(h);
    assert.deepEqual(calls[1], first); assert.equal(frozen(h), true); assert.equal(values.get(domain.inboxPurchaseJournalKey(first)), journal);
    h.unmount(); h = mount({ review: { ...review(), alreadyApproved: true, expectedFields: { changed: true } }, onClose() {}, onSaved() {} });
    assert.equal(frozen(h), true); assert.equal(field(h, "Monto de la compra").props.value, "100");
    action = async () => success(); button(h, "Reintentar misma revisión").props.onClick(); await settle(h);
    assert.deepEqual(calls[2], first); assert.equal(values.size, 0);
  } finally { h.unmount(); }
});

test("initial known rollback releases editing only after confirmed journal removal", async () => {
  reset(); action = async () => rejected(); const h = mount();
  try {
    change(h, "Tipo de compra", "summary"); button(h, "Confirmar compra").props.onClick(); await settle(h);
    assert.equal(values.size, 0); assert.equal(frozen(h), false);
    change(h, "Monto de la compra", "200"); action = async () => success(); button(h, "Confirmar compra").props.onClick(); await settle(h);
    assert.equal(calls.length, 2); assert.equal(calls[1].review.amount, "200");
  } finally { h.unmount(); }
});

test("missing/corrupt/foreign journal and denied read block unsafe review without requests", async () => {
  for (const setup of [
    () => { storage.getItem = () => { throw new Error("denied"); }; },
    () => { values.set(domain.inboxPurchaseJournalKey(review()), "{broken"); },
    () => { values.set(domain.inboxPurchaseJournalKey(review()), JSON.stringify({ extractionId: id(10), businessId: id(2), userId: id(99), expectedFields: {}, review: { kind: "summary", branchId: id(3), supplierId: id(4), purchasedAt: "2026-10-09", paymentMethod: "Efectivo", amount: "100" } })); },
  ]) {
    reset(); setup(); const h = mount();
    try { assert.equal(frozen(h), true); assert.equal(button(h, "Confirmar compra").props.disabled, true); button(h, "Confirmar compra").props.onClick(); await settle(h); assert.equal(calls.length, 0); } finally { h.unmount(); }
  }
  reset(); const h = mount({ review: { ...review(), alreadyApproved: true }, onClose() {}, onSaved() {} });
  try { button(h, "Confirmar compra").props.onClick(); await settle(h); assert.equal(calls.length, 0); assert.match(text(h.tree), /ya fue aprobada/); } finally { h.unmount(); }
});

test("journal write throws or unverifiable readback fail closed before server action", async () => {
  for (const setItem of [() => { throw new Error("quota"); }, () => {}]) {
    reset(); storage.setItem = setItem; const h = mount();
    try { change(h, "Tipo de compra", "summary"); button(h, "Confirmar compra").props.onClick(); await settle(h); assert.equal(calls.length, 0); assert.equal(frozen(h), true); assert.equal(button(h, "Confirmar compra").props.disabled, true); } finally { h.unmount(); }
  }
});

test("failed journal cleanup after success or rollback freezes future submits", async () => {
  for (const response of [success(), rejected()]) for (const removeItem of [() => { throw new Error("denied"); }, () => {}]) {
    reset(); let saved = 0; action = async () => response; storage.removeItem = removeItem;
    const h = mount({ review: review(), onClose() {}, onSaved() { saved++; } });
    try { change(h, "Tipo de compra", "summary"); button(h, "Confirmar compra").props.onClick(); await settle(h); assert.equal(saved, 0); assert.equal(calls.length, 1); assert.equal(values.size, 1); assert.equal(frozen(h), true); button(h, "Confirmar compra").props.onClick(); await settle(h); assert.equal(calls.length, 1); } finally { h.unmount(); }
  }
});

test("thrown action freezes journal and Closing preserves the exact unresolved attempt", async () => {
  reset(); action = async () => { throw new Error("network"); }; let closed = 0; const h = mount({ review: review(), onClose() { closed++; }, onSaved() {} });
  try { change(h, "Tipo de compra", "summary"); button(h, "Confirmar compra").props.onClick(); await settle(h); assert.equal(frozen(h), true); button(h, "Cerrar y revisar").props.onClick(); assert.equal(closed, 1); assert.equal(values.size, 1); } finally { h.unmount(); }
});

test("a context switch mounts a clean actor session and ignores late result from the previous dialog", async () => {
  reset(); const wait = deferred(); action = async () => wait.promise; let saved = 0;
  const h = mount({ review: review(), onClose() {}, onSaved() { saved++; } });
  try {
    change(h, "Tipo de compra", "summary"); button(h, "Confirmar compra").props.onClick(); h.render(); const previous = calls[0];
    h.render({ ...h.props, review: { ...review(), userId: id(99) } }); h.render();
    assert.equal(field(h, "Tipo de compra").props.value, ""); assert.equal(frozen(h), false);
    wait.resolve(success()); await settle(h); assert.equal(saved, 0); assert.equal(values.has(domain.inboxPurchaseJournalKey(previous)), true);
    change(h, "Tipo de compra", "summary"); action = async () => success(); button(h, "Confirmar compra").props.onClick(); await settle(h);
    assert.equal(calls[1].userId, id(99)); assert.equal(saved, 1); assert.equal(values.has(domain.inboxPurchaseJournalKey(previous)), true);
  } finally { h.unmount(); }
});

test("a second stale dialog cannot overwrite or clear another unresolved journal for the same extraction", async () => {
  reset(); action = async () => uncertain(); const first = mount(); const second = mount();
  try {
    change(first, "Tipo de compra", "summary"); button(first, "Confirmar compra").props.onClick(); await settle(first);
    const originalJournal = values.get(domain.inboxPurchaseJournalKey(review()));
    change(second, "Tipo de compra", "summary"); change(second, "Monto de la compra", "200");
    button(second, "Confirmar compra").props.onClick(); await settle(second);
    assert.equal(calls.length, 1); assert.equal(frozen(second), true); assert.equal(values.get(domain.inboxPurchaseJournalKey(review())), originalJournal);
  } finally { first.unmount(); second.unmount(); }
});


test("a failed parent refresh callback preserves confirmed success without offering a new purchase", async () => {
  for (const recovered of [false, true]) {
    reset(); const h = mount({ review: review(), onClose() {}, onSaved() { throw new Error("render failed"); } });
    try {
      change(h, "Tipo de compra", "summary");
      if (recovered) { action = async () => uncertain(); button(h, "Confirmar compra").props.onClick(); await settle(h); }
      action = async () => success();
      button(h, recovered ? "Reintentar misma revisión" : "Confirmar compra").props.onClick(); await settle(h);
      assert.match(text(h.tree), /compra quedó confirmada.*actualizar la pantalla/);
      assert.doesNotMatch(text(h.tree), /Resultado sin confirmar|podría estar guardada/);
      assert.equal(values.size, 0); assert.equal(frozen(h), true); assert.equal(button(h, "Confirmar compra").props.disabled, true);
      button(h, "Confirmar compra").props.onClick(); await settle(h); assert.equal(calls.length, recovered ? 2 : 1);
    } finally { h.unmount(); }
  }
});

test("malformed, incomplete and mismatched action results preserve the frozen journal", async () => {
  for (const result of [null, undefined, {}, { ok: "yes" }, { ok: true }, { ...success(), persisted: undefined }, { ...success(), source: "manual" }, { ...success(), kind: "detailed" }, { ok: false, persisted: true, error: "invalid" }, { ok: false, persisted: false, error: null }]) {
    reset(); let saved = 0; action = async () => result as any;
    const h = mount({ review: review(), onClose() {}, onSaved() { saved++; } });
    try {
      change(h, "Tipo de compra", "summary"); button(h, "Confirmar compra").props.onClick(); await settle(h);
      assert.equal(saved, 0); assert.equal(frozen(h), true); assert.equal(values.size, 1);
      assert.equal(button(h, "Reintentar misma revisión").props.disabled, false);
    } finally { h.unmount(); }
  }
});
