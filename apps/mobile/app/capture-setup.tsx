import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { AppState, Platform, View } from "react-native";

import { useAccountOptions } from "@/components/data";
import { Button, Card, Icon, Pill, Row, Screen, Select, SwitchRow, Text } from "@/components/ui";
import { isCaptureSupported, NotificationCapture } from "@/modules/notification-capture";
import { SOURCES } from "@/src/capture/parsers";
import { SAMPLES } from "@/src/capture/parsers/samples";
import { syncCaptures } from "@/src/capture/sync";
import { updateSettings, useSettings } from "@/src/lib/settings";

function usePermission() {
  const [granted, setGranted] = useState(NotificationCapture.isPermissionGranted());
  useFocusEffect(
    useCallback(() => {
      setGranted(NotificationCapture.isPermissionGranted());
      const sub = AppState.addEventListener("change", (s) => s === "active" && setGranted(NotificationCapture.isPermissionGranted()));
      return () => sub.remove();
    }, []),
  );
  return granted;
}

export default function CaptureSetup() {
  const settings = useSettings();
  const granted = usePermission();
  const accounts = useAccountOptions();
  const debug = NotificationCapture.isDebugBuild();
  const [sent, setSent] = useState<string | null>(null);

  if (Platform.OS !== "android" || !isCaptureSupported) {
    return (
      <Screen>
        <Text tone="muted">Notification capture works on Android only. On iPhone, an iOS Shortcut can send bank notifications to JoyoArto (see the README).</Text>
      </Screen>
    );
  }

  const togglePackage = (pkgs: string[], on: boolean) =>
    updateSettings({ packages: on ? [...new Set([...settings.packages, ...pkgs])] : settings.packages.filter((p) => !pkgs.includes(p)) });

  return (
    <Screen>
      <Card tone="primary">
        <Text variant="heading">Save payments from their notifications</Text>
        <Text>
          When Bank Jago or GoPay tells you about a payment, JoyoArto reads the amount, who it went to and the time, and
          saves it as a pending transaction. Your next statement import confirms it.
        </Text>
        <View style={{ gap: 6, marginTop: 4 }}>
          {[
            "Only the apps you switch on below are read. Every other notification is skipped before its text is looked at.",
            "Only the amount, direction, merchant and time are sent. The notification text stays on this phone.",
            "Turn capture off here at any time; nothing is read while it is off.",
          ].map((t) => (
            <Row key={t} gap={8} style={{ alignItems: "flex-start" }}>
              <Icon name="shield-checkmark-outline" size={16} tone="primary" />
              <Text variant="caption" style={{ flex: 1 }}>{t}</Text>
            </Row>
          ))}
        </View>
      </Card>

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text variant="heading">1. Notification access</Text>
          <Pill label={granted ? "Allowed" : "Not allowed"} tone={granted ? "positive" : "warning"} />
        </Row>
        <Text tone="muted">Android asks you to allow this in system settings: find JoyoArto in the list and switch it on.</Text>
        {!granted ? (
          <>
            <Button title="Open notification access" icon="open-outline" onPress={() => NotificationCapture.openPermissionSettings()} />
            <Text variant="caption" tone="muted">
              Greyed out with "Restricted setting"? Android 13+ does that for apps installed outside the Play Store. Open App
              info, tap ⋮ (top right) → "Allow restricted settings", then try again.
            </Text>
            <Button title="Open App info" variant="ghost" small onPress={() => NotificationCapture.openAppDetails()} />
          </>
        ) : null}
      </Card>

      <Card>
        <Text variant="heading">2. Apps to read</Text>
        {SOURCES.map((s) => {
          const on = s.packages.every((p) => settings.packages.includes(p));
          const installed = s.packages.filter((p) => NotificationCapture.isInstalled(p));
          return (
            <View key={s.id} style={{ gap: 6 }}>
              <SwitchRow
                label={s.label}
                hint={installed.length ? `Installed: ${installed.join(", ")}` : `Not installed (${s.packages.join(", ")})`}
                value={on}
                onValueChange={(v) => void togglePackage(s.packages, v)}
              />
              {on ? (
                <Select
                  label={`${s.label} payments go to`}
                  value={settings.accountBySource[s.id]}
                  options={accounts}
                  allowClear
                  clearLabel="Most used account"
                  placeholder="Most used account"
                  onChange={(v) => void updateSettings({ accountBySource: { ...settings.accountBySource, [s.id]: v ?? undefined } })}
                />
              ) : null}
            </View>
          );
        })}
      </Card>

      <Card>
        <Text variant="heading">3. Switch it on</Text>
        <SwitchRow
          label="Capture payments"
          hint={granted ? undefined : "Allow notification access first."}
          value={settings.captureEnabled}
          disabled={!granted && !settings.captureEnabled}
          onValueChange={(v) => void updateSettings({ captureEnabled: v })}
        />
        <SwitchRow
          label="Send unsure ones too"
          hint="Off: captures JoyoArto is not sure about wait in Captured for you to check."
          value={settings.autoSendLowConfidence}
          onValueChange={(v) => void updateSettings({ autoSendLowConfidence: v })}
        />
      </Card>

      {debug ? (
        <Card tone="warning">
          <Text variant="heading">Test sender (debug build)</Text>
          <Text variant="caption">Feeds a made-up notification through the same path as a real one (inbox → parse → queue → send). Capture must be on.</Text>
          {SAMPLES.filter((s) => ["jago payment", "jago incoming transfer", "gopay payment (amount last)", "gopay received", "jago OTP", "jago unfamiliar wording"].includes(s.name)).map((s) => (
            <Button
              key={s.name}
              small
              variant="secondary"
              title={s.name}
              onPress={() => {
                NotificationCapture.simulateNotification(s.packageName, s.title, s.text);
                setSent(s.name);
                setTimeout(() => void syncCaptures(), 300);
              }}
            />
          ))}
          {sent ? <Text variant="caption">Sent "{sent}". See Captured.</Text> : null}
          <SwitchRow
            label="Accept adb test notifications"
            hint="Also reads com.android.shell: adb shell cmd notification post -S bigtext -t 'Pembayaran berhasil' tag 'Pembayaran ke KOPI sebesar Rp25.000 berhasil.'"
            value={settings.acceptAdbTests}
            onValueChange={(v) => void updateSettings({ acceptAdbTests: v })}
          />
        </Card>
      ) : null}
    </Screen>
  );
}
