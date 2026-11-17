import { getCurrentUserContext } from "@/lib/data/auth";
import AssistantClient from "./assistant-client";

export default async function AsistentePage() {
  const ctx=await getCurrentUserContext();
  return <AssistantClient businessId={ctx.businessId} userName={ctx.fullName} />;
}
