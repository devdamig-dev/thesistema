/**
 * CSV builder con escape robusto + BOM para que Excel abra acentos
 * y caracteres en UTF-8 sin romper. No usamos librerías externas para
 * mantener bundle chico — los exportables que generamos son chicos
 * (< 10k filas en la práctica).
 *
 * Si más adelante se necesita XLSX nativo (con tipos numéricos, formatos
 * y múltiples hojas), reemplazar por `xlsx` o `exceljs` sin cambiar la
 * API de quienes llaman `buildCsv`.
 */

export type CsvCell = string | number | boolean | null | undefined | Date;

export function csvEscape(value: CsvCell): string {
  if (value == null) return "";
  let s: string;
  if (value instanceof Date) {
    s = value.toISOString();
  } else if (typeof value === "number") {
    // Excel-AR: usamos coma decimal para que abra "12,50" como número.
    s = Number.isFinite(value) ? String(value).replace(".", ",") : "";
  } else {
    s = String(value);
  }
  const needsQuotes = /[",\n;]/.test(s);
  if (!needsQuotes) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Construye un CSV completo a partir de filas-objeto.
 * Usa `;` como separador (estándar para Excel en es-AR).
 * Antepone BOM UTF-8 para que Excel respete acentos.
 */
export function buildCsv<Row extends Record<string, CsvCell>>(
  headers: { key: keyof Row & string; label: string }[],
  rows: Row[],
): string {
  const sep = ";";
  const headerLine = headers.map((h) => csvEscape(h.label)).join(sep);
  const dataLines = rows.map((row) =>
    headers.map((h) => csvEscape(row[h.key])).join(sep),
  );
  return "﻿" + [headerLine, ...dataLines].join("\n");
}

/**
 * Nombre de archivo amigable con fecha (sin caracteres raros).
 */
export function csvFilename(slug: string, ext = "csv"): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${slug}-${today}.${ext}`;
}
