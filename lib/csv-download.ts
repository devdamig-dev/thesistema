"use client";

/**
 * Disparador de descarga de CSV en el browser. Se usa desde las páginas
 * client (Compras, Ventas, Empleados, Deudas) tras recibir el contenido
 * desde un server action.
 */
export function triggerCsvDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Liberar memoria en el próximo tick.
  setTimeout(() => URL.revokeObjectURL(url), 250);
}
