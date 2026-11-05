// Reimburse ("Diganti kantor"), the web's /reimburse: open work expenses per company, the claim report (PDF with the
// receipt photos, or CSV) saved to the phone and shared (email, print, WhatsApp), and the claims made so far.
// Nothing is sent to the company by JoyoArto.

import { useMutation, useQuery } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { invalidateLedger } from "@/components/data";
import { AuthImage, useReimburseProfiles } from "@/components/receipts/receipts";
import { Button, Card, DateField, EmptyState, ErrorState, Field, Icon, Picker, Pill, Row, Screen, SkeletonCard, SwitchRow, Text } from "@/components/ui";
import { currentCredentials } from "@/src/lib/auth";
import { errorMessage } from "@/src/lib/errors";
import { formatMoney } from "@/src/lib/format";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { claimFileName, REIMBURSE_LABEL } from "@/src/lib/receipt";
import type { AppRouterClient, Out } from "@/src/lib/rpc";
import { toast } from "@/src/lib/toast";

type Claim = Out<AppRouterClient["reimburse"]["claims"]["list"]>["claims"][number];

const CLAIM_STATUS: Record<Claim["status"], { label: string; tone: "primary" | "positive" | "destructive" }> = {
  submitted: { label: "Diajukan", tone: "primary" },
  paid: { label: "Dibayar", tone: "positive" },
  rejected: { label: "Ditolak", tone: "destructive" },
};

