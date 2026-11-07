import { Button } from "@baroka/ui/components/button";
import { Disclosure } from "@baroka/ui/components/disclosure";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { cn } from "@baroka/ui/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Info, Table2, Waypoints } from "lucide-react";
import { useState } from "react";

import { MoneyFlowChart, flowColors, pct } from "@/components/money-flow";
import type { FlowUnit, MoneyFlow } from "@/components/money-flow";
import { PageHeader } from "@/components/kit";
import { requireSession } from "@/lib/auth";
import { compactMoney, currentMonthWib, formatMoney, monthLabel, shiftMonth } from "@/lib/format";
import { errorMessage, orpc } from "@/lib/orpc";

export const Route = createFileRoute("/flow")({
  beforeLoad: requireSession,
  validateSearch: (raw: Record<string, unknown>): { month?: string } =>
    typeof raw.month === "string" && /^\d{4}-\d{2}$/.test(raw.month) ? { month: raw.month } : {},
  component: FlowPage,
});

function FlowPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/flow" });
  const thisMonth = currentMonthWib();
  const month = search.month ?? thisMonth;
  const go = (m: string) => void navigate({ search: m === thisMonth ? {} : { month: m } });
  const [unit, setUnit] = useState<FlowUnit>("amount");
  const q = useQuery({ ...orpc.reports.flow.queryOptions({ input: { month } }), placeholderData: keepPreviousData });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Money flow"
        subtitle="Where this month's money came from and where it went."
        action={
          <>
            <div className="inline-flex items-center rounded-full bg-muted p-1">
              <Button variant="ghost" size="icon-xs" className="hover:bg-card" aria-label="Previous month" onClick={() => go(shiftMonth(month, -1))}>
                <ChevronLeft />
              </Button>
              <span className="min-w-32 px-2 text-center text-sm font-bold">{monthLabel(month)}</span>
              <Button variant="ghost" size="icon-xs" className="hover:bg-card" aria-label="Next month" disabled={month >= thisMonth} onClick={() => go(shiftMonth(month, 1))}>
                <ChevronRight />
              </Button>
            </div>
            <UnitSwitch value={unit} onChange={setUnit} />
          </>
        }
      />
      {q.isError && <p className="rounded-2xl bg-destructive-soft px-4 py-3 text-sm text-destructive-ink">{errorMessage(q.error)}</p>}
      {q.isPending && (
        <div className="space-y-4" aria-busy aria-label="Loading">
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-20 rounded-3xl" />
            <Skeleton className="h-20 rounded-3xl" />
            <Skeleton className="h-20 rounded-3xl" />
          </div>
          <Skeleton className="h-[30rem] rounded-3xl" />
        </div>
      )}
      {q.data && (
        <div className={cn("space-y-4 transition-opacity", q.isPlaceholderData && "opacity-60")}>
          <Body flow={q.data} unit={unit} />
        </div>
      )}
    </div>
  );
}

