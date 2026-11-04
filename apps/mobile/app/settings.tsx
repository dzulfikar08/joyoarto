import { useRouter } from "expo-router";
import { Platform } from "react-native";

import { useMe } from "@/components/data";
import { Button, Card, ListRow, ListSection, SwitchRow, Screen, Text } from "@/components/ui";
import { useSession } from "@/src/lib/auth";
import { updateSettings, useSettings } from "@/src/lib/settings";

export default function SettingsScreen() {
  const session = useSession();
  const me = useMe();
  const settings = useSettings();
  const router = useRouter();
  return (
    <Screen>
      <ListSection title="Signed in">
        <ListRow title="Household" subtitle={me?.household.name ?? "—"} />
        <ListRow title="Account" subtitle={[me?.user.name, me?.user.email].filter(Boolean).join(" · ") || "—"} />
        <ListRow title="Access" subtitle={session?.kind === "session" ? "Google / Apple sign-in" : `Token: ${me?.scopes.join(", ") ?? ""}`} />
        <ListRow title="Server" subtitle={session?.server} />
      </ListSection>
      {Platform.OS === "android" ? <Button title="Notification capture" variant="secondary" icon="notifications-outline" onPress={() => router.push("/capture-setup")} /> : null}
      {__DEV__ ? (
        <Card tone="warning">
          <Text variant="heading">Development</Text>
          <SwitchRow
            label="Mock statement uploads"
            hint="Answer /api/imports/statement-file locally (until it is deployed)."
            value={settings.mockStatementFile}
            onValueChange={(v) => void updateSettings({ mockStatementFile: v })}
          />
        </Card>
      ) : null}
      <Text variant="caption" tone="muted">Sign out from More. A token stays valid on the server until you revoke it on the web (Settings → API tokens).</Text>
    </Screen>
  );
}
