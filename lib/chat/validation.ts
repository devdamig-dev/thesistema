export class ChatError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const CHAT_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf", "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav"];
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new ChatError("invalid_id", "La referencia no es válida.");
  return value;
}
export function textValue(value: unknown, max: number, required = true): string {
  if (typeof value !== "string" || value.length > max || required && !value.trim()) throw new ChatError("invalid_text", "Revisá el texto y su extensión.");
  return value.trim();
}
export function memberIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new ChatError("invalid_members", "Elegí entre 1 y 50 integrantes.");
  const ids = value.map(uuid);
  if (new Set(ids).size !== ids.length) throw new ChatError("invalid_members", "Hay integrantes repetidos.");
  return ids;
}
export function fileDescriptor(value: Record<string, unknown>) {
  const mime = textValue(value.mime, 100).split(";")[0].toLowerCase();
  const size = value.size;
  if (!CHAT_MIMES.includes(mime) || typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > MAX_FILE_SIZE) throw new ChatError("invalid_file", "Usá una imagen JPG, PNG o WebP, un PDF o un audio de hasta 20 MB.");
  const filename = textValue(value.filename, 180).replace(/[\\/\x00-\x1f\x7f]/g, "_");
  return { mime, size, filename };
}
export function matchesMagic(bytes: Uint8Array, mime: string): boolean {
  const h = Array.from(bytes.subarray(0, 16));
  const ascii = (start: number, end: number) => String.fromCharCode(...h.slice(start, end));
  if (mime === "application/pdf") return ascii(0, 5) === "%PDF-";
  if (mime === "image/png") return h.slice(0, 8).join() === "137,80,78,71,13,10,26,10";
  if (mime === "image/jpeg") return h[0] === 255 && h[1] === 216 && h[2] === 255;
  if (mime === "image/webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (mime === "audio/wav") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
  if (mime === "audio/ogg") return ascii(0, 4) === "OggS";
  if (mime === "audio/webm") return h.slice(0, 4).join() === "26,69,223,163";
  if (mime === "audio/mp4") return ascii(4, 8) === "ftyp";
  if (mime === "audio/mpeg") return ascii(0, 3) === "ID3" || h[0] === 255 && (h[1] & 224) === 224;
  return false;
}
export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
      && (url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com" || /^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname));
  } catch { return false; }
}