function UnitSwitch({ value, onChange }: { value: FlowUnit; onChange: (u: FlowUnit) => void }) {
  return (
    <div role="radiogroup" aria-label="Show" className="inline-flex rounded-full bg-muted p-1">
      {(
        [
          ["amount", "Rp"],
          ["pct", "%"],
        ] as const
      ).map(([u, label]) => (
        <button
          key={u}
          type="button"
          role="radio"
          aria-checked={value === u}
          aria-label={u === "amount" ? "Amounts" : "Percent of money in"}
          onClick={() => onChange(u)}
          className={cn(
            "h-8 min-w-11 rounded-full px-3 text-sm font-bold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
            value === u ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, short, tone }: { label: string; value: string; short: string; tone?: "positive" | "warning" }) {
  return (
    <div className="card min-w-0 space-y-1 p-3.5 sm:p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={cn("truncate text-lg font-extrabold tracking-tight tabular-nums sm:text-xl", tone === "positive" && "text-positive-ink", tone === "warning" && "text-warning-ink")}>
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{value}</span>
      </p>
    </div>
  );
}

function Body({ flow, unit }: { flow: MoneyFlow; unit: FlowUnit }) {
  if (!flow.nodes.length) {
    return (
      <div className="card flex flex-col items-center gap-3 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary-ink">
          <Waypoints className="size-6" aria-hidden />
        </span>
        <p className="font-semibold">Nothing came in or went out in {monthLabel(flow.month)}.</p>
        <p className="max-w-sm text-sm text-muted-foreground">Import a statement to see where your money goes.</p>
        <Link to="/import" className="text-sm font-semibold text-primary hover:underline">
          Import a statement
        </Link>
      </div>
    );
  }
  const left = flow.saved.amount > 0;
  const short = (n: number) => `Rp ${compactMoney(n, flow.currency)}`;
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Money in" value={flow.income.display} short={short(flow.income.amount)} />
        <Stat label="Spent" value={flow.spending.display} short={short(flow.spending.amount)} />
        {left ? (
          <Stat label="Saved" value={flow.saved.display} short={short(flow.saved.amount)} tone="positive" />
        ) : (
          <Stat label="From savings" value={flow.fromSavings.display} short={short(flow.fromSavings.amount)} tone="warning" />
        )}
      </div>
      <section className="card overflow-x-auto p-4 sm:p-6">
        <MoneyFlowChart flow={flow} unit={unit} height={460} className="min-w-[22rem]" />
        <p className="mt-3 text-xs text-muted-foreground">Tap a category to see its transactions.</p>
      </section>
      <Disclosure id="what" icon={<Info />} title="What is Money flow?">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            The chart traces the month's money from where it came in, through your spending groups, to the categories you
            spent it on. The thicker a band, the more money went that way.
          </p>
          <p>
            Transfers between your own accounts, e-wallet top-ups and card payments are left out, and so are expenses your
            employer will pay back. When spending was more than income, the difference shows as <b>From savings</b>.
          </p>
        </div>
      </Disclosure>
      <Disclosure id="numbers" icon={<Table2 />} title="The numbers">
        <FlowTable flow={flow} />
      </Disclosure>
    </>
  );
}

function FlowTable({ flow }: { flow: MoneyFlow }) {
  const colors = flowColors(flow);
  const total = flow.nodes.find((n) => n.kind === "hub")?.amount ?? 0;
  const groups = flow.nodes.filter((n) => n.kind === "group" || n.kind === "saved");
  const sources = flow.nodes.filter((n) => n.kind === "source");
  const money = (n: number) => formatMoney(n, flow.currency);
  const row = "flex items-center justify-between gap-3 py-1.5";
  return (
    <div className="grid gap-6 text-sm md:grid-cols-2">
      <div>
        <h3 className="mb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">Came in</h3>
        {sources.map((s) => (
          <div key={s.id} className={row}>
            <span className="min-w-0 truncate">{s.label}</span>
            <span className="shrink-0 tabular-nums">
              {money(s.amount)} <span className="text-muted-foreground">{pct(s.amount, total)}</span>
            </span>
          </div>
        ))}
      </div>
      <div>
        <h3 className="mb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">Went to</h3>
        {groups.map((g) => (
          <div key={g.id} className="border-b border-border last:border-0">
            <div className={cn(row, "font-semibold")}>
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: colors.get(g.id) }} />
                <span className="truncate">{g.label}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {money(g.amount)} <span className="font-normal text-muted-foreground">{pct(g.amount, total)}</span>
              </span>
            </div>
            {flow.nodes
              .filter((n) => n.kind === "item" && n.group === g.id)
              .map((n) => (
                <div key={n.id} className={cn(row, "pl-4.5 text-muted-foreground")}>
                  <span className="min-w-0 truncate">{n.label}</span>
                  <span className="shrink-0 tabular-nums">{money(n.amount)}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
