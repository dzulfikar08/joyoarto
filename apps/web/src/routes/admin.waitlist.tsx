import { useQuery } from "@tanstack/react-query";
import { Badge } from "@baroka/ui/components/badge";
import { Card } from "@baroka/ui/components/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@baroka/ui/components/empty";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { createFileRoute } from "@tanstack/react-router";
import { Inbox } from "lucide-react";

import { PageHeader } from "@/components/kit";

import { requireSession } from "@/lib/auth";
import { errorMessage, orpc } from "@/lib/orpc";

/** Operators only (ADMIN_EMAILS on the server); everyone else gets a "forbidden" message. */
export const Route = createFileRoute("/admin/waitlist")({ beforeLoad: requireSession, component: WaitlistAdmin });

function WaitlistAdmin() {
  const q = useQuery(orpc.waitlist.list.queryOptions({ input: { limit: 500 } }));
  return (
    <div className="space-y-4">
      <PageHeader title="Waitlist" subtitle="Hosted JoyoArto sign-ups, newest first." />
      {q.isPending && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <Skeleton className="h-24 w-32 rounded-3xl" />
            <Skeleton className="h-24 flex-1 rounded-3xl" />
          </div>
          <Skeleton className="h-64 rounded-3xl" />
        </div>
      )}
      {q.isError && <p className="rounded-2xl bg-destructive-soft p-3 text-sm text-destructive-ink">{errorMessage(q.error)}</p>}
      {q.data && (
        <>
          <div className="flex flex-wrap gap-3">
            <Card className="min-w-32">
              <p className="label">Sign-ups</p>
              <p className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums">{q.data.count}</p>
            </Card>
            <Card className="flex-1">
              <p className="label">Banks</p>
              <p className="mt-2 flex flex-wrap gap-1.5 text-sm">
                {q.data.banks.length === 0 && <span className="text-muted-foreground">None yet</span>}
                {q.data.banks.map((b) => (
                  <Badge key={b.bank} tone="primary" className="text-sm">
                    {b.bank} <span className="tabular-nums opacity-70">{b.count}</span>
                  </Badge>
                ))}
              </p>
            </Card>
          </div>
          {q.data.signups.length === 0 ? (
            <Card>
              <Empty className="p-4 md:p-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Inbox />
                  </EmptyMedia>
                  <EmptyTitle>No sign-ups yet</EmptyTitle>
                  <EmptyDescription>People who join from the landing page or the demo show up here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </Card>
          ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-left text-xs font-semibold text-muted-foreground">
                <tr>
                  <th className="py-1.5">Email</th>
                  <th>Name</th>
                  <th>Banks</th>
                  <th>Source</th>
                  <th>Lang</th>
                  <th className="text-right">Joined</th>
                </tr>
              </thead>
              <tbody>
                {q.data.signups.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="py-1.5">{s.email}</td>
                    <td>{s.name ?? ""}</td>
                    <td>{s.banks.join(", ")}</td>
                    <td title={s.utm ? JSON.stringify(s.utm) : undefined}>{s.source ?? ""}</td>
                    <td>{s.locale ?? ""}</td>
                    <td className="text-right tabular-nums">{new Date(s.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {q.data.signups.length < q.data.count && <p className="mt-2 text-xs text-muted-foreground">Showing the newest {q.data.signups.length}.</p>}
          </Card>
          )}
        </>
      )}
    </div>
  );
}
