"use server";
import { redirect } from "next/navigation";
import { beginSandboxCheckout } from "@/lib/billing/server";

export async function checkoutSandboxAction(form: FormData) {
  let checkout: string;
  try {
    checkout = await beginSandboxCheckout(form.get("product"), form.get("request_id"));
  } catch {
    redirect("/ajustes/ia/pagos?checkout_error=1");
  }
  redirect(checkout);
}
