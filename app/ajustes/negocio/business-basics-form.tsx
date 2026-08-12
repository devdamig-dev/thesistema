"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { updateBusinessAction } from "@/app/actions/business";

export function BusinessBasicsForm({ initialName, initialTaxId }: { initialName: string; initialTaxId: string }) {
  const [name, setName] = useState(initialName);
  const [taxId, setTaxId] = useState(initialTaxId);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function save() {
    startTransition(async () => {
      const result = await updateBusinessAction({ name: name.trim(), taxId: taxId.trim() });
      if (result.ok && result.persisted) {
        toast({ tone: "success", title: "Configuración guardada", description: "Los datos reales del negocio se actualizaron en Supabase." });
      } else {
        toast({ tone: "warn", title: "No pudimos guardar", description: result.ok ? "No hubo cambios para guardar." : result.error });
      }
    });
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-muted">Nombre comercial</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-muted">CUIT</span>
        <input value={taxId} onChange={(e) => setTaxId(e.target.value)} className="w-full rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
      </label>
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={save} disabled={pending || !name.trim()}>
          <Check className="h-3.5 w-3.5" /> {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
