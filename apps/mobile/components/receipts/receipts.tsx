// Receipt photos and the "Reimburse / Diganti kantor" switch on the phone (the web's components/receipts.tsx).
// Photos are loaded from /api/attachments/{id} with the session's bearer token: never a public URL.

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Image, Linking, Pressable, View } from "react-native";
import type { ImageStyle, StyleProp } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { invalidateLedger } from "@/components/data";
import { Button, Picker, Row, SwitchRow, Text } from "@/components/ui";
import { createApi } from "@/src/lib/api";
import { currentCredentials } from "@/src/lib/auth";
import { errorMessage } from "@/src/lib/errors";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { receiptUpload, reimburseLocked } from "@/src/lib/receipt";
import type { ReimburseStatus } from "@/src/lib/receipt";
import { CameraDenied, pickReceiptPhoto } from "@/src/lib/receipt-photo";
import type { ReceiptPhoto } from "@/src/lib/receipt-photo";
import { toast } from "@/src/lib/toast";

/** The REST client for multipart uploads, with the current session. */
export function restApi() {
  const creds = currentCredentials();
  if (!creds) throw new Error("You were signed out. Sign in again.");
  return createApi(creds, fetch, { storeSafe });
}

/** A receipt photo from the server (bearer token in the request headers). */
export function AuthImage({ attachmentId, style, label }: { attachmentId: string; style?: StyleProp<ImageStyle>; label: string }) {
  const creds = currentCredentials();
  if (!creds) return null;
  const uri = `${creds.server.replace(/\/+$/, "")}/api/attachments/${attachmentId}`;
  return <Image source={{ uri, headers: { Authorization: `Bearer ${creds.token}` } }} style={style} resizeMode="cover" accessibilityLabel={label} accessible />;
}

/** "Foto" (camera) and "Galeri"; the picked photo arrives shrunk to ~1600 px JPEG. */
export function PhotoButtons({ onPicked, busy, takeTitle = "Foto struk", chooseTitle = "Galeri" }: { onPicked: (p: ReceiptPhoto) => void; busy?: boolean; takeTitle?: string; chooseTitle?: string }) {
  const pick = async (source: "camera" | "library") => {
    try {
      const photo = await pickReceiptPhoto(source);
      if (photo) onPicked(photo);
    } catch (e) {
      if (e instanceof CameraDenied) {
        Alert.alert("Camera access is off", e.message, [
          { text: "Use gallery", onPress: () => void pick("library") },
          ...(e.canAskAgain ? [] : [{ text: "Open Settings", onPress: () => void Linking.openSettings() }]),
          { text: "Cancel", style: "cancel" as const },
        ]);
      } else toast.error("Couldn't open that photo", errorMessage(e, { storeSafe }));
    }
  };
  return (
    <Row gap={8}>
      <Button title={takeTitle} icon="camera-outline" variant="secondary" small flex loading={busy} onPress={() => void pick("camera")} />
      <Button title={chooseTitle} icon="images-outline" variant="ghost" small flex disabled={busy} onPress={() => void pick("library")} />
    </Row>
  );
}

export function useReimburseProfiles() {
  return useQuery(orpc.reimburse.profiles.list.queryOptions({ input: {} }));
}

/** The switch and, with several companies, the company picker. profileId "" = the most recently used one. */
export function ReimburseSwitch({
  value,
  onChange,
  disabled,
  locked,
  onAddProfile,
}: {
  value: { on: boolean; profileId: string };
  onChange: (v: { on: boolean; profileId: string }) => void;
  disabled?: boolean;
  locked?: string | null;
  onAddProfile?: () => void;
}) {
  const profiles = useReimburseProfiles();
  const list = (profiles.data?.profiles ?? []).filter((p) => !p.archived);
  if (locked) {
    return (
      <View style={styles.box}>
        <Text variant="caption" tone="muted">{locked}</Text>
      </View>
    );
  }
  const none = profiles.isSuccess && !list.length;
  return (
    <View style={styles.box}>
      <SwitchRow
        label="Reimburse · Diganti kantor"
        hint={none ? "Add the company that pays you back first (Settings → Reimbursement)." : "Paid for work; the company pays it back. Not counted as household spending."}
        value={value.on}
        disabled={disabled || none}
        onValueChange={(on) => onChange({ ...value, on })}
      />
      {none && onAddProfile ? <Button title="Add a company" small variant="ghost" onPress={onAddProfile} /> : null}
      {value.on && list.length > 1 ? (
        <Picker
          label="Company"
          value={value.profileId || list[0]!.id}
          groups={[{ label: null, options: list.map((p) => ({ value: p.id, label: p.companyName })) }]}
          onChange={(v) => v && onChange({ ...value, profileId: v })}
        />
      ) : null}
      {value.on && list.length === 1 ? <Text variant="caption" tone="muted">For {list[0]!.companyName}</Text> : null}
    </View>
  );
}

