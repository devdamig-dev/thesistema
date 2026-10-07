import { INDUSTRIES } from "../industries";
import type { Industry } from "../entities";
import { BRANCH_TYPES, SALE_CHANNELS, type BranchType } from "./types";

const INDUSTRY_KEYS = new Set<string>(INDUSTRIES.map((industry) => industry.key));
const BRANCH_TYPE_KEYS = new Set<string>(BRANCH_TYPES.map((branch) => branch.value));
const SALE_CHANNEL_KEYS = new Set<string>(SALE_CHANNELS.map((channel) => channel.key));

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "invalid_business_payload" | "invalid_branches_payload" | "invalid_channels_payload" };

export type ValidBusinessPayload = {
  name: string;
  taxId: string | null;
  industry: Industry;
  timezone: string;
};

export type ValidBranchPayload = {
  name: string;
  address: string | null;
  type: BranchType;
  isMain: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isValidTimezone(timezone: string): boolean {
  if (!timezone || timezone.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function validateBusinessPayload(payload: unknown): ValidationResult<ValidBusinessPayload> {
  if (!isRecord(payload) || !hasOnlyKeys(payload, ["name", "taxId", "industry", "timezone"])) {
    return { ok: false, error: "invalid_business_payload" };
  }

  if (typeof payload.name !== "string" || typeof payload.industry !== "string") {
    return { ok: false, error: "invalid_business_payload" };
  }
  const name = payload.name.trim();
  if (!name || name.length > 120 || !INDUSTRY_KEYS.has(payload.industry)) {
    return { ok: false, error: "invalid_business_payload" };
  }

  if (payload.taxId !== undefined && typeof payload.taxId !== "string") {
    return { ok: false, error: "invalid_business_payload" };
  }
  const taxId = typeof payload.taxId === "string" ? payload.taxId.trim() : "";
  if (taxId.length > 32) return { ok: false, error: "invalid_business_payload" };

  if (payload.timezone !== undefined && typeof payload.timezone !== "string") {
    return { ok: false, error: "invalid_business_payload" };
  }
  const timezone = payload.timezone ?? "America/Argentina/Buenos_Aires";
  if (!isValidTimezone(timezone)) return { ok: false, error: "invalid_business_payload" };

  return {
    ok: true,
    value: {
      name,
      taxId: taxId || null,
      industry: payload.industry as Industry,
      timezone,
    },
  };
}

export function validateBranchesPayload(payload: unknown): ValidationResult<ValidBranchPayload> {
  if (!isRecord(payload) || !hasOnlyKeys(payload, ["branches"]) || !Array.isArray(payload.branches)) {
    return { ok: false, error: "invalid_branches_payload" };
  }

  // The onboarding UI configures the one main branch created by bootstrap.
  // Additional branches belong to the branch CRUD, where each write can be audited separately.
  if (payload.branches.length !== 1) {
    return { ok: false, error: "invalid_branches_payload" };
  }
  const branch = payload.branches[0];
  if (!isRecord(branch) || !hasOnlyKeys(branch, ["name", "address", "type", "isMain"])) {
    return { ok: false, error: "invalid_branches_payload" };
  }
  if (
    typeof branch.name !== "string" ||
    typeof branch.type !== "string" ||
    branch.isMain !== true ||
    !BRANCH_TYPE_KEYS.has(branch.type)
  ) {
    return { ok: false, error: "invalid_branches_payload" };
  }

  const name = branch.name.trim();
  if (!name || name.length > 120) return { ok: false, error: "invalid_branches_payload" };
  if (branch.address !== undefined && typeof branch.address !== "string") {
    return { ok: false, error: "invalid_branches_payload" };
  }
  const address = typeof branch.address === "string" ? branch.address.trim() : "";
  if (address.length > 240) return { ok: false, error: "invalid_branches_payload" };

  return {
    ok: true,
    value: {
      name,
      address: address || null,
      type: branch.type as BranchType,
      isMain: true,
    },
  };
}

export function validateChannelsPayload(payload: unknown): ValidationResult<string[]> {
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > SALE_CHANNEL_KEYS.size) {
    return { ok: false, error: "invalid_channels_payload" };
  }
  if (payload.some((channel) => typeof channel !== "string" || !SALE_CHANNEL_KEYS.has(channel))) {
    return { ok: false, error: "invalid_channels_payload" };
  }
  if (new Set(payload).size !== payload.length) {
    return { ok: false, error: "invalid_channels_payload" };
  }
  return { ok: true, value: payload };
}
