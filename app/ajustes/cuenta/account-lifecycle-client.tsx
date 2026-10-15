"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Building2, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/ajustes/setting-row";
import { deleteCurrentBusinessAction } from "@/app/actions/business";
import { deleteMyAccountAction } from "@/app/actions/account";
import { useToast } from "@/components/ui/toast";

export default function AccountLifecycleClient({businessName,isOwner,email}:{businessName:string|null;isOwner:boolean;email:string|null}) {
  const {toast}=useToast();
  const [businessConfirm,setBusinessConfirm]=useState("");
  const [accountConfirm,setAccountConfirm]=useState("");
  const [pending,startTransition]=useTransition();

  function deleteBusiness(){
    if(!businessName||businessConfirm.trim()!==businessName) return;
    if(!confirm("Esta acción elimina definitivamente todos los datos de este negocio. ¿Continuar?")) return;
    startTransition(async()=>{
      const result=await deleteCurrentBusinessAction(businessConfirm);
      if(result.ok){
        toast({tone:"success",title:"Negocio eliminado",description:"Tu cuenta sigue activa. Ahora podés aceptar una invitación a otro negocio."});
        window.location.href="/onboarding?business_deleted=1";
      } else {
        const messages:Record<string,string>={
          owner_required:"Sólo el owner puede eliminar el negocio.",
          shared_ownership:"Hay más de un owner. No se puede borrar un negocio compartido desde esta acción.",
          business_has_members:"Quitá o trasladá a los demás miembros antes de eliminar el negocio.",
          confirmation_mismatch:"Escribí exactamente el nombre del negocio.",
          delete_failed:"No pudimos eliminar el negocio de forma segura.",
        };
        toast({tone:"warn",title:"No se eliminó el negocio",description:messages[result.error]??result.error});
      }
    });
  }

  function deleteAccount(){
    if(accountConfirm.trim()!=="ELIMINAR MI CUENTA") return;
    if(!confirm("Esto elimina tu usuario y acceso. ¿Continuar?")) return;
    startTransition(async()=>{
      const result=await deleteMyAccountAction(accountConfirm);
      if(result.ok){
        window.location.href="/login?account_deleted=1";
      } else {
        const messages:Record<string,string>={
          sole_owner_business:"Primero eliminá ese negocio o agregá otro owner. No podemos dejar un negocio sin propietario.",
          confirmation_mismatch:"Escribí exactamente ELIMINAR MI CUENTA.",
          delete_failed:"No pudimos eliminar la cuenta de forma segura.",
        };
        toast({tone:"warn",title:"No se eliminó la cuenta",description:messages[result.error]??result.error});
      }
    });
  }

  return <div className="space-y-6">
    <SettingsCard title="Cuenta y acceso" description={email?("Sesión actual: "+email):"Administrá tu usuario y pertenencia a negocios."}>
      <div className="flex items-start gap-3 rounded-xl border border-line bg-bg-subtle/40 p-4">
        <Building2 className="mt-0.5 h-5 w-5 text-brand-400"/>
        <div>
          <div className="text-sm font-semibold text-ink">Una cuenta puede unirse al negocio de otra persona</div>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">Si creaste un negocio por error durante el onboarding, podés eliminarlo sin borrar tu cuenta. Después abrí la invitación del negocio correcto y te sumarás con el rol asignado.</p>
        </div>
      </div>
    </SettingsCard>

    <SettingsCard title="Eliminar negocio actual" description="Borra definitivamente el negocio y sus datos operativos. Tu cuenta de usuario permanece activa.">
      {!businessName ? <p className="text-sm text-ink-muted">No hay un negocio activo para eliminar.</p> :
      !isOwner ? <p className="text-sm text-ink-muted">Sólo el owner del negocio puede realizar esta acción.</p> :
      <div className="space-y-4">
        <div className="flex gap-3 rounded-xl border border-danger-500/30 bg-danger-500/[0.06] p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-300"/>
          <p className="text-xs leading-relaxed text-ink-muted">Por seguridad sólo se permite si sos el único owner y el único miembro. Si el negocio es compartido, primero reorganizá el equipo.</p>
        </div>
        <label className="block text-xs text-ink-muted">Escribí <strong className="text-ink">{businessName}</strong> para confirmar.
          <input value={businessConfirm} onChange={(e)=>setBusinessConfirm(e.target.value)} className="mt-2 w-full rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink outline-none focus:border-danger-500/50"/>
        </label>
        <Button variant="outline" className="border-danger-500/40 text-danger-300 hover:bg-danger-500/10" disabled={pending||businessConfirm.trim()!==businessName} onClick={deleteBusiness}><Building2 className="h-4 w-4"/> Eliminar negocio</Button>
      </div>}
    </SettingsCard>

    <SettingsCard title="Eliminar mi cuenta" description="Elimina tu usuario de GastroPilot y tus membresías. No elimina un negocio del que seas el único owner.">
      <div className="space-y-4">
        <label className="block text-xs text-ink-muted">Escribí <strong className="text-ink">ELIMINAR MI CUENTA</strong> para confirmar.
          <input value={accountConfirm} onChange={(e)=>setAccountConfirm(e.target.value)} className="mt-2 w-full rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink outline-none focus:border-danger-500/50"/>
        </label>
        <Button variant="outline" className="border-danger-500/40 text-danger-300 hover:bg-danger-500/10" disabled={pending||accountConfirm.trim()!=="ELIMINAR MI CUENTA"} onClick={deleteAccount}><UserRoundX className="h-4 w-4"/> Eliminar mi cuenta</Button>
      </div>
    </SettingsCard>
  </div>;
}
