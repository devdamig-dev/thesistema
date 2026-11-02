export type AiCommercialPlan = {
  code: "free" | "starter" | "growth" | "pro" | "business";
  name: string;
  priceUsdCents: number;
  monthlyCredits: number;
};

export const AI_COMMERCIAL_PLANS: AiCommercialPlan[] = [
  { code: "free", name: "Sin IA", priceUsdCents: 0, monthlyCredits: 0 },
  { code: "starter", name: "Starter", priceUsdCents: 1000, monthlyCredits: 5000 },
  { code: "growth", name: "Growth", priceUsdCents: 2500, monthlyCredits: 15000 },
  { code: "pro", name: "Pro", priceUsdCents: 4900, monthlyCredits: 35000 },
  { code: "business", name: "Business", priceUsdCents: 9900, monthlyCredits: 80000 },
];

export type AiCreditPack = {
  code: "pack_5k" | "pack_15k" | "pack_40k";
  name: string;
  priceUsdCents: number;
  credits: number;
  validityDays: number;
};

export const AI_CREDIT_PACKS: AiCreditPack[] = [
  { code: "pack_5k", name: "Pack 5K", priceUsdCents: 1000, credits: 5000, validityDays: 90 },
  { code: "pack_15k", name: "Pack 15K", priceUsdCents: 2500, credits: 15000, validityDays: 90 },
  { code: "pack_40k", name: "Pack 40K", priceUsdCents: 5000, credits: 40000, validityDays: 90 },
];

export function formatAiPlanPrice(priceUsdCents: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(priceUsdCents / 100);
}