/** Downloads a claim's PDF or CSV with the session and opens the share sheet (email, print, save to Files). */
async function shareClaim(claim: Pick<Claim, "number" | "pdfPath" | "csvPath">, kind: "pdf" | "csv") {
  const creds = currentCredentials();
  if (!creds) throw new Error("You were signed out. Sign in again.");
  const dest = `${FileSystem.cacheDirectory}${claimFileName(claim.number, kind)}`;
  const res = await FileSystem.downloadAsync(`${creds.server.replace(/\/+$/, "")}${kind === "pdf" ? claim.pdfPath : claim.csvPath}`, dest, {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  if (res.status < 200 || res.status >= 300) {
    void FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
    throw new Error(`Couldn't download the report (${res.status}).`);
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this phone.");
  await Sharing.shareAsync(res.uri, {
    mimeType: kind === "pdf" ? "application/pdf" : "text/csv",
    UTI: kind === "pdf" ? "com.adobe.pdf" : "public.comma-separated-values-text",
    dialogTitle: `Klaim ${claim.number}`,
  });
}

export default function ReimburseScreen() {
  const router = useRouter();
  const profiles = useReimburseProfiles();
  const list = (profiles.data?.profiles ?? []).filter((p) => !p.archived);
  const [profileId, setProfileId] = useState("");
  const profile = list.find((p) => p.id === profileId) ?? list[0];

  if (profiles.isPending) {
    return (
      <Screen>
        <SkeletonCard lines={4} />
      </Screen>
    );
  }
  if (profiles.isError) {
    return (
      <Screen>
        <ErrorState error={profiles.error} onRetry={() => void profiles.refetch()} />
      </Screen>
    );
  }
  if (!profile) {
    return (
      <Screen>
        <EmptyState
          icon="briefcase-outline"
          title="Add the company that pays you back"
          description="Then mark expenses “Diganti kantor” when you add them (snap the receipt), and make a claim report here to email or print for approval."
          action={<Button title="Add a company" small onPress={() => router.push("/reimburse-profiles")} />}
        />
      </Screen>
    );
  }
  return (
    <Screen refreshing={profiles.isRefetching} onRefresh={() => (void profiles.refetch(), invalidateLedger())}>
      {list.length > 1 ? (
        <Picker label="Company" value={profile.id} groups={[{ label: null, options: list.map((p) => ({ value: p.id, label: p.companyName })) }]} onChange={(v) => v && setProfileId(v)} />
      ) : null}
      <Card title={profile.companyName} subtitle="Owed · Piutang" action={<Button title="Edit" small variant="ghost" onPress={() => router.push("/reimburse-profiles")} />}>
        <Text variant="title">{profile.owed.display}</Text>
        <Text variant="caption" tone="muted">
          {profile.draft.count} not claimed yet ({profile.draft.display}) · {profile.submitted.count} submitted ({profile.submitted.display})
        </Text>
      </Card>
      <OpenItems key={profile.id} profileId={profile.id} />
      <Claims profileId={profile.id} />
    </Screen>
  );
}

function OpenItems({ profileId }: { profileId: string }) {
  const { theme } = useUnistyles();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");
  const items = useQuery(orpc.reimburse.items.queryOptions({ input: { profileId, status: "draft", ...(from ? { from } : {}), ...(to ? { to } : {}) } }));
  const rows = useMemo(() => items.data?.items ?? [], [items.data]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  useEffect(() => setExcluded(new Set()), [from, to]);
  const selected = rows.filter((r) => !excluded.has(r.id));
  const total = selected.reduce((s, r) => s - r.amount, 0);
  const currency = rows[0]?.currency ?? "IDR";
  const create = useMutation({
    mutationFn: () => client.reimburse.claims.create({ profileId, transactionIds: selected.map((r) => r.id), notes: notes.trim() || undefined, ...(from ? { from } : {}), ...(to ? { to } : {}) }),
    onSuccess: async ({ claim }) => {
      toast.success(`Claim ${claim.number} ready`, `${claim.itemCount} items · ${claim.total.display}`);
      setNotes("");
      invalidateLedger();
      try {
        await shareClaim(claim, "pdf");
      } catch (e) {
        toast.error("Couldn't open the report", errorMessage(e, { storeSafe }));
      }
    },
    onError: (e) => toast.error("Couldn't make the report", errorMessage(e, { storeSafe })),
  });

  return (
    <Card title="Not claimed yet" subtitle="Pick the items and period, then make the report">
      <Row gap={8}>
        <View style={{ flex: 1 }}>
          <DateField label="From" value={from} max={to || undefined} clearable onChange={setFrom} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="To" value={to} min={from || undefined} clearable onChange={setTo} />
        </View>
      </Row>
      {items.isPending ? <SkeletonCard lines={3} /> : null}
      {items.isError ? <ErrorState compact error={items.error} onRetry={() => void items.refetch()} /> : null}
      {items.isSuccess && !rows.length ? (
        <Text tone="muted">Nothing to claim{from || to ? " in this period" : ""}. Mark an expense “Diganti kantor” in the add sheet or on a transaction.</Text>
      ) : null}
      {rows.map((r) => {
        const on = !excluded.has(r.id);
        return (
          <Pressable
            key={r.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${r.merchant ?? r.description}, ${r.display}, ${r.date}`}
            onPress={() => {
              const next = new Set(excluded);
              if (on) next.add(r.id);
              else next.delete(r.id);
              setExcluded(next);
            }}
            style={styles.item}
          >
            <Icon name={on ? "checkbox" : "square-outline"} size={22} color={on ? theme.colors.primary : theme.colors.mutedForeground} />
            {r.attachments[0] ? (
              <AuthImage attachmentId={r.attachments[0].id} style={styles.thumb} label={`Receipt ${r.merchant ?? r.description}`} />
            ) : (
              <View style={[styles.thumb, styles.noProof]}>
                <Text variant="caption" tone="muted" style={{ fontSize: 9, textAlign: "center" }}>tanpa bukti</Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} variant="label">{r.merchant ?? r.description}</Text>
              <Text numberOfLines={1} variant="caption" tone="muted">
                {r.date} · {r.account} · {r.categoryName ?? "Uncategorized"}
              </Text>
            </View>
            <Text variant="label">{r.display.replace(/^-/, "")}</Text>
          </Pressable>
        );
      })}
      {rows.length ? (
        <>
          <Field label="Keperluan / Purpose" hint="Printed on the report" value={notes} onChangeText={setNotes} maxLength={1000} multiline placeholder="Kunjungan klien Bandung" />
          <Text variant="label">
            {selected.length} item{selected.length === 1 ? "" : "s"} · {formatMoney(total, currency)}
          </Text>
          <Button title={create.isPending ? "Making the report…" : "Buat laporan · Generate report"} icon="document-text-outline" loading={create.isPending} disabled={!selected.length} onPress={() => create.mutate()} />
        </>
      ) : null}
    </Card>
  );
}

function Claims({ profileId }: { profileId: string }) {
  const claims = useQuery(orpc.reimburse.claims.list.queryOptions({ input: { profileId } }));
  const [open, setOpen] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const list = claims.data?.claims ?? [];
  if (claims.isSuccess && !list.length) return null;
  const share = async (c: Claim, kind: "pdf" | "csv") => {
    setSharing(`${c.id}:${kind}`);
    try {
      await shareClaim(c, kind);
    } catch (e) {
      toast.error("Couldn't open the report", errorMessage(e, { storeSafe }));
    } finally {
      setSharing(null);
    }
  };
  return (
    <Card title="Claim reports">
      {claims.isError ? <ErrorState compact error={claims.error} onRetry={() => void claims.refetch()} /> : null}
      {list.map((c) => (
        <View key={c.id} style={{ gap: 8, paddingVertical: 6 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Row gap={6}>
                <Text variant="label">{c.number}</Text>
                <Pill tone={CLAIM_STATUS[c.status].tone} label={CLAIM_STATUS[c.status].label} />
              </Row>
              <Text variant="caption" tone="muted">
                {c.periodFrom} – {c.periodTo} · {c.itemCount} items · {c.total.display}
              </Text>
            </View>
          </Row>
          <Row gap={8}>
            <Button title="PDF" icon="share-outline" small variant="secondary" loading={sharing === `${c.id}:pdf`} onPress={() => void share(c, "pdf")} />
            <Button title="CSV" small variant="ghost" loading={sharing === `${c.id}:csv`} onPress={() => void share(c, "csv")} />
            <Button title={open === c.id ? "Close" : "Status"} small variant="ghost" onPress={() => setOpen(open === c.id ? null : c.id)} />
          </Row>
          {open === c.id ? <ClaimStatus claim={c} onDone={() => setOpen(null)} /> : null}
        </View>
      ))}
    </Card>
  );
}

/** Paid (with the company's payment and the items it refused), rejected, reopened, or withdrawn. */
function ClaimStatus({ claim, onDone }: { claim: Claim; onDone: () => void }) {
  const detail = useQuery(orpc.reimburse.claims.get.queryOptions({ input: { id: claim.id } }));
  const incoming = useQuery(orpc.transactions.search.queryOptions({ input: { direction: "in", from: claim.periodFrom, limit: 100, reimburse: "none" } }));
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const run = useMutation({
    mutationFn: (status: "paid" | "rejected" | "submitted") =>
      client.reimburse.claims.setStatus({ id: claim.id, status, ...(status === "paid" && paymentId ? { paymentTransactionId: paymentId } : {}), ...(status === "paid" ? { rejectIds: [...rejected] } : {}) }),
    onSuccess: (r) => {
      toast.success(`Claim ${r.claim.number}: ${CLAIM_STATUS[r.claim.status].label}`);
      invalidateLedger();
      onDone();
    },
    onError: (e) => toast.error("Couldn't change it", errorMessage(e, { storeSafe })),
  });
  const withdraw = useMutation({
    mutationFn: () => client.reimburse.claims.delete({ id: claim.id }),
    onSuccess: () => {
      toast.success("Withdrawn", "The items are back in Not claimed yet");
      invalidateLedger();
      onDone();
    },
    onError: (e) => toast.error("Couldn't withdraw it", errorMessage(e, { storeSafe })),
  });

  if (claim.status !== "submitted") {
    return (
      <View style={styles.box}>
        {claim.status === "paid" && detail.data ? (
          <Text variant="caption" tone="muted">
            Payments recorded: {detail.data.payments.map((p) => p.display).join(", ") || "none"}. Difference {detail.data.difference.display}.
          </Text>
        ) : null}
        <Button title="Reopen" small variant="secondary" loading={run.isPending} onPress={() => run.mutate("submitted")} />
      </View>
    );
  }
  const options = (incoming.data?.transactions ?? []).map((t) => ({ value: t.id, label: `${t.date} · ${t.merchant ?? t.description}`, hint: t.display }));
  return (
    <View style={styles.box}>
      <Picker
        label="The company's payment (money in)"
        hint="It then counts as a transfer, not income. Leave it empty if it came with your salary or in cash."
        value={paymentId}
        groups={[{ label: null, options }]}
        onChange={setPaymentId}
        none="Not recorded"
        searchPlaceholder="Search money in"
      />
      {detail.data && detail.data.items.length > 1 ? (
        <View style={{ gap: 2 }}>
          <Text variant="caption" tone="muted">Items the company did not pay (they count as your own spending again)</Text>
          {detail.data.items.map((i) => (
            <SwitchRow
              key={i.id}
              label={`${i.date} · ${i.merchant ?? i.description} · ${i.display.replace(/^-/, "")}`}
              hint={i.reimburse && i.reimburse.status !== "submitted" ? REIMBURSE_LABEL[i.reimburse.status] : undefined}
              value={rejected.has(i.id)}
              onValueChange={(v) => {
                const next = new Set(rejected);
                if (v) next.add(i.id);
                else next.delete(i.id);
                setRejected(next);
              }}
            />
          ))}
        </View>
      ) : null}
      <Row gap={8} style={{ flexWrap: "wrap" }}>
        <Button title="Mark paid" small loading={run.isPending} onPress={() => run.mutate("paid")} />
        <Button
          title="Rejected"
          small
          variant="secondary"
          onPress={() =>
            Alert.alert("Reject the whole claim?", "Its items count as your own spending again.", [
              { text: "Cancel", style: "cancel" },
              { text: "Reject", style: "destructive", onPress: () => run.mutate("rejected") },
            ])
          }
        />
        <Button
          title="Withdraw"
          small
          variant="ghost"
          loading={withdraw.isPending}
          onPress={() =>
            Alert.alert(`Withdraw ${claim.number}?`, "The report is deleted and its items go back to Not claimed yet.", [
              { text: "Cancel", style: "cancel" },
              { text: "Withdraw", style: "destructive", onPress: () => withdraw.mutate() },
            ])
          }
        />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  item: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingVertical: 4 },
  thumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: theme.colors.muted },
  noProof: { alignItems: "center", justifyContent: "center", padding: 2 },
  box: { backgroundColor: theme.colors.muted, borderRadius: theme.radius.tile, padding: 12, gap: 10 },
}));
