import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

import { Button, Card, Screen, SwitchRow, Text } from "@/components/ui";
import { signOut, updateMe, useApi, useSession } from "@/src/lib/auth";
import { updateSettings, useSettings } from "@/src/lib/settings";

export default function SettingsScreen() {
  const session = useSession();
  const api = useApi();
  const settings = useSettings();
  const router = useRouter();

  // Refresh who the token belongs to (household names change, the active household can switch).
  useEffect(() => {
    void api.me().then(updateMe).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const me = session?.me;
  return (
    <Screen>
      <Card>
        <Text variant="label" tone="muted">Household</Text>
        <Text variant="heading">{me?.household.name ?? "—"}</Text>
        <Text>{[me?.user.name, me?.user.email].filter(Boolean).join(" · ")}</Text>
        <Text variant="caption" tone="muted">Token access: {me?.scopes.join(", ")}</Text>
        <Text variant="caption" tone="muted">Server: {session?.server}</Text>
      </Card>
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
      <Button
        title="Sign out"
        variant="destructive"
        onPress={async () => {
          await signOut();
          router.replace("/login");
        }}
      />
      <Text variant="caption" tone="muted">Signing out removes the token from this phone. Revoke it on the web (Settings → API tokens) if the phone is lost.</Text>
    </Screen>
  );
}
