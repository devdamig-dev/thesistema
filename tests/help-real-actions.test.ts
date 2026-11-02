import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = readFileSync(resolve(process.cwd(), "app/ayuda/page.tsx"), "utf8");

test("Ayuda no simula la atención humana ni anuncia enlaces de soporte inexistentes", () => {
  for (const placeholder of [
    "Te respondemos en menos de 5 minutos",
    "Conectando con soporte",
    "Abriendo WhatsApp",
    "5556-7700",
    "ToastPresets.comingSoon",
    "6 tutoriales · 2-3 min",
  ]) assert.ok(!file.includes(placeholder), "No debería prometerse: " + placeholder);
});

test("Ayuda enlaza recursos reales sin botones inertes", () => {
  for (const href of ["/ayuda/piloto", "/ajustes/whatsapp", "/ajustes/ia"]) {
    assert.ok(file.includes('href="' + href + '"'), "Falta recurso: " + href);
  }
  assert.match(file, /function HelpLinkRow\(/);
  assert.match(file, /<Link[\s\S]*?href=\{href\}/);
});

test("La búsqueda de FAQ no se presenta falsamente como inteligencia artificial", () => {
  assert.ok(file.includes('<Badge tone="default">Buscar</Badge>'));
  assert.ok(!file.includes('escaneá el QR'));
  assert.ok(!file.includes('formato AFIP-friendly'));
  assert.ok(!file.includes('Después de la primera semana'));
});
