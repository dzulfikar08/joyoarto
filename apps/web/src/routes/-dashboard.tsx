import type { AppRouterClient } from "@baroka/api/routers/index";
import { Button, buttonVariants } from "@baroka/ui/components/button";
import { Card as Surface, CardAction, CardDescription, CardHeader, CardTitle } from "@baroka/ui/components/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@baroka/ui/components/empty";
import { Input } from "@baroka/ui/components/input";
import { Combobox } from "@baroka/ui/components/combobox";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { cn } from "@baroka/ui/lib/utils";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import { toast } from "sonner";

import { CashflowChart, CumulativeChart, DonutChart, Legend, LineKey, SwatchKey } from "@/components/charts";
import { QuickAdd } from "@/components/quick-add";
import { currentMonthWib, formatMoney, monthLabel, rupiahToMinor, shiftMonth } from "@/lib/format";
import { categoryOptions } from "@/lib/options";
import { client, errorMessage, orpc } from "@/lib/orpc";

type Dashboard = Awaited<ReturnType<AppRouterClient["reports"]["dashboard"]>>;

// The signed-in home (route "/", defined in index.tsx). Loaded only for signed-in users, so visitors get the landing page fast.
const Route = getRouteApi("/");

export default function Home() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const thisMonth = currentMonthWib();
  const month = search.month ?? thisMonth;
  const q = useQuery({ ...orpc.reports.dashboard.queryOptions({ input: { month } }), placeholderData: keepPreviousData });
  const go = (m: string) => void navigate({ search: m === thisMonth ? {} : { month: m } });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-full bg-muted p-1">
          <Button variant="ghost" size="icon-xs" className="hover:bg-card" aria-label="Previous month" onClick={() => go(shiftMonth(month, -1))}>
            <ChevronLeft />
          </Button>
          <h1 className="min-w-36 px-2 text-center text-lg font-extrabold tracking-tight">{monthLabel(month)}</h1>
          <Button variant="ghost" size="icon-xs" className="hover:bg-card" aria-label="Next month" disabled={month >= thisMonth} onClick={() => go(shiftMonth(month, 1))}>
            <ChevronRight />
          </Button>
        </div>
        {month !== thisMonth && (
          <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => go(thisMonth)}>
            This month
          </button>
        )}
      </div>
      <QuickAdd collapsible />
      {q.isError && <p className="rounded-2xl bg-destructive-soft px-4 py-3 text-sm text-destructive-ink">{errorMessage(q.error)}</p>}
      {q.isPending && (
        <div className="space-y-4" aria-busy aria-label="Loading">
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-3xl" />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-72 rounded-3xl" />
            <Skeleton className="h-72 rounded-3xl" />
          </div>
        </div>
      )}
      {q.data && (
        <div className={`space-y-4 transition-opacity ${q.isPlaceholderData ? "opacity-60" : ""}`}>
          <Body d={q.data} onMonth={go} />
        </div>
      )}
    </div>
  );
}

function Body({ d, onMonth }: { d: Dashboard; onMonth: (m: string) => void }) {
  const range = { from: `${d.month}-01`, to: `${d.month}-${String(d.spendingByDay.length).padStart(2, "0")}` };
  const noData = !d.accounts.groups.length;
  if (noData) {
    return (
      <Surface>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyTitle>Welcome to JoyoArto</EmptyTitle>
            <EmptyDescription>Add an account and import a statement to see where your money goes.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Link to="/accounts" className={buttonVariants({ size: "sm" })}>
              Add an account
            </Link>
            <Link to="/import" className={buttonVariants({ size: "sm", variant: "secondary" })}>
              Import
            </Link>
          </EmptyContent>
        </Empty>
      </Surface>
    );
  }
  return (
    <>
      <Kpis d={d} />
      <div className="grid gap-4 md:grid-cols-2">
        <Categories d={d} range={range} />
        <Pace d={d} />
        <Cashflow d={d} onMonth={onMonth} />
        <Merchants d={d} range={range} />
        <Budgets d={d} />
        <Attention d={d} range={range} />
        <Accounts d={d} />
      </div>
    </>
  );
}

