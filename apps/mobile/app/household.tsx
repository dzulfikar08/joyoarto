import { ComingSoon } from "@/components/coming-soon";

// Follow-up: household.* (members, invites, switch the active household), tokens.*, imports.email, billing
// (apps/web/src/routes/settings.tsx and -household.tsx). Demo accounts get FORBIDDEN with data.demo for invites.
export default function HouseholdScreen() {
  return (
    <ComingSoon
      icon="people-outline"
      title="Household"
      description="Members, invites and which household is active."
      webPath="/settings"
      points={["Invite your partner by email", "Switch the active household", "Import by email and API tokens"]}
    />
  );
}
