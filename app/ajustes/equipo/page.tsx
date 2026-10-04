import { listPendingInvitations, listTeamBranches, listTeamMembers } from "@/lib/data/team";
import EquipoClient from "./equipo-client";

export default async function AjustesEquipoPage() {
  const [members, invitations, branches] = await Promise.all([
    listTeamMembers(),
    listPendingInvitations(),
    listTeamBranches(),
  ]);
  return <EquipoClient members={members} invitations={invitations} branches={branches} />;
}
