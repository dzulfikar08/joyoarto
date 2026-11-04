import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { BrandMark } from "@/components/brand";
import { Button, Card, Field, Row, Text } from "@/components/ui";
import { createApi, DEFAULT_SERVER, looksLikeToken, requestDemoToken } from "@/src/lib/api";
import { signIn } from "@/src/lib/auth";
import { storeSafe } from "@/src/lib/platform";
import type { Me } from "@/src/lib/types";

export default function Login() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  // "Coba demo / Reviewer": a demo code (from the store listing's review notes) instead of a token.
  const [demo, setDemo] = useState(false);
  const [code, setCode] = useState("");

  async function demoSignIn() {
    setError(null);
    if (!code.trim()) return setError("Masukkan kode demo. / Enter the demo code.");
    setBusy(true);
    try {
      const creds = { server: server.trim().replace(/\/+$/, ""), token: "" };
      creds.token = (await requestDemoToken(creds.server, code)).token;
      await signIn(creds, await createApi(creds).me());
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setError(null);
    if (!looksLikeToken(token)) return setError("Paste the whole token: it starts with brk_.");
    setBusy(true);
    try {
      const creds = { server: server.trim().replace(/\/+$/, ""), token: token.trim() };
      setMe(await createApi(creds, fetch, { storeSafe }).me());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!me) return;
    await signIn({ server: server.trim().replace(/\/+$/, ""), token }, me);
    router.replace("/");
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Row gap={12}>
          <BrandMark size={44} />
          <Text variant="title">JoyoArto</Text>
        </Row>
        <Text tone="muted">
          Sign in with a personal access token. On the web, open Settings → API tokens, create one with finance:read and
          finance:write, and paste it here. It is kept in this phone's secure storage.
        </Text>
        {me ? (
          <Card tone="primary">
            <Text variant="label" tone="primary">This token belongs to</Text>
            <Text variant="heading">{me.household.name ?? "Household"}</Text>
            <Text>{[me.user.name, me.user.email].filter(Boolean).join(" · ")}</Text>
            <Text variant="caption" tone="muted">Access: {me.scopes.join(", ")}</Text>
            {!me.scopes.includes("finance:write") ? (
              <Text variant="caption" tone="warning">Without finance:write the app can show balances but cannot save captures or imports.</Text>
            ) : null}
            <Row>
              <View style={{ flex: 1 }}><Button title="Use this account" onPress={confirm} /></View>
              <Button title="Back" variant="ghost" onPress={() => setMe(null)} />
            </Row>
          </Card>
        ) : demo ? (
          <>
            <Card>
              <Text variant="label">Coba demo / Reviewer</Text>
              <Text tone="muted">
                Akun demo berisi data contoh (bukan data asli) dan direset setiap hari. Demo account with made-up data, reset every day.
              </Text>
            </Card>
            <Field label="Kode demo / Demo code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} error={error} />
            {advanced ? (
              <Field label="Server" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            ) : null}
            <Button title="Masuk ke demo / Open the demo" onPress={demoSignIn} loading={busy} />
            <Button title="Pakai token / Use a token" variant="ghost" small onPress={() => { setDemo(false); setError(null); }} />
          </>
        ) : (
          <>
            <Field label="Token" value={token} onChangeText={setToken} placeholder="brk_…" autoCapitalize="none" autoCorrect={false} secureTextEntry error={error} />
            {advanced ? (
              <Field label="Server" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" hint="Local stack from the Android emulator: http://10.0.2.2:3500" />
            ) : null}
            <Button title="Check token" onPress={check} loading={busy} />
            <Row style={{ justifyContent: "space-between" }}>
              {storeSafe ? (
                <Text variant="caption" tone="muted">Make a token in JoyoArto on the web: Settings → API tokens.</Text>
              ) : (
                <Button title="Open JoyoArto on the web" variant="ghost" small onPress={() => void Linking.openURL(`${server.replace(/\/+$/, "")}/settings`)} />
              )}
              <Button title={advanced ? "Hide server" : "Server…"} variant="ghost" small onPress={() => setAdvanced(!advanced)} />
            </Row>
            <Button title="Coba demo / Reviewer" variant="secondary" onPress={() => { setDemo(true); setError(null); }} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  body: { flex: 1, padding: theme.spacing.lg, gap: theme.spacing.lg, justifyContent: "center" },
}));