type TxLike = {
  id: string;
  amount: number;
  merchant: string | null;
  description: string;
  attachments: { id: string }[];
  reimburse: { status: ReimburseStatus; profileId: string | null } | null;
};

/** Photos and reimbursement of one transaction: add, replace or remove a photo; mark it reimbursable. */
export function TransactionReceipts({ t, onChanged, onAddProfile }: { t: TxLike; onChanged: () => void; onAddProfile?: () => void }) {
  const [replace, setReplace] = useState(true);
  const upload = useMutation({
    mutationFn: (photo: ReceiptPhoto) => restApi().uploadAttachment(receiptUpload(photo.uri), t.id, replace && t.attachments.length > 0),
    onSuccess: () => {
      toast.success("Photo saved");
      invalidateLedger();
      onChanged();
    },
    onError: (e) => toast.error("Couldn't save the photo", errorMessage(e, { storeSafe })),
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.attachments.delete({ id }),
    onSuccess: () => {
      invalidateLedger();
      onChanged();
    },
    onError: (e) => toast.error("Couldn't remove the photo", errorMessage(e, { storeSafe })),
  });
  const mark = useMutation({
    mutationFn: (v: { on: boolean; profileId: string }) => client.reimburse.mark({ ids: [t.id], reimbursable: v.on, ...(v.profileId ? { profileId: v.profileId } : {}) }),
    onSuccess: (_r, v) => {
      toast.success(v.on ? "Marked reimbursable" : "Back to household spending");
      invalidateLedger();
      onChanged();
    },
    onError: (e) => toast.error("Couldn't change it", errorMessage(e, { storeSafe })),
  });
  const label = t.merchant ?? t.description;
  return (
    <View style={{ gap: 12 }}>
      {t.attachments.length ? (
        <Row gap={10} style={{ flexWrap: "wrap" }}>
          {t.attachments.map((a) => (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              accessibilityLabel={`Receipt photo for ${label}. Long press to remove.`}
              onLongPress={() =>
                Alert.alert("Remove this photo?", undefined, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => remove.mutate(a.id) },
                ])
              }
            >
              <AuthImage attachmentId={a.id} style={styles.thumb} label={`Receipt for ${label}`} />
            </Pressable>
          ))}
        </Row>
      ) : (
        <Text variant="caption" tone="muted">No receipt photo.</Text>
      )}
      {t.attachments.length ? <SwitchRow label="Replace the current photo" value={replace} onValueChange={setReplace} /> : null}
      <PhotoButtons busy={upload.isPending} takeTitle={t.attachments.length ? "Foto baru" : "Foto struk"} onPicked={(p) => upload.mutate(p)} />
      {t.amount < 0 ? (
        <ReimburseSwitch
          value={{ on: t.reimburse?.status === "draft", profileId: t.reimburse?.profileId ?? "" }}
          onChange={(v) => mark.mutate(v)}
          disabled={mark.isPending}
          locked={reimburseLocked(t.reimburse?.status)}
          onAddProfile={onAddProfile}
        />
      ) : t.reimburse?.status === "payment" ? (
        <Text variant="caption" tone="muted">{reimburseLocked("payment")}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: { backgroundColor: theme.colors.muted, borderRadius: theme.radius.tile, padding: 12, gap: 6 },
  thumb: { width: 96, height: 128, borderRadius: theme.radius.tile, backgroundColor: theme.colors.muted },
}));
