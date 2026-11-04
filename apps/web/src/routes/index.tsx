import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { Suspense, lazy } from "react";

import { sessionQuery } from "@/lib/auth";
import { queryClient } from "@/lib/orpc";

import { Landing } from "./-landing";

// Signed-in users get the monthly dashboard; everyone else the public landing page. The dashboard (and its charts) is
// a separate chunk, so visitors do not download it.
const Dashboard = lazy(() => import("./-dashboard"));

export const Route = createFileRoute("/")({
  beforeLoad: async () => ({ session: await queryClient.ensureQueryData(sessionQuery) }),
  validateSearch: (raw: Record<string, unknown>): { month?: string } =>
    typeof raw.month === "string" && /^\d{4}-\d{2}$/.test(raw.month) ? { month: raw.month } : {},
  component: Home,
});

function Home() {
  const { data: session } = useQuery(sessionQuery);
  if (!session) return <Landing />;
  return (
    <Suspense
      fallback={
        <div aria-label="Loading…" className="space-y-4">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-40 rounded-3xl" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Skeleton className="h-24 rounded-3xl" />
            <Skeleton className="h-24 rounded-3xl" />
            <Skeleton className="h-24 rounded-3xl" />
            <Skeleton className="h-24 rounded-3xl" />
          </div>
        </div>
      }
    >
      <Dashboard />
    </Suspense>
  );
}
