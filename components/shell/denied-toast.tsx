"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Compatibilidad retro con `?denied=<module>` que algunos handlers
 * antiguos podrían disparar. Hoy el middleware redirige a
 * `/sin-permisos`, así que este componente sólo se ejecuta como
 * fallback si llega un toast desde otra capa.
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
    const url = new URL(window.location.href);
    url.searchParams.delete("denied");
    router.replace(url.pathname + (url.search || ""), { scroll: false });
  }, [params, router, toast]);

  return null;
}
