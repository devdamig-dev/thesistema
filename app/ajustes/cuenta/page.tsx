import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import AccountLifecycleClient from "./account-lifecycle-client";

export default async function CuentaPage() {
  const ctx=await getCurrentUserContext();
  let businessName:string|null=null;
  if(ctx.isAuthenticated&&ctx.businessId){
    const supabase=await createSupabaseServerClient() as any;
    if(supabase){
      const res=await supabase.from("businesses").select("name").eq("id",ctx.businessId).maybeSingle();
      if(!res.error&&res.data) businessName=res.data.name;
    }
  }
  return <AccountLifecycleClient businessName={businessName} isOwner={ctx.role==="owner"} email={ctx.email}/>;
}
