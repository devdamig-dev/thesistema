import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { FudoCredentials } from "./client";

function keyFromEnvironment(raw: string | undefined): Buffer {
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    throw new Error("fudo_encryption_unavailable");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("fudo_encryption_unavailable");
  return key;
}

/** Ciphertext is bound to its tenant with GCM AAD, so it cannot be moved to a different business. */
export function encryptFudoCredentials(
  businessId: string,
  credentials: FudoCredentials,
  encryptionKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY,
): string {
  const key = keyFromEnvironment(encryptionKey);
  if (!businessId || !credentials.apiKey.trim() || !credentials.apiSecret.trim()) {
    throw new Error("fudo_credentials_invalid");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(businessId, "utf8"));
  const value = Buffer.from(JSON.stringify(credentials), "utf8");
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptFudoCredentials(
  businessId: string,
  ciphertext: string,
  encryptionKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY,
): FudoCredentials {
  const key = keyFromEnvironment(encryptionKey);
  const segments = ciphertext.split(".");
  if (segments.length !== 4 || segments[0] !== "v1") throw new Error("fudo_ciphertext_invalid");
  try {
    const iv = Buffer.from(segments[1], "base64url");
    const tag = Buffer.from(segments[2], "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("invalid_size");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(businessId, "utf8"));
    decipher.setAuthTag(tag);
    const cleartext = Buffer.concat([decipher.update(Buffer.from(segments[3], "base64url")), decipher.final()]);
    const parsed: unknown = JSON.parse(cleartext.toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("invalid_shape");
    const value = parsed as Partial<FudoCredentials>;
    if (typeof value.apiKey !== "string" || !value.apiKey || typeof value.apiSecret !== "string" || !value.apiSecret) {
      throw new Error("invalid_shape");
    }
    return { apiKey: value.apiKey, apiSecret: value.apiSecret };
  } catch {
    // Deliberately do not interpolate raw ciphertext or secrets into an error.
    throw new Error("fudo_ciphertext_invalid");
  }
}
