export type CustomerInput = {
  id: string | null;
  expectedUpdatedAt: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  channel: string | null;
  notes: string | null;
  active: boolean;
};
export type CustomerRow = Omit<CustomerInput, "id" | "expectedUpdatedAt"> & {
  id: string;
  updatedAt: string;
};
export type CustomerValidation = { ok: true; value: CustomerInput } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = ["id", "expectedUpdatedAt", "name", "phone", "email", "channel", "notes", "active"];
const CONTROL = /[\u0000-\u001f\u007f]/;
function optionalText(value: unknown, max: number, multiline = false): boolean {
  return value === null || (typeof value === "string" && [...value.trim()].length <= max
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : CONTROL).test(value));
}
export function validateCustomerInput(raw: unknown): CustomerValidation {
  const invalid = (error: string): CustomerValidation => ({ ok: false, error });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("Revisá los datos del cliente.");
  const row = raw as Record<string, unknown>;
  if (Object.keys(row).length !== KEYS.length || Object.keys(row).some((key) => !KEYS.includes(key))) {
    return invalid("El formulario contiene campos no admitidos.");
  }
  if (row.id !== null && (typeof row.id !== "string" || !UUID.test(row.id))) return invalid("El cliente no es válido.");
  if (row.id === null ? row.expectedUpdatedAt !== null : typeof row.expectedUpdatedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(row.expectedUpdatedAt)
    || !Number.isFinite(Date.parse(row.expectedUpdatedAt))) return invalid("Recargá el cliente antes de editarlo.");
  if (typeof row.name !== "string" || !row.name.trim() || [...row.name.trim()].length > 200 || CONTROL.test(row.name)) {
    return invalid("Ingresá un nombre de hasta 200 caracteres.");
  }
  if (!optionalText(row.phone, 40) || (typeof row.phone === "string" && row.phone.trim()
    && (!/^[+0-9() .#xX-]+$/.test(row.phone.trim()) || !/\d/.test(row.phone)))) return invalid("Revisá el teléfono (hasta 40 caracteres).");
  if (!optionalText(row.email, 254) || (typeof row.email === "string" && row.email.trim()
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim()))) return invalid("Ingresá un email válido.");
  if (!optionalText(row.channel, 80)) return invalid("El canal admite hasta 80 caracteres.");
  if (!optionalText(row.notes, 2000, true)) return invalid("Las notas admiten hasta 2000 caracteres.");
  if (typeof row.active !== "boolean" || (row.id === null && !row.active)) return invalid("El estado del cliente no es válido.");
  const trim = (value: unknown) => typeof value === "string" ? value.trim() || null : null;
  return { ok: true, value: {
    id: row.id as string | null, expectedUpdatedAt: row.expectedUpdatedAt as string | null,
    name: row.name.trim(), phone: trim(row.phone), email: trim(row.email), channel: trim(row.channel), notes: trim(row.notes), active: row.active,
  } };
}