function Card({ title, sub, action, children, className = "" }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Surface className={cn("min-w-0 space-y-4", className)}>
      <CardHeader className="mb-4">
        <CardTitle>{title}</CardTitle>
        {sub && <CardDescription className="text-xs">{sub}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      {children}
    </Surface>
  );
}

function periodLabel(d: Dashboard) {
  const { from, to } = d.comparedTo;
  const prev = monthLabel(d.previousMonth, "short");
  const full = Number(to.slice(8)) === new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).getUTCDate();
  return full ? prev : `${prev} 1–${Number(to.slice(8))}`;
}

/** Signed change, coloured by whether that direction is good; arrow and sign carry it without colour. */
function Delta({ pct, points, upIsGood, vs }: { pct?: number | null; points?: number | null; upIsGood: boolean; vs: string }) {
  const v = pct ?? points ?? null;
  if (v === null || v === undefined) return <p className="text-xs text-muted-foreground">no comparison for {vs}</p>;
  const flat = Math.abs(v) < 0.5;
  const good = flat ? null : v > 0 === upIsGood;
  const color = good === null ? "text-muted-foreground" : good ? "text-[var(--viz-good-text)]" : "text-[var(--viz-bad-text)]";
  const text = points !== undefined ? `${v > 0 ? "+" : ""}${v} pts` : `${v > 0 ? "+" : ""}${Math.abs(v) >= 1000 ? ">999" : v}%`;
  return (
    <p className="text-xs">
      <span className={`font-medium tabular-nums ${color}`}>
        {flat ? "→" : v > 0 ? "▲" : "▼"} {flat ? "same" : text}
      </span>{" "}
      <span className="text-muted-foreground">vs {vs}</span>
    </p>
  );
}

function Kpis({ d }: { d: Dashboard }) {
  const vs = periodLabel(d);
  const k = d.kpis;
  const sr = k.savingsRate;
  const tiles: { label: string; value: string; hint?: string; delta: ReactNode }[] = [
    { label: "Income", value: k.income.display, delta: <Delta pct={k.income.changePct} upIsGood vs={vs} /> },
    { label: "Spending", value: k.spending.display, delta: <Delta pct={k.spending.changePct} upIsGood={false} vs={vs} /> },
    {
      label: "Net",
      value: k.net.display,
      delta: <Delta pct={k.net.changePct} upIsGood vs={vs} />,
    },
    {
      label: "Savings rate",
      value: sr.value === null ? "–" : `${sr.value}%`,
      hint:
        sr.note === "too-early"
          ? "Too early in the month: not enough income yet for a meaningful savings rate"
          : sr.note === "out-of-range"
            ? "Spending is more than twice the income so far, so the rate says little"
            : undefined,
      delta: sr.note ? (
        <p className="text-xs text-muted-foreground">{sr.note === "too-early" ? "too early in the month" : "spending far above income"}</p>
      ) : (
        <Delta points={sr.value !== null && sr.previous !== null ? Math.round((sr.value - sr.previous) * 10) / 10 : null} upIsGood vs={vs} />
      ),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <Surface key={t.label} className="min-w-0 space-y-1 p-3.5 sm:p-5">
          <p className="text-xs font-semibold text-muted-foreground">{t.label}</p>
          <p className="truncate text-lg font-extrabold tracking-tight tabular-nums sm:text-[1.375rem]" title={t.hint ?? t.value}>
            {t.value}
          </p>
          {t.delta}
        </Surface>
      ))}
    </div>
  );
}

const TOP_SLICES = 6;
const SLICE_COLORS = [1, 2, 3, 4, 5, 6].map((i) => `var(--viz-series-${i})`);
const OTHER = "__other";

type CategoryRow = Dashboard["categories"][number];

function changeText(c: { changePct: number | null; previousFullMonth: { amount: number } }) {
  if (c.changePct === null) return c.previousFullMonth.amount > 0 ? "–" : "new";
  return `${c.changePct > 0 ? "+" : ""}${Math.abs(c.changePct) >= 100 ? Math.round(c.changePct) : c.changePct}%`;
}

