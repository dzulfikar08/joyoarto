// More: who is signed in (Google avatar), the screens that are not tabs, appearance, sign out. Like the web's
// apps/web/src/routes/more.tsx.

import Constants from "expo-constants";
import { useRouter, type Href } from "expo-router";
import * as Updates from "expo-updates";
import { Alert, Linking, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { useMe } from "@/components/data";
import { Avatar, Button, Card, FieldLabel, ListRow, ListSection, Pill, Row, Screen, Segmented, Text } from "@/components/ui";
import { setAppearance, useAppearance, type Appearance } from "@/src/lib/appearance";
import { signOut, useSession } from "@/src/lib/auth";
import { signOutOfGoogle } from "@/src/lib/google-native-device";
import { otaLabel } from "@/src/lib/ota";
import { appleIapAvailable } from "@/src/lib/apple-iap";
import { storeSafe } from "@/src/lib/platform";

export default function More() {
  const router = useRouter();
  const session = useSession();
  const me = useMe();
  const appearance = useAppearance();
  const go = (href: Href) => router.push(href);
  const version = Constants.expoConfig?.version ?? "";
  // Which JS bundle runs (docs/ota.md): null in dev clients and on the web.
  const bundle = otaLabel({
    enabled: Platform.OS !== "web" && Updates.isEnabled,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    isEmergencyLaunch: Updates.isEmergencyLaunch,
    updateId: Updates.updateId,
    runtimeVersion: Updates.runtimeVersion,
    channel: Updates.channel,
  });

  const confirmSignOut = () =>
    Alert.alert("Sign out?", session?.kind === "session" ? "You can sign in again with Google or Apple." : "The token is removed from this phone. Revoke it on the web if the phone is lost.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          void signOutOfGoogle();
          router.replace("/login");
        },
      },
    ]);

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <Screen>
        <Text variant="title" accessibilityRole="header">More</Text>
        <Card>
          <Row gap={14}>
            <Avatar name={me?.user.name ?? null} image={me?.user.image ?? null} size={56} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading" numberOfLines={1}>{me?.user.name ?? "Signed in"}</Text>
              {me?.user.email ? <Text variant="caption" tone="muted" numberOfLines={1}>{me.user.email}</Text> : null}
              <Row gap={6} style={{ flexWrap: "wrap", marginTop: 4 }}>
                <Pill icon="home-outline" label={me?.household.name ?? "Household"} />
                {me?.demo ? <Pill tone="warning" label="Demo data" /> : null}
                <Pill tone="primary" label={session?.kind === "session" ? "Signed in" : "Access token"} />
              </Row>
            </View>
          </Row>
        </Card>

        <ListSection title="Money">
          <ListRow icon="document-text-outline" title="Import statements" subtitle="Jago and GoPay PDFs" onPress={() => go("/import")} />
          <ListRow icon="wallet-outline" title="Accounts" subtitle="Balances, add and archive" onPress={() => go("/accounts")} />
          <ListRow icon="git-network-outline" title="Money flow" subtitle="Where this month's money went" onPress={() => go("/flow")} />
          <ListRow icon="calculator-outline" title="Plan & simulate" subtitle="Can we afford this?" onPress={() => go("/plan")} />
          <ListRow icon="briefcase-outline" title="Reimburse" subtitle="Diganti kantor: claim reports with receipts" onPress={() => go("/reimburse")} />
          {Platform.OS === "android" ? <ListRow icon="notifications-outline" title="Captured payments" subtitle="From Jago and GoPay notifications" onPress={() => go("/captured")} /> : null}
        </ListSection>

        <ListSection title="Household & app">
          {appleIapAvailable ? <ListRow icon="sparkles-outline" title="Joyo Pro" subtitle="Unlimited imports, Joyo AI and more" onPress={() => go("/joyo-pro")} /> : null}
          <ListRow icon="people-outline" title="Household" subtitle="Members and invites" onPress={() => go("/household")} />
          <ListRow icon="settings-outline" title="Settings" subtitle={Platform.OS === "android" ? "Tokens, Claude, data, capture" : "Tokens, Claude, data & privacy"} onPress={() => go("/settings")} />
          <ListRow icon="shield-checkmark-outline" title="Data & privacy" subtitle="AI consent, download your data, delete your account" onPress={() => go("/data-privacy")} />
        </ListSection>

        <Card>
          <FieldLabel label="Appearance">
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
          <ListRow icon="trash-outline" iconTone="destructive" title="Delete account" subtitle="Permanently delete your JoyoArto account" onPress={() => go("/data-privacy")} />
          <ListRow icon="shield-checkmark-outline" title="Privacy policy" onPress={() => void Linking.openURL("https://arto.joyorogo.com/privasi")} />
          <ListRow icon="help-buoy-outline" title="Help & support" onPress={() => void Linking.openURL("https://arto.joyorogo.com/support")} />
          {!storeSafe && session ? <ListRow icon="open-outline" title="JoyoArto on the web" subtitle="The same household in the browser" onPress={() => void Linking.openURL(session.server)} /> : null}
        </ListSection>

        <Button title="Sign out" variant="destructive" icon="log-out-outline" onPress={confirmSignOut} />
        <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
          JoyoArto {version} · not affiliated with any bank or e-wallet
        </Text>
        {bundle ? (
          <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
            {bundle}
          </Text>
        ) : null}
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.background },
}));
