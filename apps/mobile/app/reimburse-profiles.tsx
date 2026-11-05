// Settings → Reimbursement (the web's Settings section): the companies that pay work expenses back, and what their
// claim reports print about the claimant and approver.

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, View } from "react-native";

import { invalidateLedger, useMe } from "@/components/data";
import { useReimburseProfiles } from "@/components/receipts/receipts";
import { Button, Card, EmptyState, ErrorState, Field, Row, Screen, SkeletonCard, Text } from "@/components/ui";
import { errorMessage } from "@/src/lib/errors";
import { client } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import type { AppRouterClient, Out } from "@/src/lib/rpc";
import { toast } from "@/src/lib/toast";

type Profile = Out<AppRouterClient["reimburse"]["profiles"]["list"]>["profiles"][number];
type Form = { companyName: string; claimantName: string; employeeId: string; department: string; approverName: string; approverEmail: string };

const fromProfile = (p: Profile): Form => ({
  companyName: p.companyName,
  claimantName: p.claimantName,
  employeeId: p.employeeId ?? "",
  department: p.department ?? "",
  approverName: p.approverName ?? "",
  approverEmail: p.approverEmail ?? "",
});

export default function ReimburseProfilesScreen() {
  const me = useMe();
  const profiles = useReimburseProfiles();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const list = (profiles.data?.profiles ?? []).filter((p) => !p.archived);
  const remove = useMutation({
    mutationFn: (id: string) => client.reimburse.profiles.delete({ id }),
    onSuccess: (r) => {
      toast.success(r.archived ? "Archived" : "Deleted", r.archived ? "Its reports stay downloadable" : undefined);
      invalidateLedger();
    },
    onError: (e) => toast.error("Couldn't remove it", errorMessage(e, { storeSafe })),
  });

  return (
    <Screen refreshing={profiles.isRefetching} onRefresh={() => void profiles.refetch()}>
      <Text tone="muted">Who pays work expenses back, and what your claim reports print. JoyoArto never sends anything to the company.</Text>
      {profiles.isPending ? <SkeletonCard lines={3} /> : null}
      {profiles.isError ? <ErrorState error={profiles.error} onRetry={() => void profiles.refetch()} compact={!!profiles.data} /> : null}
      {profiles.isSuccess && !list.length && editing !== "new" ? (
        <EmptyState icon="briefcase-outline" title="No company yet" description="Add your employer to mark expenses “Diganti kantor” and make claim reports." />
      ) : null}
      {list.map((p) =>
        editing === p.id ? (
          <ProfileForm key={p.id} id={p.id} initial={fromProfile(p)} onDone={() => setEditing(null)} />
        ) : (
          <Card
            key={p.id}
            title={p.companyName}
            subtitle={[p.claimantName, p.employeeId, p.department, p.approverName && `approver ${p.approverName}`].filter(Boolean).join(" · ")}
          >
            <Text variant="caption" tone="muted">Owes {p.owed.display}</Text>
            <Row gap={8}>
              <Button title="Edit" small variant="secondary" onPress={() => setEditing(p.id)} />
              <Button
                title="Remove"
                small
                variant="ghost"
                loading={remove.isPending}
                onPress={() =>
                  Alert.alert(`Remove ${p.companyName}?`, "A company with claims is archived; its reports stay downloadable.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Remove", style: "destructive", onPress: () => remove.mutate(p.id) },
                  ])
                }
              />
            </Row>
          </Card>
        ),
      )}
      {editing === "new" ? (
        <ProfileForm initial={{ companyName: "", claimantName: me?.user.name ?? "", employeeId: "", department: "", approverName: "", approverEmail: "" }} onDone={() => setEditing(null)} />
      ) : (
        <Button title="Add a company" icon="add" variant="secondary" onPress={() => setEditing("new")} />
      )}
    </Screen>
  );
}

function ProfileForm({ initial, id, onDone }: { initial: Form; id?: string; onDone: () => void }) {
  const [f, setF] = useState(initial);
  const set = (patch: Partial<Form>) => setF({ ...f, ...patch });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        companyName: f.companyName.trim(),
        claimantName: f.claimantName.trim() || undefined,
        employeeId: f.employeeId.trim() || null,
        department: f.department.trim() || null,
        approverName: f.approverName.trim() || null,
        approverEmail: f.approverEmail.trim() || null,
      };
      return id ? client.reimburse.profiles.update({ id, ...body }) : client.reimburse.profiles.create({ ...body, currency: "IDR" });
    },
    onSuccess: () => {
      toast.success("Saved");
      invalidateLedger();
      onDone();
    },
    onError: (e) => toast.error("Couldn't save", errorMessage(e, { storeSafe })),
  });
  return (
    <Card title={id ? "Edit company" : "New company"}>
      <View style={{ gap: 12 }}>
        <Field label="Company · Perusahaan" value={f.companyName} onChangeText={(companyName) => set({ companyName })} maxLength={80} placeholder="PT Maju Jaya" />
        <Field label="Claimant · Nama pemohon" value={f.claimantName} onChangeText={(claimantName) => set({ claimantName })} maxLength={80} />
        <Field label="Employee ID · NIK" hint="Optional" value={f.employeeId} onChangeText={(employeeId) => set({ employeeId })} maxLength={40} />
        <Field label="Department · Departemen" hint="Optional" value={f.department} onChangeText={(department) => set({ department })} maxLength={80} />
        <Field label="Approver · Penyetuju" hint="Optional" value={f.approverName} onChangeText={(approverName) => set({ approverName })} maxLength={80} />
        <Field label="Approver email" hint="Optional; printed on the report" value={f.approverEmail} onChangeText={(approverEmail) => set({ approverEmail })} maxLength={120} keyboardType="email-address" autoCapitalize="none" />
        <Row gap={8}>
          <Button title="Cancel" variant="ghost" onPress={onDone} />
          <Button title="Save" flex loading={save.isPending} disabled={!f.companyName.trim()} onPress={() => save.mutate()} />
        </Row>
      </View>
    </Card>
  );
}
