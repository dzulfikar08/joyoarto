import "@/unistyles";
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Redirect, Stack, usePathname, useRouter } from "expo-router";
import { addNetworkStateListener } from "expo-network";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useUnistyles } from "react-native-unistyles";

import { AddSheet } from "@/components/add/add-sheet";
import { ToastHost } from "@/components/ui";
import { NotificationCapture } from "@/modules/notification-capture";
import { syncCaptures } from "@/src/capture/sync";
import { loadCaptures } from "@/src/capture/store";
import { loadAppearance } from "@/src/lib/appearance";
import { loadSession, useSession } from "@/src/lib/auth";
// Side effects only: both clear their on-device data (own API key, plan draft) at sign-out, even if never opened.
import "@/src/lib/joyo-byok";
import "@/src/lib/plan-draft";
// Captures belong to the signed-in account: deleted at sign-out, held for the same account after an expired sign-in.
import "@/src/capture/session";
import { bindQueryLifecycle, persistOptions, queryClient } from "@/src/lib/query";
import { loadSettings, syncNativeConfig } from "@/src/lib/settings";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
bindQueryLifecycle();

/** Keeps the capture queue moving while the app is open: on start, on foreground, on reconnect, every minute. */
function CaptureSync() {
  useEffect(() => {
    void syncCaptures();
    const sub = NotificationCapture.addCaptureListener(() => void syncCaptures());
    const app = AppState.addEventListener("change", (s) => s === "active" && void syncCaptures());
    const net = addNetworkStateListener((s) => s.isInternetReachable && void syncCaptures());
    const timer = setInterval(() => void syncCaptures(), 60_000);
    return () => {
      sub?.remove();
      app.remove();
      net.remove();
      clearInterval(timer);
    };
  }, []);
  return null;
}

/** A PDF shared to the app opens the import screen. */
function ShareRouter() {
  const { hasShareIntent } = useShareIntentContext();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (hasShareIntent && path !== "/import") router.push("/import");
  }, [hasShareIntent, path, router]);
  return null;
}

function Root() {
  const { theme, rt } = useUnistyles();
  const session = useSession();
  const path = usePathname();
  const header = {
    headerStyle: { backgroundColor: theme.colors.background },
    headerTintColor: theme.colors.foreground,
    headerTitleStyle: { fontFamily: theme.fonts.bold },
    headerShadowVisible: false,
    headerBackButtonDisplayMode: "minimal" as const,
    contentStyle: { backgroundColor: theme.colors.background },
  };
  if (session === undefined) return null;
  if (!session && path !== "/login") return <Redirect href="/login" />;
  return (
    <>
      <StatusBar style={rt.themeName === "dark" ? "light" : "dark"} />
      {session ? <CaptureSync /> : null}
      {session ? <ShareRouter /> : null}
      <Stack screenOptions={header}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Home" }} />
        <Stack.Screen name="login" options={{ title: "Sign in", headerShown: false }} />
        <Stack.Screen name="transaction/[id]" options={{ title: "Transaction" }} />
        <Stack.Screen name="captured" options={{ title: "Captured" }} />
        <Stack.Screen name="capture/[id]" options={{ title: "Capture" }} />
        <Stack.Screen name="capture-setup" options={{ title: "Notification capture" }} />
        <Stack.Screen name="import" options={{ title: "Import statements" }} />
        <Stack.Screen name="accounts" options={{ title: "Accounts" }} />
        <Stack.Screen name="account/[id]" options={{ title: "Account" }} />
        <Stack.Screen name="plan" options={{ title: "Plan & simulate" }} />
        <Stack.Screen name="household" options={{ title: "Household" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="data-privacy" options={{ title: "Data & privacy" }} />
        <Stack.Screen name="reimburse" options={{ title: "Reimburse" }} />
        <Stack.Screen name="reimburse-profiles" options={{ title: "Reimbursement" }} />
      </Stack>
      {session ? <AddSheet /> : null}
      <ToastHost />
    </>
  );
}

export default function RootLayout() {
  const [fonts] = useFonts({ PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void Promise.all([loadSession(), loadSettings().then(syncNativeConfig), loadCaptures(), loadAppearance().catch(() => undefined)]).finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (fonts && ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fonts, ready]);
  if (!fonts || !ready) return null;
  return (
    <ShareIntentProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <Root />
      </PersistQueryClientProvider>
    </ShareIntentProvider>
  );
}
