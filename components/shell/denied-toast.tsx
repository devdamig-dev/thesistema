"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { CATEGORY_LABELS } from "@/lib/data/notifications-types";

/**
 * Cuando el middleware redirige por falta de permiso, agrega
 * ?denied=<moduleKey>. Este componente lo detecta y muestra un
 * toast de advertencia, luego limpia el query param.
 */
export function DeniedToast() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    const denied = params.get("denied");
    if (!denied) return;
    toast({
      tone: "warn",
      title: "No tenés permiso para esa sección",
      description: `Tu rol no incluye acceso al módulo "${denied}".`,
    });
    // Limpiar el query param para que el toast no se repita.
    const url = new URL(window.location.href);
    url.searchParams.delete("denied");
    router.replace(url.pathname + (url.search || ""), { scroll: false });
    // Avoid CATEGORY_LABELS lint warning (kept import for future use)
    void CATEGORY_LABELS;
  }, [params, router, toast]);

  return null;
}
