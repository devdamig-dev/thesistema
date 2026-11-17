import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const jsx = (type: any, props: any) => ({ type, props });
function load(file: string, dependencies: Record<string, any>) {
  const compiled = { exports: {} as any };
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports: compiled.exports, module: compiled, require(name: string) {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name in dependencies) return dependencies[name];
    return new Proxy({}, { get: (_, key) => key === "__esModule" ? true : String(key) });
  }});
  return compiled.exports.default;
}
async function page(row: any) {
  const reads: string[] = [];
  const db = { from(table: string) {
    reads.push(table);
    const query: any = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: table === "businesses" ? { timezone: "UTC" } : row, error: null }) };
    return query;
  }};
  const component = load("app/balances/page.tsx", {
    "@/lib/env": { isDatabaseMode: () => true },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => db },
    "@/lib/data/auth": { getCurrentUserContext: async () => ({ isAuthenticated: true, businessId: "synthetic-business" }) },
    "@/app/ventas/reporting": { localDate: () => "2026-10-15" },
    "./balances-client": { __esModule: true, default: "BalancesClient" },
  });
  return { tree: await component(), reads };
}
function nodes(node: any): any[] { return !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat().flatMap(nodes)]; }
function text(node: any): string { if (node == null) return ""; if (typeof node !== "object") return String(node); if (typeof node.type === "function") return text(node.type(node.props)); return [node.props?.children].flat().map(text).join(" "); }
const snapshot = { sales_total: 0, debts_pending: 50000, gross_margin_pct: null };

test("missing monthly balance is unavailable rather than zero business results", async () => {
  const { tree, reads } = await page(null);
  assert.equal(nodes(tree).some(node => node.type === "BalancesClient"), false);
  assert.match(text(tree), /ausencia.*no significa/);
  assert.deepEqual(reads, ["businesses", "balance_snapshots"]);
});
test("unknown gross margin stays null and explicit zero margin stays zero", async () => {
  const missing = await page(snapshot);
  assert.equal(nodes(missing.tree).find(node => node.type === "BalancesClient")?.props.snapshot.margenBrutoPct, null);
  const zero = await page({ ...snapshot, gross_margin_pct: 0 });
  assert.equal(nodes(zero.tree).find(node => node.type === "BalancesClient")?.props.snapshot.margenBrutoPct, 0);
});
test("stale monthly snapshot remains unavailable", async () => {
  const { tree } = await page({ ...snapshot, sales_data_stale: true });
  assert.equal(nodes(tree).some(node => node.type === "BalancesClient"), false);
  assert.match(text(tree), /necesita regenerarse/);
});
test("balance presentation does not claim live data, confirmed margin or debt ratio without sales", () => {
  const component = load("app/balances/balances-client.tsx", {
    "@/components/ui/toast": { useToast: () => ({ toast() {} }), ToastPresets: {} },
    "@/lib/format": { formatARS: (value: number) => `ARS ${value}`, formatPercent: (value: number) => `${value}%` },
    "@/lib/utils": { cn: (...values: any[]) => values.join(" ") },
  });
  const tree = component({ snapshot: { ventasMes: 0, deudasPendientes: 50000, margenBrutoPct: null, resultadoNeto: 0, resultadoOperativo: 0 }, monthly: [], recommendations: [] });
  const result = text(tree);
  assert.match(result, /datos guardados/);
  assert.match(result, /margen bruto del mes no está confirmado/);
  assert.match(result, /Sin confirmar/);
  assert.match(result, /Sin facturación mensual para calcular una proporción/);
  assert.doesNotMatch(result, /datos en vivo|Representa el|Saldo total/);
});
