import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@baroka/ui/components/button";
import { Input } from "@baroka/ui/components/input";
import { Select } from "@baroka/ui/components/select";

import { Avatar } from "@/components/avatar";
import { client, errorMessage, orpc } from "@/lib/orpc";

const ROLE_ITEMS = [
  { value: "owner", label: "owner" },
  { value: "member", label: "member" },
];
const INVITE_ROLE_ITEMS = [ROLE_ITEMS[1]!, ROLE_ITEMS[0]!];

const date = (d: Date | string) => new Date(d).toLocaleDateString();

/** Settings: switch household, rename it, members and invites. */
export function HouseholdSettings() {
  const qc = useQueryClient();
  const info = useQuery(orpc.household.get.queryOptions());
  const mine = useQuery(orpc.household.list.queryOptions());
  const refresh = () => qc.invalidateQueries({ queryKey: orpc.household.key() });
  /** Everything else (transactions, accounts, me) belongs to the active household too. */
  const refreshAll = () => qc.invalidateQueries();

  const [rename, setRename] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "owner">("member");
  const [copied, setCopied] = useState(false);

  const switchTo = useMutation({
    mutationFn: (householdId: string) => client.household.switch({ householdId }),
    onSuccess: () => {
      toast.success("Switched household");
      void refreshAll();
    },
  });
  const save = useMutation({
    mutationFn: (name: string) => client.household.rename({ name }),
    onSuccess: () => {
      setRename(null);
      toast.success("Household renamed");
      void refreshAll();
    },
  });
  const invite = useMutation({
    mutationFn: () => client.household.invites.create({ email: email.trim(), role: inviteRole }),
    onSuccess: () => {
      setEmail("");
      setCopied(false);
      toast.success("Invite link created. Send it now; it is not shown again.");
      void refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => client.household.invites.revoke({ id }),
    onSuccess: () => {
      toast.success("Invite revoked");
      void refresh();
    },
  });
  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: "owner" | "member" }) => client.household.members.setRole(v),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => client.household.members.remove({ userId }),
    onSuccess: () => {
      toast.success("Member removed");
      void refresh();
    },
  });
  const leave = useMutation({ mutationFn: () => client.household.leave(), onSuccess: refreshAll });

  const h = info.data;
  if (!h) return null;
  const owner = h.yourRole === "owner";
  const error = [switchTo, save, invite, revoke, setRole, remove, leave].find((m) => m.isError)?.error;
  const inviteUrl = invite.data ? `${location.origin}${invite.data.path}` : null;

  const owners = h.members.filter((m) => m.role === "owner").length;
  /** The server keeps at least one owner; say so up front instead of failing after a confirm. */
  const lastOwner = (m: (typeof h.members)[number]) => m.role === "owner" && owners === 1;

  return (
    <section className="card space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold tracking-tight">Household</h2>
        {mine.data && mine.data.households.length > 1 && (
          <label className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground sm:w-auto">
            <span className="shrink-0">Active</span>
            <Select
              size="sm"
              className="flex-1 sm:min-w-44"
              aria-label="Active household"
              value={h.household.id}
              disabled={switchTo.isPending}
              onValueChange={(v) => switchTo.mutate(v)}
              items={mine.data.households.map((x) => ({ value: x.id, label: x.name }))}
            />
          </label>
        )}
      </div>

      {rename === null ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold break-words">{h.household.name}</div>
            <div className="text-xs text-muted-foreground">You are {h.yourRole === "owner" ? "an owner" : "a member"}</div>
          </div>
          {owner && (
            <button type="button" className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft" onClick={() => setRename(h.household.name)}>
              Rename
            </button>
          )}
        </div>
      ) : (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (rename.trim()) save.mutate(rename.trim());
          }}
        >
          <Input className="h-10 flex-1 basis-48 px-3 sm:text-sm" aria-label="Household name" value={rename} maxLength={80} onChange={(e) => setRename(e.target.value)} autoFocus />
          <Button type="submit" size="sm" disabled={save.isPending || !rename.trim()}>
            Save
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setRename(null)}>
            Cancel
          </Button>
        </form>
      )}

      <div>
        <div className="label mb-1">Members</div>
        <ul className="divide-y divide-border">
          {h.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <Avatar name={m.name} image={m.image} />
              <div className="min-w-0 flex-1 basis-48">
                <div className="font-semibold">
                  {m.name}
                  {m.you && <span className="font-normal text-muted-foreground"> (you)</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground" title={m.email}>
                  {m.email} · joined {date(m.joinedAt)}
                </div>
              </div>
              <span className="flex items-center gap-3">
                {owner ? (
                  <Select
                    size="xs"
                    className="w-26"
                    aria-label={`Role of ${m.name}`}
                    value={m.role}
                    disabled={setRole.isPending || lastOwner(m)}
                    title={lastOwner(m) ? "The only owner; make someone else an owner first" : undefined}
                    onValueChange={(v) =>
                      setRole.mutate({
                        userId: m.userId,
                        role: v as "owner" | "member",
                      })
                    }
                    items={ROLE_ITEMS}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">{m.role}</span>
                )}
                {m.you ? (
                  h.members.length > 1 && (
                    <button
                      type="button"
                      className="rounded-full px-2.5 py-1 text-xs font-semibold text-destructive hover:bg-destructive-soft disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted-foreground"
                      disabled={lastOwner(m) || leave.isPending}
                      title={lastOwner(m) ? "You are the only owner; make someone else an owner before leaving" : undefined}
                      onClick={() => confirm(`Leave ${h.household.name}? You lose access to its accounts and transactions.`) && leave.mutate()}
                    >
                      Leave
                    </button>
                  )
                ) : (
                  owner && (
                    <button
                      type="button"
                      className="rounded-full px-2.5 py-1 text-xs font-semibold text-destructive hover:bg-destructive-soft disabled:bg-transparent disabled:text-muted-foreground"
                      disabled={lastOwner(m) || remove.isPending}
                      onClick={() => confirm(`Remove ${m.name} from ${h.household.name}?`) && remove.mutate(m.userId)}
                    >
                      Remove
                    </button>
                  )
                )}
              </span>
            </li>
          ))}
        </ul>
        {h.members.length > 1 && owners === 1 && owner && (
          <p className="mt-1 text-xs text-muted-foreground">You are the only owner. To leave, make someone else an owner first.</p>
        )}
      </div>

      {owner && (
        <div className="space-y-2">
          <div className="label">Invite someone</div>
          {inviteUrl && (
            <div className="space-y-1 rounded-2xl bg-warning-soft p-3 text-warning-ink">
              <div>Send this link to {invite.data?.email}; it is not shown again and works for 14 days, only for that Google account:</div>
              <code className="block font-mono text-xs break-all text-foreground">{inviteUrl}</code>
              <Button
                size="xs"
                variant="secondary"
                className="mt-1 bg-card"
                onClick={() =>
                  void navigator.clipboard.writeText(inviteUrl).then(
                    () => {
                      setCopied(true);
                      toast.success("Link copied");
                    },
                    () => window.prompt("Copy this link", inviteUrl),
                  )
                }
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          )}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) invite.mutate();
            }}
          >
            <Input
              className="h-10 flex-1 basis-full px-3 sm:basis-56 sm:text-sm"
              type="email"
              autoComplete="off"
              aria-label="Email to invite"
              placeholder="Their Google account email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Select size="sm" className="w-32" aria-label="Role" value={inviteRole} onValueChange={(v) => setInviteRole(v as "member" | "owner")} items={INVITE_ROLE_ITEMS} />
            <Button type="submit" size="sm" disabled={invite.isPending || !email.trim()}>
              {invite.isPending ? "Creating…" : "Create invite link"}
            </Button>
          </form>
          {h.pendingInvites.length > 0 && (
            <ul className="divide-y divide-border">
              {h.pendingInvites.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate" title={i.email}>
                      {i.email}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Invited as {i.role} · link expires {date(i.expiresAt)}
                    </div>
                  </div>
                  <button type="button" className="ml-auto rounded-full px-2.5 py-1 text-xs font-semibold text-destructive hover:bg-destructive-soft" disabled={revoke.isPending} onClick={() => revoke.mutate(i.id)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-destructive">{errorMessage(error)}</p>}
    </section>
  );
}
