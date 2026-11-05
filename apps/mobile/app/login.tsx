// Sign in. First choice: Google (native account sheet, src/lib/google-native*.ts) and, on iPhone, Sign in with Apple
// (App Store guideline 4.8, src/lib/apple-sign-in.ts); both become a JoyoArto session (docs/mobile-auth.md). Second:
// a personal access token from the web, or the store reviewers' demo code.

import * as AppleAuthentication from "expo-apple-authentication";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { BrandMark } from "@/components/brand";
import { Button, Card, Field, Row, Text } from "@/components/ui";
import { createApi, DEFAULT_SERVER, looksLikeToken, requestDemoToken } from "@/src/lib/api";
import { appleSignInAvailable, clearPendingAppleName, requestAppleIdToken } from "@/src/lib/apple-sign-in";
import { signIn, signInWithIdToken } from "@/src/lib/auth";
import { signInWithNativeGoogle } from "@/src/lib/google-native";
import { nativeGoogleAvailable, requestGoogleIdToken } from "@/src/lib/google-native-device";
import { storeSafe } from "@/src/lib/platform";
import type { Me } from "@/src/lib/types";

type Mode = "main" | "token" | "demo";

const normalize = (server: string) => server.trim().replace(/\/+$/, "");

export default function Login() {
  const router = useRouter();
  const { rt } = useUnistyles();
  const [mode, setMode] = useState<Mode>("main");
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<"google" | "apple" | "token" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const googleAvailable = nativeGoogleAvailable();

  useEffect(() => {
    void appleSignInAvailable().then(setAppleAvailable);
  }, []);

  const done = () => router.replace("/");

  async function google() {
    setError(null);
    setBusy("google");
    try {
      const outcome = await signInWithNativeGoogle({
        available: () => googleAvailable,
        requestIdToken: requestGoogleIdToken,
        exchange: (idToken) => signInWithIdToken({ server: normalize(server), provider: "google", idToken }),
        log: (m) => console.log(m),
      });
      if (outcome.kind === "signed-in") done();
      else if (outcome.kind === "unavailable" || outcome.kind === "failed") setError(outcome.message);
    } finally {
      setBusy(null);
    }
  }

  async function apple() {
    setError(null);
    setBusy("apple");
    try {
      const token = await requestAppleIdToken();
      if (!token) return;
      await signInWithIdToken({ ...token, server: normalize(server) });
      void clearPendingAppleName();
      done();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <BrandMark size={64} />
          <Text variant="title">JoyoArto</Text>
          <Text tone="muted" style={{ textAlign: "center" }}>
            Your household's money in one ledger: balances, spending and statements.
          </Text>
        </View>

        {mode === "main" ? (
          <View style={styles.actions}>
            {appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={rt.themeName === "dark" ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={24}
                style={styles.apple}
                onPress={() => void apple()}
              />
            ) : null}
            {googleAvailable ? <Button title="Continue with Google" icon="logo-google" loading={busy === "google"} disabled={!!busy} onPress={() => void google()} /> : null}
            {error ? <Text tone="destructive" style={{ textAlign: "center" }}>{error}</Text> : null}
            <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
              New here? Signing in creates your household. Invited to one? Use the Google account the invite was sent to.
            </Text>
            <View style={styles.or}>
              <View style={styles.line} />
              <Text variant="caption" tone="muted">other ways</Text>
              <View style={styles.line} />
            </View>
            <Button title="Use an access token" variant="secondary" icon="key-outline" disabled={!!busy} onPress={() => (setMode("token"), setError(null))} />
            <Button title="Coba demo / Reviewer" variant="ghost" disabled={!!busy} onPress={() => (setMode("demo"), setError(null))} />
          </View>
        ) : mode === "token" ? (
          <TokenSignIn server={normalize(server)} onBack={() => setMode("main")} onDone={done} />
        ) : (
          <DemoSignIn server={normalize(server)} onBack={() => setMode("main")} onDone={done} />
        )}

        <View style={{ alignItems: "center" }}>
          <Button title={advanced ? "Hide server" : "Server…"} variant="ghost" small onPress={() => setAdvanced(!advanced)} />
          {advanced ? (
            <View style={{ alignSelf: "stretch" }}>
              <Field label="Server" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" hint="Local stack from the Android emulator: http://10.0.2.2:3500" />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** A personal access token (brk_…) from the web: Settings → API tokens. Checked before it is stored. */
function TokenSignIn({ server, onBack, onDone }: { server: string; onBack: () => void; onDone: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  async function check() {
    setError(null);
    if (!looksLikeToken(token)) return setError("Paste the whole token: it starts with brk_.");
    setBusy(true);
    try {
      setMe(await createApi({ server, token: token.trim() }, fetch, { storeSafe }).me());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (me) {
    return (
      <Card tone="primary">
        <Text variant="label" tone="primary">This token belongs to</Text>
        <Text variant="heading">{me.household.name ?? "Household"}</Text>
        <Text>{[me.user.name, me.user.email].filter(Boolean).join(" · ")}</Text>
        <Text variant="caption" tone="muted">Access: {me.scopes.join(", ")}</Text>
        {!me.scopes.includes("finance:write") ? <Text variant="caption" tone="warning">Without finance:write the app can show balances but cannot save captures or imports.</Text> : null}
        <Row>
          <Button title="Use this account" flex onPress={async () => (await signIn({ server, token: token.trim() }, me), onDone())} />
          <Button title="Back" variant="ghost" onPress={() => setMe(null)} />
        </Row>
      </Card>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <Text tone="muted">
        On the web, open Settings → API tokens, create one with finance:read and finance:write, and paste it here. It is kept in this phone's secure storage.
      </Text>
      <Field label="Token" value={token} onChangeText={setToken} placeholder="brk_…" autoCapitalize="none" autoCorrect={false} secureTextEntry error={error} />
      <Button title="Check token" onPress={check} loading={busy} />
      {!storeSafe ? <Button title="Open JoyoArto on the web" variant="ghost" small onPress={() => void Linking.openURL(`${server}/settings`)} /> : null}
      <Button title="Back" variant="ghost" small icon="arrow-back" onPress={onBack} />
    </View>
  );
}

/** "Coba demo / Reviewer": the demo code (store review notes) gives a 7-day token for the demo household. */
function DemoSignIn({ server, onBack, onDone }: { server: string; onBack: () => void; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setError(null);
    if (!code.trim()) return setError("Masukkan kode demo. / Enter the demo code.");
    setBusy(true);
    try {
      const { token } = await requestDemoToken(server, code);
      await signIn({ server, token }, await createApi({ server, token }, fetch, { storeSafe }).me());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Text variant="label">Coba demo / Reviewer</Text>
        <Text tone="muted">Akun demo berisi data contoh (bukan data asli) dan direset setiap hari. Demo account with made-up data, reset every day.</Text>
      </Card>
      <Field label="Kode demo / Demo code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} error={error} />
      <Button title="Masuk ke demo / Open the demo" onPress={go} loading={busy} />
      <Button title="Back" variant="ghost" small icon="arrow-back" onPress={onBack} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  body: { flexGrow: 1, padding: theme.spacing.lg, gap: theme.spacing.xl, justifyContent: "center", maxWidth: 480, width: "100%", alignSelf: "center" },
  hero: { alignItems: "center", gap: theme.spacing.sm },
  actions: { gap: theme.spacing.md },
  apple: { height: 48, width: "100%" },
  or: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4 },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
}));
