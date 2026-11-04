import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@baroka/ui/components/badge";
import { Button, buttonVariants } from "@baroka/ui/components/button";
import { Card } from "@baroka/ui/components/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@baroka/ui/components/empty";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Link2Off, TriangleAlert, Users } from "lucide-react";
import { toast } from "sonner";

import { requireSession } from "@/lib/auth";
import { authClient } from "@/lib/auth-client";
import { client, errorMessage, orpc } from "@/lib/orpc";

export const Route = createFileRoute("/join/$token")({ beforeLoad: requireSession, component: Join });

/** Opened from an invite link: shows whose household it is, then joins it. */
function Join() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const invite = useQuery(orpc.household.invites.preview.queryOptions({ input: { token } }));
  const accept = useMutation({
    mutationFn: () => client.household.invites.accept({ token }),
    onSuccess: async () => {
      toast.success(`You joined ${invite.data?.household ?? "the household"}.`);
      await qc.invalidateQueries();
      await navigate({ to: "/" });
    },
  });
  const switchAccount = async () => {
    await authClient.signOut();
    qc.clear();
    location.assign(`/login?redirect=${encodeURIComponent(`/join/${token}`)}`);
  };

  const i = invite.data;
  return (
    <div className="mx-auto max-w-md pt-2 sm:pt-8">
      <Card className="space-y-4 sm:p-6">
        {invite.isPending && (
          <div aria-label="Loading invite…" className="space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-40 rounded-full" />
          </div>
        )}
        {invite.isError &&
          (["NOT_FOUND", "BAD_REQUEST"].includes((invite.error as { code?: string }).code ?? "") ? (
            <Empty className="p-2 md:p-4">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Link2Off />
                </EmptyMedia>
                <EmptyTitle>
                  <h1>This invite link doesn't work</h1>
                </EmptyTitle>
                <EmptyDescription>Check that you opened the whole link, or ask the person who invited you for a new one.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Link to="/" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  Go to your dashboard
                </Link>
              </EmptyContent>
            </Empty>
          ) : (
            <Empty className="p-2 md:p-4">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="bg-destructive-soft text-destructive-ink">
                  <TriangleAlert />
                </EmptyMedia>
                <EmptyTitle>
                  <h1>Couldn't load the invite</h1>
                </EmptyTitle>
                <EmptyDescription>{errorMessage(invite.error)}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="secondary" size="sm" onClick={() => void invite.refetch()}>
                  Try again
                </Button>
              </EmptyContent>
            </Empty>
          ))}
        {i && (
          <>
            <div>
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-ink">
                  <Users className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <Badge tone="primary">Household invite</Badge>
                  <h1 className="mt-1 truncate text-xl font-extrabold tracking-tight">{i.household}</h1>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">

                {i.invitedBy ?? "An owner"} invited {i.email} as {i.role === "owner" ? "an owner" : "a member"}.
              </p>
            </div>
            {i.alreadyMember && i.status !== "pending" ? (
              <div className="space-y-3 text-sm">
                <p>You are already a member of this household.</p>
                <Link to="/settings" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  Open Settings to switch to it
                </Link>
              </div>
            ) : i.status === "accepted" ? (
              <p className="rounded-2xl bg-destructive-soft p-3 text-sm text-destructive-ink">This invite was already used.</p>
            ) : i.status === "expired" ? (
              <p className="rounded-2xl bg-destructive-soft p-3 text-sm text-destructive-ink">This invite has expired. Ask {i.invitedBy ?? "the owner"} for a new link.</p>
            ) : !i.emailMatches ? (
              <div className="space-y-3 text-sm">
                <p className="rounded-2xl bg-warning-soft p-3 text-warning-ink">
                  This invite is for <b>{i.email}</b>, but you are signed in as <b>{i.signedInAs}</b>.
                </p>
                <Button variant="secondary" size="sm" onClick={() => void switchAccount()}>
                  Sign in as {i.email}
                </Button>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <p>You will see and edit this household's accounts and transactions, and it becomes your active household (you can switch back in Settings).</p>
                <Button className="w-full sm:w-auto" disabled={accept.isPending} onClick={() => accept.mutate()}>
                  {accept.isPending ? "Joining…" : `Join ${i.household}`}
                </Button>
                {accept.isError && (
                  <p role="alert" className="text-destructive">
                    {errorMessage(accept.error)}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
