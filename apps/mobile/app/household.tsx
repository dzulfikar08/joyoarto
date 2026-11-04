// Household: the active household (switch when you belong to several), rename it, members with roles, invites shared
// through the share sheet, pending invites. At parity with the web's apps/web/src/routes/-household.tsx. The server
// enforces owner rules and the demo account's limits; their refusals are shown as they come.

import { useMutation, useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Alert, Share, View } from "react-native";

import { SessionOnlyNote, useHasSession } from "@/components/session-only";
import { Avatar, Button, Card, EmptyState, ErrorState, Field, FieldLabel, Icon, ListRow, ListSection, Pill, Row, Screen, Segmented, SkeletonCard, Text } from "@/components/ui";
import { useSession } from "@/src/lib/auth";
import { errorMessage } from "@/src/lib/errors";
import { shortDate } from "@/src/lib/format";
import { inviteMessage, inviteUrl, isLastOwner, looksLikeEmail, memberActions, type MemberAction, type Role } from "@/src/lib/household";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import type { AppRouterClient, Out } from "@/src/lib/rpc";
import { queryClient } from "@/src/lib/query";
import { toast } from "@/src/lib/toast";

const refreshHousehold = () => queryClient.invalidateQueries({ queryKey: orpc.household.key() });
/** Everything else (transactions, accounts, me) belongs to the active household too. */
const refreshAll = () => queryClient.invalidateQueries();
const fail = (title: string) => (e: unknown) => toast.error(title, errorMessage(e, { storeSafe }));

const ACTION_LABEL: Record<MemberAction, string> = { makeOwner: "Make owner", makeMember: "Make member", remove: "Remove", leave: "Leave household" };

export default function HouseholdScreen() {
  const info = useQuery(orpc.household.get.queryOptions());
  const mine = useQuery(orpc.household.list.queryOptions());
  const h = info.data;

  const switchTo = useMutation({
    mutationFn: (householdId: string) => client.household.switch({ householdId }),
    onSuccess: () => {
      toast.success("Switched household");
      void refreshAll();
    },
    onError: fail("Couldn't switch"),
  });

  if (info.isPending) {
    return (
      <Screen>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={4} />
      </Screen>
    );
  }
  if (!h) {
    return <Screen>{info.isError ? <ErrorState error={info.error} onRetry={() => void info.refetch()} /> : <EmptyState icon="people-outline" title="No household" />}</Screen>;
  }

  const households = mine.data?.households ?? [];
  return (
    <Screen refreshing={info.isRefetching} onRefresh={() => void Promise.all([info.refetch(), mine.refetch()])}>
      {info.isError ? <ErrorState error={info.error} onRetry={() => void info.refetch()} compact /> : null}
      <NameCard name={h.household.name} owner={h.yourRole === "owner"} />

      {households.length > 1 ? (
        <ListSection title="Your households" footer="The active one is what the app, your tokens and AI connections see.">
          {households.map((x) => (
            <ListRow
              key={x.id}
              icon={x.active ? "checkmark-circle" : "home-outline"}
              iconTone={x.active ? "positive" : "muted"}
              title={x.name}
              subtitle={`${x.role === "owner" ? "Owner" : "Member"}${x.active ? " · active" : ""}`}
              chevron={false}
              onPress={
                x.active || switchTo.isPending
                  ? undefined
                  : () =>
                      Alert.alert(`Switch to ${x.name}?`, "Its accounts, transactions and budgets replace what you see now.", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Switch", onPress: () => switchTo.mutate(x.id) },
                      ])
              }
            />
          ))}
        </ListSection>
      ) : null}

      <Members info={h} />
      {h.yourRole === "owner" ? <Invites info={h} /> : null}
    </Screen>
  );
}

type Info = Out<AppRouterClient["household"]["get"]>;

function NameCard({ name, owner }: { name: string; owner: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (n: string) => client.household.rename({ name: n }),
    onSuccess: () => {
      setEditing(null);
      toast.success("Household renamed");
      void refreshAll();
    },
    onError: fail("Couldn't rename"),
  });
  if (editing !== null) {
    return (
      <Card>
        <Field label="Household name" value={editing} maxLength={80} onChangeText={setEditing} autoFocus returnKeyType="done" onSubmitEditing={() => editing.trim() && save.mutate(editing.trim())} />
        <Row>
          <Button title="Save" flex loading={save.isPending} disabled={!editing.trim()} onPress={() => save.mutate(editing.trim())} />
          <Button title="Cancel" variant="ghost" onPress={() => setEditing(null)} />
        </Row>
      </Card>
    );
  }
  return (
    <Card>
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" tone="muted">Active household</Text>
          <Text variant="title">{name}</Text>
          <Text variant="caption" tone="muted">You are {owner ? "an owner" : "a member"}</Text>
        </View>
        {owner ? <Button title="Rename" variant="ghost" small icon="create-outline" onPress={() => setEditing(name)} /> : null}
      </Row>
    </Card>
  );
}

