import { listPendingInvitations, listTeamMembers } from "@/lib/data/team";
import EquipoClient from "./equipo-client";

export default async function AjustesEquipoPage() {
  const [members, invitations] = await Promise.all([
    listTeamMembers(),
    listPendingInvitations(),
  ]);
  return <EquipoClient members={members} invitations={invitations} />;
}