function Categories({ d, range }: { d: Dashboard; range: { from: string; to: string } }) {
  const navigate = useNavigate();
  const [active, setActive] = useState<string | null>(null);
  const [showRest, setShowRest] = useState(false);
  // Same comparison period as the KPI tiles ("Oct 1–4" early in November, "Oct" for a past month).
  const prev = periodLabel(d);
  const cats = d.categories;
  // The six biggest get the six chart colours; the rest fold into one neutral "Other" slice.
  const top = cats.slice(0, TOP_SLICES);
  const rest = cats.slice(top.length);
  const keyOf = (c: CategoryRow) => c.slug ?? "none";
  const searchOf = (c: CategoryRow) => (c.slug ? { category: c.slug, ...range } : { uncategorized: true as const, ...range });
  const other = rest.length
    ? (() => {
        const amount = rest.reduce((s, c) => s + c.amount, 0);
        const previous = rest.reduce((s, c) => s + c.previous.amount, 0);
        const previousFull = rest.reduce((s, c) => s + c.previousFullMonth.amount, 0);
        return {
          amount,
          display: formatMoney(amount, d.currency),
          share: Math.round(rest.reduce((s, c) => s + c.share, 0) * 10) / 10,
          previous: { amount: previous, display: formatMoney(previous, d.currency) },
          previousFullMonth: { amount: previousFull },
          changePct: previous > 0 ? Math.round(((amount - previous) / previous) * 1000) / 10 : null,
        };
      })()
    : null;
  const color = (i: number) => SLICE_COLORS[i] ?? "var(--viz-previous)";
  const slices = [
    ...top.map((c, i) => ({ key: keyOf(c), label: c.name, value: c.amount, display: c.display, share: c.share, color: color(i) })),
    ...(other ? [{ key: OTHER, label: "Other", value: other.amount, display: other.display, share: other.share, color: "var(--viz-previous)" }] : []),
  ];
  const summary = `Spending by category, ${monthLabel(d.month)}: ${d.kpis.spending.display} in total. ${slices.map((s) => `${s.label} ${s.display} (${s.share}%)`).join(", ")}.`;
  const title = (c: { share: number; changePct: number | null; previous: { display: string } }) =>
    `${c.share}% of spending; ${c.changePct === null ? `nothing in ${prev}` : `${c.changePct > 0 ? "+" : ""}${c.changePct}% vs ${prev} (${c.previous.display})`}`;

  const row = (name: string, swatch: string | null, c: { display: string; share: number; changePct: number | null; previous: { display: string }; previousFullMonth: { amount: number } }) => (
    <>
      <span className="flex items-center gap-2 text-sm">
        {swatch ? <SwatchKey color={swatch} /> : <span aria-hidden className="size-2.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 font-semibold tabular-nums">{c.display}</span>
      </span>
      <span className="flex justify-between gap-2 pl-[1.125rem] text-[11px] tabular-nums text-muted-foreground" title={title(c)}>
        <span>{c.share}%</span>
        <span>
          {changeText(c)} <span className="text-muted-foreground/80">vs {prev}</span>
        </span>
      </span>
    </>
  );
  const rowClass = (key: string) => cn("block w-full rounded-xl px-2 py-1.5 text-left hover:bg-muted", active === key && "bg-muted");
  const hover = (key: string) => ({ onPointerEnter: () => setActive(key), onPointerLeave: () => setActive(null), onFocus: () => setActive(key), onBlur: () => setActive(null) });

  return (
    <Card title="Spending by category" sub={`${d.kpis.spending.display} · share · change vs ${prev}`}>
      {!cats.length && <p className="text-sm text-muted-foreground">No spending this month.</p>}
      {cats.length > 0 && (
        <div className="@container">
          <div className="flex flex-col items-center gap-4 @md:flex-row @md:items-start">
            <DonutChart
              slices={slices}
              centerLabel="Spending"
              centerValue={d.kpis.spending.display}
              label={summary}
              active={active}
              onActive={setActive}
              onSelect={(key) => {
                if (key === OTHER) return setShowRest(true);
                const c = top.find((x) => keyOf(x) === key);
                if (c) void navigate({ to: "/transactions", search: searchOf(c) });
              }}
            />
            <ul className="w-full min-w-0 flex-1 space-y-0.5">
              {top.map((c, i) => (
                <li key={keyOf(c)}>
                  <Link to="/transactions" search={searchOf(c)} className={rowClass(keyOf(c))} {...hover(keyOf(c))}>
                    {row(c.name, color(i), c)}
                  </Link>
                </li>
              ))}
              {other && (
                <li>
                  <button type="button" className={rowClass(OTHER)} aria-expanded={showRest} onClick={() => setShowRest(!showRest)} {...hover(OTHER)}>
                    {row(`Other (${rest.length})`, "var(--viz-previous)", other)}
                  </button>
                  {showRest && (
                    <ul className="ml-4 border-l border-border pl-1">
                      {rest.map((c) => (
                        <li key={keyOf(c)}>
                          <Link to="/transactions" search={searchOf(c)} className={rowClass(keyOf(c))}>
                            {row(c.name, null, c)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}

function Pace({ d }: { d: Dashboard }) {
  const cur = monthLabel(d.month, "short");
  const prev = monthLabel(d.previousMonth, "short");
  const points = d.spendingByDay.map((p) => ({
    day: p.day,
    current: p.current?.amount ?? null,
    currentDisplay: p.current?.display ?? null,
    previous: p.previous.amount,
    previousDisplay: p.previous.display,
  }));
  const today = d.isCurrentMonth ? Number(d.today.slice(8)) : points.length;
  const at = points[Math.min(today, points.length) - 1];
  let sub = `Running total by day of month`;
  if (at?.current != null && d.isCurrentMonth) {
    const diff = at.current - at.previous;
    sub = `Day ${at.day}: ${at.currentDisplay}, ${diff === 0 ? "same as" : diff > 0 ? "more than" : "less than"} ${prev}'s ${at.previousDisplay} by this day`;
  }
  return (
    <Card title="Spending pace" sub={sub}>
      <Legend
        items={[
          { key: <LineKey color="var(--viz-series-1)" />, label: d.isCurrentMonth ? `${cur} (so far)` : cur },
          { key: <LineKey color="var(--viz-previous)" dashed />, label: prev },
        ]}
      />
      <CumulativeChart points={points} currentLabel={monthLabel(d.month)} previousLabel={monthLabel(d.previousMonth)} monthShort={cur} prevShort={prev} />
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Table</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-normal">Day</th>
              <th className="text-right font-normal">{cur}</th>
              <th className="text-right font-normal">{prev}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day}>
                <td>{p.day}</td>
                <td className="text-right">{p.currentDisplay ?? "–"}</td>
                <td className="text-right">{p.previousDisplay}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

function Cashflow({ d, onMonth }: { d: Dashboard; onMonth: (m: string) => void }) {
  const months = d.cashflow.map((m) => ({
    month: m.month,
    label: monthLabel(m.month, "short"),
    income: m.income.amount,
    expense: m.expense.amount,
    incomeDisplay: m.income.display,
    expenseDisplay: m.expense.display,
    netDisplay: m.net.display,
    savingsRate: m.savingsRate,
  }));
  return (
    <Card title="Cashflow" sub="Income and spending, last 6 months · tap a month to open it">
      <Legend
        items={[
          { key: <SwatchKey color="var(--viz-series-1)" />, label: "Income" },
          { key: <SwatchKey color="var(--viz-series-2)" />, label: "Spending" },
        ]}
      />
      <CashflowChart months={months} selected={d.month} onSelect={onMonth} />
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Table</summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full tabular-nums">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-normal">Month</th>
                <th className="text-right font-normal">Income</th>
                <th className="text-right font-normal">Spending</th>
                <th className="text-right font-normal">Net</th>
              </tr>
            </thead>
            <tbody>
              {d.cashflow.map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month, "short")}</td>
                  <td className="text-right">{m.income.display}</td>
                  <td className="text-right">{m.expense.display}</td>
                  <td className="text-right">{m.net.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function Merchants({ d, range }: { d: Dashboard; range: { from: string; to: string } }) {
  return (
    <Card title="Top merchants" sub="Where the most money went this month">
      {!d.merchants.length && <p className="text-sm text-muted-foreground">No spending this month.</p>}
      <ol className="divide-y divide-border">
        {d.merchants.map((m, i) => (
          <li key={m.name}>
            <Link
              to="/transactions"
              search={{ q: m.name.slice(0, 40), ...range }}
              className="flex items-baseline gap-2 rounded-xl px-2 py-2 text-sm hover:bg-muted"
            >
              <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground/70">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{m.count}×</span>
              <span className="w-28 shrink-0 text-right font-semibold tabular-nums">{m.display}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

const STATUS = {
  over: { icon: "✕", label: "Over", fill: "var(--viz-critical)" },
  ahead_of_pace: { icon: "!", label: "Ahead of pace", fill: "var(--viz-warning)" },
  on_track: { icon: "✓", label: "On track", fill: "var(--viz-series-1)" },
} as const;

function Budgets({ d }: { d: Dashboard }) {
  const [editing, setEditing] = useState(false);
  const items = d.budgets.items;
  return (
    <Card
      title="Budgets"
      sub={items.length ? `${d.budgets.total.spent} of ${d.budgets.total.budget}` : undefined}
      action={
        <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setEditing(!editing)}>
          {editing ? "Done" : items.length ? "Edit" : "Set budgets"}
        </button>
      }
    >
      {!items.length && !editing && <p className="text-sm text-muted-foreground">No budgets yet. Set a monthly limit per category to track your pace.</p>}
      <ul className="space-y-2.5">
        {items.map((b) => {
          const s = STATUS[b.status as keyof typeof STATUS] ?? STATUS.on_track;
          return (
            <li key={b.category} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">{b.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  <span className="font-medium text-foreground">{b.spent.display}</span> / {b.budget.display}
                </span>
              </div>
              <div
                className="relative h-2 rounded-full"
                style={{ background: "var(--viz-series-1-track)" }}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, b.usedPct)}
                aria-label={`${b.name}: ${b.usedPct}% used`}
              >
                <div className="h-2 rounded-full" style={{ width: `${Math.min(100, b.usedPct)}%`, background: s.fill }} />
                {d.isCurrentMonth && b.pacePct > 0 && b.pacePct < 100 && (
                  <div className="absolute -top-0.5 h-3 w-0.5 rounded bg-foreground" style={{ left: `${b.pacePct}%` }} title="Even pace for today" />
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                <span aria-hidden>{s.icon}</span> {s.label} · {b.usedPct}% used · {b.status === "over" ? `${b.remaining.display.replace("-", "")} over` : `${b.remaining.display} left`}
              </p>
            </li>
          );
        })}
      </ul>
      {d.isCurrentMonth && items.length > 0 && <p className="text-[11px] text-muted-foreground">The tick marks an even pace for today.</p>}
      {editing && <BudgetForm />}
    </Card>
  );
}

function BudgetForm() {
  const qc = useQueryClient();
  const cats = useQuery(orpc.categories.list.queryOptions());
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const save = useMutation({
    mutationFn: () => client.budgets.set({ category, amount: rupiahToMinor(amount) }),
    onSuccess: () => {
      toast.success(rupiahToMinor(amount) === 0 ? "Budget removed" : "Budget saved");
      setAmount("");
      void qc.invalidateQueries({ queryKey: orpc.reports.key() });
      void qc.invalidateQueries({ queryKey: orpc.budgets.key() });
    },
    onError: (err) => toast.error("Couldn't save the budget", { description: errorMessage(err) }),
  });
  const expense = useMemo(() => categoryOptions((cats.data?.categories ?? []).filter((c) => c.kind === "expense")), [cats.data]);
  return (
    <form
      className="flex flex-wrap gap-2 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (category && amount) save.mutate();
      }}
    >
      <Combobox
        size="sm"
        className="min-w-40 flex-1"
        value={category}
        onValueChange={setCategory}
        aria-label="Category"
        placeholder="Category…"
        items={expense}
        searchPlaceholder="Search categories"
      />
      <Input className="h-10 w-32 rounded-xl px-3 sm:text-sm" inputMode="numeric" placeholder="Rp per month" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Monthly limit in rupiah" />
      <Button type="submit" size="sm" disabled={!category || !amount || save.isPending}>
        Save
      </Button>
      <p className="w-full text-[11px] text-muted-foreground">Enter 0 to remove a budget.</p>
    </form>
  );
}

function Attention({ d, range }: { d: Dashboard; range: { from: string; to: string } }) {
  const a = d.attention;
  const items: ReactNode[] = [];
  if (a.uncategorizedThisMonth > 0)
    items.push(
      <Link key="unc" to="/transactions" search={{ uncategorized: true, ...range }} className="hover:underline">
        <b className="tabular-nums">{a.uncategorizedThisMonth}</b> uncategorized transaction{a.uncategorizedThisMonth === 1 ? "" : "s"} in {monthLabel(d.month, "short")}
      </Link>,
    );
  if (a.uncategorizedAll > a.uncategorizedThisMonth)
    items.push(
      <Link key="unc-all" to="/transactions" search={{ uncategorized: true }} className="hover:underline">
        <b className="tabular-nums">{a.uncategorizedAll}</b> uncategorized in total
      </Link>,
    );
  if (a.pendingStale > 0) {
    const cutoff = new Date(Date.parse(`${d.today}T00:00:00Z`) - (a.pendingStaleDays + 1) * 86_400_000).toISOString().slice(0, 10);
    items.push(
      <Link key="pending" to="/transactions" search={{ status: "pending", to: cutoff }} className="hover:underline">
        <b className="tabular-nums">{a.pendingStale}</b> pending quick add{a.pendingStale === 1 ? "" : "s"} older than {a.pendingStaleDays} days: no statement confirmed{" "}
        {a.pendingStale === 1 ? "it" : "them"}. Import the statement, or fix or delete {a.pendingStale === 1 ? "it" : "them"}
      </Link>,
    );
  }
  for (const s of a.staleAccounts)
    items.push(
      s.lastDate ? (
        <Link key={s.id} to="/transactions" search={{ accountId: s.id }} className="hover:underline">
          <b>{s.name}</b>: nothing recorded for {s.daysSince} days (last {s.lastDate}). Import a newer statement?
        </Link>
      ) : (
        <Link key={s.id} to="/import" className="hover:underline">
          <b>{s.name}</b>: no transactions yet. Import a statement
        </Link>
      ),
    );
  return (
    <Card title="Needs attention">
      {items.length ? (
        <ul className="space-y-2 text-sm">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: "var(--viz-warning)" }} />
              <span className="min-w-0">{it}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-positive-ink">✓ All caught up: everything is categorized and every account is current.</p>
      )}
    </Card>
  );
}

function Accounts({ d }: { d: Dashboard }) {
  return (
    <Card
      title="Balances"
      sub="Opening balance plus recorded transactions, today"
      action={<span className="text-base font-extrabold tracking-tight tabular-nums">{d.accounts.total.display}</span>}
      className="md:col-span-2"
    >
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {d.accounts.groups.map((g) => (
          <div key={g.type}>
            <div className="flex items-baseline justify-between border-b border-border pb-1.5 text-xs font-semibold text-muted-foreground">
              <span>{g.label}</span>
              <span className="tabular-nums">{g.total.display}</span>
            </div>
            <ul>
              {g.accounts.map((a) => (
                <li key={a.id}>
                  <Link to="/transactions" search={{ accountId: a.id }} className="flex items-baseline justify-between gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-muted">
                    <span className="min-w-0 truncate">{a.name}</span>
                    <span className="shrink-0 tabular-nums">{a.balance.display}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