function Members({ info: h }: { info: Info }) {
  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: Role }) => client.household.members.setRole(v),
    onSuccess: () => {
      toast.success("Role changed");
      void refreshHousehold();
    },
    onError: fail("Couldn't change the role"),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => client.household.members.remove({ userId }),
    onSuccess: () => {
      toast.success("Member removed");
      void refreshHousehold();
    },
    onError: fail("Couldn't remove the member"),
  });
  const leave = useMutation({
    mutationFn: () => client.household.leave(),
    onSuccess: () => {
      toast.success(`You left ${h.household.name}`);
      void refreshAll();
    },
    onError: fail("Couldn't leave"),
  });

  const run = (m: Info["members"][number], a: MemberAction) => {
    if (a === "makeOwner") setRole.mutate({ userId: m.userId, role: "owner" });
    else if (a === "makeMember") setRole.mutate({ userId: m.userId, role: "member" });
    else if (a === "remove")
      Alert.alert(`Remove ${m.name}?`, `They lose access to ${h.household.name}. Their past entries stay.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => remove.mutate(m.userId) },
      ]);
    else
      Alert.alert(`Leave ${h.household.name}?`, "You lose access to its accounts and transactions.", [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => leave.mutate() },
      ]);
  };
  const busy = setRole.isPending || remove.isPending || leave.isPending;
  const owners = h.members.filter((m) => m.role === "owner").length;

  return (
    <ListSection
      title="Members"
      footer={h.yourRole === "owner" && owners === 1 && h.members.length > 1 ? "You are the only owner. To leave, make someone else an owner first." : "Tap a member to change their role or remove them."}
    >
      {h.members.map((m) => {
        const actions = memberActions(m, h.members, h.yourRole);
        return (
          <ListRow
            key={m.userId}
            left={<Avatar name={m.name} image={m.image} size={40} />}
            title={m.you ? `${m.name} (you)` : m.name}
            subtitle={`${m.email} · joined ${shortDate(m.joinedAt)}`}
            right={<Pill label={m.role} tone={m.role === "owner" ? "primary" : "muted"} />}
            chevron={actions.length > 0}
            accessibilityLabel={`${m.name}, ${m.role}${isLastOwner(m, h.members) ? ", the only owner" : ""}`}
            onPress={
              actions.length && !busy
                ? () =>
                    Alert.alert(m.name, m.email, [
                      ...actions.map((a) => ({ text: ACTION_LABEL[a], style: a === "remove" || a === "leave" ? ("destructive" as const) : ("default" as const), onPress: () => run(m, a) })),
                      { text: "Cancel", style: "cancel" as const },
                    ])
                : undefined
            }
          />
        );
      })}
    </ListSection>
  );
}

function Invites({ info: h }: { info: Info }) {
  const session = useSession();
  const hasSession = useHasSession();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const invite = useMutation({
    mutationFn: () => client.household.invites.create({ email: email.trim(), role }),
    onSuccess: () => {
      setEmail("");
      toast.success("Invite link created", "Send it now; it is not shown again.");
      void refreshHousehold();
    },
    onError: fail("Couldn't create the invite"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => client.household.invites.revoke({ id }),
    onSuccess: () => {
      toast.success("Invite revoked");
      void refreshHousehold();
    },
    onError: fail("Couldn't revoke the invite"),
  });
  const url = invite.data && session ? inviteUrl(session.server, invite.data.path) : null;

  const share = async () => {
    if (!url) return;
    try {
      await Share.share({ message: inviteMessage(h.household.name, url) });
    } catch {
      toast.error("Couldn't open the share sheet");
    }
  };

  return (
    <>
      <Card title="Invite someone" subtitle="They join with their own Google account and see this household's money">
        {!hasSession ? (
          <SessionOnlyNote />
        ) : (
          <>
            {url && invite.data ? (
              <Card tone="warning">
                <Row style={{ alignItems: "flex-start" }}>
                  <Icon name="link-outline" tone="warning" />
                  <Text variant="caption" style={{ flex: 1 }}>
                    Send this link to {invite.data.email}. It is not shown again and works for 14 days, only for that Google account.
                  </Text>
                </Row>
                <Text selectable variant="caption" tone="muted">{url}</Text>
                <Row>
                  <Button title="Share link" icon="share-outline" small flex onPress={() => void share()} />
                  <Button
                    title="Copy"
                    icon="copy-outline"
                    variant="outline"
                    small
                    onPress={() =>
                      void Clipboard.setStringAsync(url).then(
                        () => toast.success("Link copied"),
                        () => toast.error("Couldn't copy"),
                      )
                    }
                  />
                </Row>
              </Card>
            ) : null}
            <Field label="Their Google account email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="off" placeholder="name@gmail.com" />
            <FieldLabel label="Role" hint={role === "owner" ? "Owners can rename, invite and manage members." : "Members see and edit the finances."}>
              <Segmented<Role>
                label="Role"
                value={role}
                onChange={setRole}
                options={[
                  { value: "member", label: "Member" },
                  { value: "owner", label: "Owner" },
                ]}
              />
            </FieldLabel>
            <Button title="Create invite link" icon="person-add-outline" loading={invite.isPending} disabled={!looksLikeEmail(email)} onPress={() => invite.mutate()} />
          </>
        )}
      </Card>
      {h.pendingInvites.length ? (
        <ListSection title="Pending invites">
          {h.pendingInvites.map((i) => (
            <ListRow
              key={i.id}
              icon="mail-outline"
              iconTone="muted"
              title={i.email}
              subtitle={`Invited as ${i.role} · link expires ${shortDate(i.expiresAt)}`}
              right={
                <Button
                  title="Revoke"
                  variant="ghost"
                  small
                  accessibilityLabel={`Revoke the invite for ${i.email}`}
                  disabled={revoke.isPending}
                  onPress={() =>
                    Alert.alert("Revoke this invite?", `The link sent to ${i.email} stops working.`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Revoke", style: "destructive", onPress: () => revoke.mutate(i.id) },
                    ])
                  }
                />
              }
            />
          ))}
        </ListSection>
      ) : null}
    </>
  );
}
