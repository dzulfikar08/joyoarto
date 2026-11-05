// Settings: who is signed in, Joyo Pro status, appearance, connect Claude, API tokens, and the way to Household and
// Data & privacy. At parity with the web's apps/web/src/routes/settings.tsx (the web's household, email-import and
// data cards are the Household, Import and Data & privacy screens here).

import { useRouter } from "expo-router";
import { Platform, View } from "react-native";

import { useMe } from "@/components/data";
import { ApiTokens } from "@/components/settings/api-tokens";
import { BillingCard } from "@/components/settings/billing-card";
import { ConnectClaude } from "@/components/settings/connect-claude";
import { Avatar, Card, FieldLabel, ListRow, ListSection, Pill, Row, Screen, Segmented, SwitchRow, Text } from "@/components/ui";
import { setAppearance, useAppearance, type Appearance } from "@/src/lib/appearance";
import { useSession } from "@/src/lib/auth";
import { updateSettings, useSettings } from "@/src/lib/settings";

export default function SettingsScreen() {
  const session = useSession();
  const me = useMe();
  const settings = useSettings();
  const appearance = useAppearance();
  const router = useRouter();
  return (
    <Screen>
      <Card>
        <Row gap={14}>
          <Avatar name={me?.user.name ?? null} image={me?.user.image ?? null} size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" numberOfLines={1}>{me?.user.name ?? "Signed in"}</Text>
            {me?.user.email ? <Text variant="caption" tone="muted" numberOfLines={1}>{me.user.email}</Text> : null}
            <Row gap={6} style={{ flexWrap: "wrap", marginTop: 4 }}>
              <Pill icon="home-outline" label={me?.household.name ?? "Household"} />
              {me?.demo ? <Pill tone="warning" label="Demo data" /> : null}
              <Pill tone="primary" label={session?.kind === "session" ? "Google / Apple sign-in" : `Token: ${me?.scopes.join(", ") ?? ""}`} />
            </Row>
          </View>
        </Row>
        <Text variant="caption" tone="muted" selectable>Server: {session?.server}</Text>
      </Card>

      <BillingCard />

      <Card>
        <FieldLabel label="Appearance" hint="Light, dark, or follow this phone.">
          <Segmented<Appearance>
            label="Appearance"
            value={appearance}
            onChange={setAppearance}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </FieldLabel>
      </Card>

      <ListSection>
        <ListRow icon="people-outline" title="Household" subtitle="Members, invites, switch household" onPress={() => router.push("/household")} />
        <ListRow icon="document-text-outline" title="Import by email" subtitle="Your household's private address" onPress={() => router.push("/import")} />
        <ListRow icon="briefcase-outline" title="Reimbursement" subtitle="Companies that pay work expenses back" onPress={() => router.push("/reimburse-profiles")} />
        {Platform.OS === "android" ? <ListRow icon="notifications-outline" title="Notification capture" subtitle="Jago and GoPay payment notifications" onPress={() => router.push("/capture-setup")} /> : null}
        <ListRow icon="shield-checkmark-outline" title="Data & privacy" subtitle="Download your data, delete your account" onPress={() => router.push("/data-privacy")} />
      </ListSection>

      <ConnectClaude />
      <ApiTokens />

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
      <Text variant="caption" tone="muted">Sign out from More.</Text>
    </Screen>
  );
}
