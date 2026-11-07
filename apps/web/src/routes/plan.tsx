import type { AppRouterClient } from "@baroka/api/routers/index";
import type { AccountRole, ScenarioItemInput } from "@baroka/api/lib/plan/schema";
import { defaultResalePct } from "@baroka/api/lib/plan/resale";
import { babyTemplate, carTemplate } from "@baroka/api/lib/plan/templates";
import { Button } from "@baroka/ui/components/button";
import { Disclosure } from "@baroka/ui/components/disclosure";
import { Checkbox } from "@baroka/ui/components/checkbox";
import { Input } from "@baroka/ui/components/input";
import { Combobox } from "@baroka/ui/components/combobox";
import { Select, type SelectBaseProps } from "@baroka/ui/components/select";
import { cn } from "@baroka/ui/lib/utils";
import { useMediaQuery } from "@baroka/ui/hooks/use-media-query";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bookmark, ChevronDown, PiggyBank, Plus, Share2, Sparkles, X } from "lucide-react";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Field as KitField, PageHeader } from "@/components/kit";
import { Legend, LineKey, ProjectionChart } from "@/components/charts";
import { JoyoPanel } from "@/components/joyo/joyo-panel";
import type { PlanEvent } from "@/components/joyo/use-joyo-chat";
import { SavingsBlock } from "@/components/savings";
import { requireSession } from "@/lib/auth";
import { useLang } from "@/lib/lang";
import { currentMonthWib, formatMoney, monthLabel, shiftMonth } from "@/lib/format";
import { client, errorMessage, orpc } from "@/lib/orpc";
import {
  EMPTY,
  applyCuts,
  babyBlock,
  carBlock,
  decodeShare,
  encodeShare,
  flatten,
  addSharedScenarios,
  applyJoyoPlan,
  blocksFromSaved,
  freeSlot,
  hasContent,
  isDirty,
  loadLocal,
  planPageState,
  quickStart,
  saveLocal,
  shiftBaby,
  signature,
  uid,
  upgradeBlocks,
} from "@/lib/plan-state";
import type { Block, CutIn, LoanIn, PlainIn, PlanState, Scenario } from "@/lib/plan-state";

type Baseline = Awaited<ReturnType<AppRouterClient["plan"]["baseline"]>>;
type Compare = Awaited<ReturnType<AppRouterClient["plan"]["compare"]>>;
type CompareScenario = Compare["scenarios"][number];
type SavedList = Awaited<ReturnType<AppRouterClient["plan"]["scenarios"]["list"]>>;
type SavedPlanIn = Parameters<AppRouterClient["plan"]["scenarios"]["save"]>[0]["plan"];

export const Route = createFileRoute("/plan")({ beforeLoad: requireSession, component: Plan });

const ROLE_LABEL: Record<AccountRole, string> = { emergency: "Emergency", goal: "Goal", spending: "Spending", exclude: "Not counted" };
const ROLES = Object.keys(ROLE_LABEL) as AccountRole[];
const VERDICT = {
  comfortable: { icon: "✓", label: "Comfortable", cls: "bg-positive-soft text-positive-ink" },
  tight: { icon: "!", label: "Tight", cls: "bg-warning-soft text-warning-ink" },
  risky: { icon: "✕", label: "Risky", cls: "bg-destructive-soft text-destructive-ink" },
} as const;
const STATUS_ICON = { ok: "✓", warn: "!", fail: "✕", info: "i" } as const;
/** "Jun 2028": sales and purchases can be years out, so the short month alone is ambiguous. */
const monthYear = (m: string) => `${monthLabel(m, "short")} ${m.slice(0, 4)}`;
const rp = (minor: number) => formatMoney(Math.round(minor / 100) * 100);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type ShareChoice = "replace" | "add" | "keep";

/**
 * The plan kept in this browser. A `#plan=` link never overwrites a saved plan silently: when one exists, the shared
 * plan is shown but not saved until the user replaces the saved plan with it, adds its scenarios, or keeps their own.
 */
function usePlanState() {
  const [init] = useState(() => {
    const shared = decodeShare(window.location.hash);
    const local = loadLocal();
    return { shared, local, ask: !!shared && hasContent(local) && JSON.stringify(local) !== JSON.stringify(shared) };
  });
  const [state, setState] = useState<PlanState>(() => init.shared ?? init.local ?? EMPTY);
  const [pending, setPending] = useState(init.ask);
  const [fromShare, setFromShare] = useState(!!init.shared);
  useEffect(() => {
    if (init.shared) history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [init.shared]);
  useEffect(() => {
    if (!pending) saveLocal(state);
  }, [state, pending]);
  const resolve = (choice: ShareChoice) => {
    if (init.shared && init.local) {
      if (choice === "keep") {
        setState(init.local);
        setFromShare(false);
      } else setState(choice === "add" ? addSharedScenarios(init.local, init.shared) : init.shared);
    }
    setPending(false);
  };
  return { state, setState, fromShare, pending, resolve, savedScenarios: init.local?.scenarios.length ?? 0 };
}

function SharedPrompt({ resolve, canAdd }: { resolve: (c: ShareChoice) => void; canAdd: boolean }) {
  return (
    <div role="alert" className="space-y-2 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning-ink">
      <p>
        <span className="font-medium">Replace your saved plan with the shared one?</span> You opened a shared plan link; it is shown below but not saved
        until you choose.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => resolve("replace")}>
          Replace my saved plan
        </Button>
        {canAdd && (
          <Button variant="secondary" size="sm" onClick={() => resolve("add")}>
            Add its scenarios to mine
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => resolve("keep")}>
          Keep mine
        </Button>
      </div>
    </div>
  );
}

function Plan() {
  const { state, setState, fromShare, pending, resolve, savedScenarios } = usePlanState();
  const start = shiftMonth(currentMonthWib(), 1);
  const baseline = useQuery(orpc.plan.baseline.queryOptions({ input: {} }));
  const input = useMemo(
    () => ({
      monthlyIncome: state.monthlyIncome,
      monthlySpending: state.monthlySpending,
      existingInstallments: state.existingInstallments,
      roles: state.roles,
      horizonMonths: state.horizonMonths,
      scenarios: state.scenarios.map((s) => ({ name: s.name || "Untitled", items: flatten(s) as never })),
      includeBaseline: true,
    }),
    [state],
  );
  const debounced = useDebounced(input, 400);
  const compare = useQuery({
    ...orpc.plan.compare.queryOptions({ input: debounced }),
    enabled: baseline.isSuccess && debounced.scenarios.length > 0,
    placeholderData: keepPreviousData,
  });
  const [copied, setCopied] = useState(false);
  const en = useLang() === "en";
  const addCuts = (cuts: CutIn[], target: string | null) => {
    const r = applyCuts(state, cuts, target, en ? "With savings" : "Dengan hemat");
    if (!r.scenarioId) return void toast.error(en ? "Six scenarios at most on the page; remove one first." : "Maksimal enam skenario; hapus satu dulu.");
    setState(r.state);
    const name = r.state.scenarios.find((s) => s.id === r.scenarioId)?.name ?? "";
    toast.success(cuts.length ? (en ? `Cuts added to "${name}"` : `Hemat dimasukkan ke "${name}"`) : en ? `Cuts removed from "${name}"` : `Hemat dihapus dari "${name}"`);
  };

  const update = (fn: (s: PlanState) => PlanState) => setState((s) => fn(s));
  const setScenario = (id: string, fn: (s: Scenario) => Scenario) => update((st) => ({ ...st, scenarios: st.scenarios.map((x) => (x.id === id ? fn(x) : x)) }));

  const qc = useQueryClient();
  const saved = useQuery(orpc.plan.scenarios.list.queryOptions());
  const refreshSaved = () => void qc.invalidateQueries({ queryKey: orpc.plan.scenarios.key() });
  const save = useMutation({
    mutationFn: (s: Scenario) => {
      const plan = {
        monthlyIncome: state.monthlyIncome,
        monthlySpending: state.monthlySpending,
        existingInstallments: state.existingInstallments,
        roles: state.roles,
        horizonMonths: state.horizonMonths,
        items: flatten(s),
      } as SavedPlanIn;
      return client.plan.scenarios.save({ id: s.savedId, name: s.name.trim() || "Untitled", plan, view: { v: 1, blocks: s.blocks } });
    },
    onSuccess: (r, s) => {
      setScenario(s.id, (x) => ({ ...x, name: r.scenario.name, savedId: r.scenario.id, savedSig: signature({ name: r.scenario.name, blocks: s.blocks }) }));
      refreshSaved();
      toast.success(r.created ? `Saved "${r.scenario.name}"` : `Updated "${r.scenario.name}"`, { description: "Everyone in your household can open it." });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const onSave = (s: Scenario) => {
    const name = s.name.trim() || "Untitled";
    const clash = saved.data?.scenarios.find((x) => x.name === name && x.id !== s.savedId);
    if (clash && !s.savedId && !confirm(`A saved scenario is already called "${name}". Replace it?`)) return;
    save.mutate(s);
  };

  const remove = useMutation({
    mutationFn: (id: string) => client.plan.scenarios.delete({ id }),
    onSuccess: (r) => {
      update((st) => ({ ...st, scenarios: st.scenarios.map((x) => (x.savedId === r.id ? { ...x, savedId: undefined, savedSig: undefined } : x)) }));
      refreshSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const openSaved = async (id: string) => {
    if (state.scenarios.length >= 6) return toast.error("Six scenarios at most on the page; remove one first.");
    try {
      const sc = await client.plan.scenarios.get({ id });
      const blocks = blocksFromSaved(sc.plan.items, sc.view);
      const p = sc.plan;
      const pageHasOwn =
        state.monthlyIncome !== undefined || state.monthlySpending !== undefined || state.existingInstallments !== undefined || Object.keys(state.roles).length > 0;
      const savedHasOwn = p.monthlyIncome !== undefined || p.monthlySpending !== undefined || p.existingInstallments !== undefined || Object.keys(p.roles ?? {}).length > 0;
      update((st) => ({
        ...st,
        ...(!pageHasOwn && savedHasOwn
          ? { monthlyIncome: p.monthlyIncome, monthlySpending: p.monthlySpending, existingInstallments: p.existingInstallments, roles: p.roles ?? {} }
          : {}),
        ...(!st.scenarios.length ? { horizonMonths: p.horizonMonths } : {}),
        scenarios: [...st.scenarios, { id: uid(), name: sc.name, slot: freeSlot(st.scenarios), blocks, savedId: sc.id, savedSig: signature({ name: sc.name, blocks }) }],
      }));
      if (pageHasOwn && savedHasOwn) toast.info("Kept this page's baseline numbers", { description: `"${sc.name}" was saved with its own; every scenario here uses the same baseline.` });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/plan#plan=${encodeShare(state)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied", { description: "Anyone with the link sees these scenarios, not your ledger." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  const [joyoOpen, setJoyoOpen] = useState(true);
  const [joyoOverlay, setJoyoOverlay] = useState(false);
  const wide = useMediaQuery("(min-width: 1280px)");
  const docked = wide && joyoOpen;
  const stateRef = useRef(state);
  stateRef.current = state;
  const joyoPage = () => ({ kind: "plan" as const, state: planPageState(stateRef.current) });
  const onJoyoPlan = (e: PlanEvent) => {
    setState((s) => applyJoyoPlan(s, e.tool, e.args));
    toast.success("Joyo updated the plan", { description: wide ? undefined : "Close the chat to see it.", duration: 2500 });
  };
  const joyo = (onClose: () => void, className: string) => (
    <JoyoPanel
      title="Joyo AI · plan consultant"
      intro="Tell Joyo what you're weighing up. It builds the scenarios on this page and checks them against your real numbers while you talk."
      starters={PLAN_STARTERS}
      page={joyoPage}
      onPlan={onJoyoPlan}
      onClose={onClose}
      className={className}
    />
  );
  const empty = !state.scenarios.length;

  return (
    <div className={cn("grid items-start gap-4", docked && "grid-cols-[minmax(0,1fr)_24rem]")}>
      <div className="min-w-0 space-y-4">
        <PageHeader
          title="Plan & simulate"
          subtitle="Test a big decision against your real income, spending and savings."
          action={
            <>
              <Select aria-label="Look ahead" size="sm" className="w-32" value={String(state.horizonMonths)} onValueChange={(v) => update((s) => ({ ...s, horizonMonths: Number(v) }))} items={HORIZON_ITEMS} />
              <Button variant="secondary" size="sm" onClick={() => void share()} disabled={empty}>
                <Share2 aria-hidden />
                {copied ? "Copied" : "Share"}
              </Button>
              {!docked && (
                <Button size="sm" onClick={() => (wide ? setJoyoOpen(true) : setJoyoOverlay(true))}>
                  <Sparkles aria-hidden />
                  Ask Joyo
                </Button>
              )}
            </>
          }
        />
        {pending ? (
          <SharedPrompt resolve={resolve} canAdd={savedScenarios < 6} />
        ) : (
          fromShare && <p className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary-ink">Opened a shared plan. Changes are kept in this browser.</p>
        )}
        {baseline.isError && <p className="text-sm text-destructive">{errorMessage(baseline.error)}</p>}
        {baseline.isPending && <p className="text-sm text-muted-foreground">Reading your ledger…</p>}
        {baseline.data && <BaselineCard b={baseline.data} state={state} update={update} />}

        {empty && (
          <section className="card space-y-3">
            <div>
              <h2 className="text-base font-bold tracking-tight">What are you thinking about?</h2>
              <p className="text-sm text-muted-foreground">Start from an example and change the numbers, or ask Joyo to build it with you.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => update((s) => ({ ...s, scenarios: quickStart(start) }))}>
                Car A vs Car B, with a baby
              </Button>
              <Button variant="secondary" size="sm" onClick={() => update((s) => ({ ...s, scenarios: [{ id: uid(), name: "Small car now, bigger later", slot: 1, blocks: upgradeBlocks(start) }] }))}>
                Small car now, bigger later
              </Button>
              <Button variant="secondary" size="sm" onClick={() => update((s) => ({ ...s, scenarios: [{ id: uid(), name: "Scenario 1", slot: 1, blocks: [] }] }))}>
                Blank scenario
              </Button>
            </div>
          </section>
        )}

        {compare.isError && <p className="text-sm text-destructive">{errorMessage(compare.error)}</p>}
        {compare.data && !empty && (
          <div className={`space-y-4 transition-opacity ${compare.isPlaceholderData || compare.isFetching ? "opacity-70" : ""}`}>
            <CompareView c={compare.data} scenarios={state.scenarios} />
          </div>
        )}

        {!empty && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h2 className="text-base font-bold tracking-tight">
                Scenarios <span className="font-normal text-muted-foreground">({state.scenarios.length}/6)</span>
              </h2>
              {state.scenarios.length < 6 && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => update((st) => ({ ...st, scenarios: [...st.scenarios, { id: uid(), name: `Scenario ${st.scenarios.length + 1}`, slot: freeSlot(st.scenarios), blocks: [] }] }))}
                >
                  <Plus aria-hidden /> Add scenario
                </Button>
              )}
            </div>
            <div className={cn("grid gap-3", docked ? "2xl:grid-cols-2" : "lg:grid-cols-2")}>
              {state.scenarios.map((s, i) => (
                <ScenarioCard
                  key={s.id}
                  s={s}
                  start={start}
                  defaultOpen={state.scenarios.length === 1 || s.blocks.length === 0}
                  result={compare.data?.scenarios.find((r) => r.name === (s.name || "Untitled"))}
                  onChange={(fn) => setScenario(s.id, fn)}
                  onSave={() => onSave(s)}
                  saving={save.isPending && save.variables?.id === s.id}
                  onRemove={() => update((st) => ({ ...st, scenarios: st.scenarios.filter((x) => x.id !== s.id) }))}
                  onDuplicate={() =>
                    update((st) => {
                      if (st.scenarios.length >= 6) return st;
                      const copy: Scenario = { ...structuredClone(s), id: uid(), name: `${s.name} (copy)`, slot: freeSlot(st.scenarios), savedId: undefined, savedSig: undefined };
                      return { ...st, scenarios: [...st.scenarios.slice(0, i + 1), copy, ...st.scenarios.slice(i + 1)] };
                    })
                  }
                />
              ))}
            </div>
          </section>
        )}

        {baseline.data && !pending && (
          <Disclosure icon={<PiggyBank />} title="Where to save" description="Habits you could trim, from your own spending" bodyClassName="text-foreground">
            <SavingsBlock bare state={state} onApply={addCuts} />
          </Disclosure>
        )}
        <SavedScenarios
          list={saved.data}
          error={saved.error}
          openIds={new Set(state.scenarios.map((s) => s.savedId).filter((x): x is string => !!x))}
          onOpen={(id) => void openSaved(id)}
          onDelete={(id, name) => confirm(`Delete the saved scenario "${name}"? It is removed for everyone in your household.`) && remove.mutate(id)}
        />
      </div>

      {docked && <div className="sticky top-20 h-[calc(100dvh-6rem)]">{joyo(() => setJoyoOpen(false), "h-full shadow-float")}</div>}
      {!wide && joyoOverlay && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/35 p-2 pt-[max(env(safe-area-inset-top),2rem)]" onClick={(e) => e.target === e.currentTarget && setJoyoOverlay(false)}>
          {joyo(() => setJoyoOverlay(false), "flex-1 shadow-float")}
        </div>
      )}
    </div>
  );
}

/** Questions to start the plan chat with; Joyo works on whatever the page shows. */
const PLAN_STARTERS = [
  { text: "Bandingkan mobil Rp 250 jt, DP 30%, 5 tahun, dengan tanpa mobil", hint: "Car options side by side" },
  { text: "Kalau anak pertama lahir tahun depan, masih aman?", hint: "Baby costs on top of the plan" },
  { text: "Make the scenarios on this page safer. What should change?", hint: "Tweaks to what you see" },
  { text: "Bisa hemat di mana supaya cicilannya aman?", hint: "Spending cuts" },
] as const;

// ---------------------------------------------------------------------------------------------------------------
// Saved scenarios

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function SavedScenarios({
  list,
  error,
  openIds,
  onOpen,
  onDelete,
}: {
  list?: SavedList;
  error: unknown;
  openIds: Set<string>;
  onOpen: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!list?.scenarios.length) return null;
  return (
    <Disclosure icon={<Bookmark />} title={`Saved scenarios (${list.scenarios.length})`} description="Shared with your household; open one to compare it here" bodyClassName="text-foreground">
      <ul className="divide-y divide-border">
        {list.scenarios.map((s) => {
          const open = openIds.has(s.id);
          const by = s.updatedBy?.name ?? s.createdBy?.name;
          return (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.labels.length ? s.labels.join(" · ") : "No change"} — {dateFmt.format(new Date(s.updatedAt))}
                  {by ? ` by ${by}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                {open ? (
                  <span className="text-muted-foreground">On this page</span>
                ) : (
                  <Button variant="secondary" size="xs" onClick={() => onOpen(s.id)}>
                    Open
                  </Button>
                )}
                <Button variant="link" size="xs" className="text-destructive" onClick={() => onDelete(s.id, s.name)}>
                  Delete
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Disclosure>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Inputs

/** Dense controls: 40px tall, 16px text on phones (no iOS zoom on focus), 14px from sm up. */
const DENSE = "h-10 px-3 sm:text-sm";
/** Editor grids fill the card with columns of at least 8.5rem, so they suit a phone, a half-width card and a wide one. */
const EDITOR_GRID = "grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-2 gap-y-3";
const TERMS_GRID = "grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-3 gap-y-1 rounded-xl bg-muted/50 p-2.5 text-xs";

/** The id of the control a Field labels; the inputs below read it so every label is clickable. */
const FieldId = createContext<string | undefined>(undefined);

/** A labelled control in a dense editor: the app's Field with a small muted label. */
function Field({ label, hint, className, children }: { label: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <KitField label={label} hint={hint} htmlFor={id} className={cn("gap-1", className)} labelClassName="text-xs leading-snug font-medium text-muted-foreground">
      <FieldId.Provider value={id}>{children}</FieldId.Provider>
    </KitField>
  );
}

/** A Select that fills its cell and takes the surrounding Field's id. */
function Choice({ className, ...props }: Omit<SelectBaseProps, "size" | "dense" | "id">) {
  return <Select id={useContext(FieldId)} size="sm" dense className={cn("w-full", className)} {...props} />;
}

/** `[value, label]` pairs as select items. */
const pairs = (list: readonly (readonly [string, string])[]) => list.map(([value, label]) => ({ value, label }));
const HORIZON_ITEMS = [12, 24, 36, 48, 60, 120].map((m) => ({ value: String(m), label: `${m} months` }));

/** Rupiah in major units with thousands dots while typing; empty means "not set". */
function MoneyInput({ value, onChange, placeholder, label, className }: { value?: number; onChange: (v: number | undefined) => void; placeholder?: string; label: string; className?: string }) {
  const shown = value === undefined ? "" : Math.round(value / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (
    <Input
      id={useContext(FieldId)}
      className={cn(DENSE, className)}
      inputMode="numeric"
      aria-label={label}
      placeholder={placeholder}
      value={shown}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^\d]/g, "");
        onChange(digits ? Number(digits) * 100 : undefined);
      }}
    />
  );
}

type NumProps = { value?: number; label: string; step?: number; min?: number; max?: number; placeholder?: string; disabled?: boolean };

/** A number; empty reads as 0, or as "not set" with `optional`. */
function NumInput(props: NumProps & ({ optional: true; onChange: (v: number | undefined) => void } | { optional?: false; onChange: (v: number) => void })) {
  const { value, label, step = 1, min = 0, max, placeholder, disabled, optional } = props;
  const onChange = props.onChange as (v: number | undefined) => void;
  return (
    <Input
      id={useContext(FieldId)}
      type="number"
      className={DENSE}
      aria-label={label}
      value={value ?? ""}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? (optional ? undefined : 0) : Number(e.target.value))}
    />
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_ITEMS = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));

/**
 * Month and year as two pickers rather than `<input type="month">`, which Chrome cuts off in a half-width cell at phone
 * width ("December 20"). `optional` adds a blank choice that clears.
 */
function MonthInput(
  props: { value?: string; label: string } & ({ optional: true; onChange: (v: string | undefined) => void } | { optional?: false; onChange: (v: string) => void }),
) {
  const { value, label, optional } = props;
  const onChange = props.onChange as (v: string | undefined) => void;
  const id = useContext(FieldId);
  const thisYear = Number(currentMonthWib().slice(0, 4));
  const year = value ? Number(value.slice(0, 4)) : undefined;
  const month = value ? Number(value.slice(5, 7)) : undefined;
  const first = Math.min(thisYear - 1, year ?? thisYear);
  const last = Math.max(thisYear + 10, year ?? thisYear);
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const emit = (y: number, m: number) => onChange(`${y}-${String(m).padStart(2, "0")}`);
  return (
    <div className="grid min-w-0 grid-cols-2 gap-1">
      <Combobox
        id={id}
        size="sm"
        dense
        aria-label={`${label}: month`}
        value={month === undefined ? "" : String(month)}
        onValueChange={(v) => (v ? emit(year ?? thisYear, Number(v)) : optional && onChange(undefined))}
        none={optional ? "–" : undefined}
        placeholder="Month"
        items={MONTH_ITEMS}
        searchPlaceholder="Search months"
      />
      <Combobox
        size="sm"
        dense
        className="tabular-nums"
        aria-label={`${label}: year`}
        value={year === undefined ? "" : String(year)}
        onValueChange={(v) => v && emit(Number(v), month ?? 1)}
        placeholder={optional ? "–" : "Year"}
        items={years.map((y) => ({ value: String(y), label: String(y) }))}
        searchPlaceholder="Search years"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Baseline

function BaselineCard({ b, state, update }: { b: Baseline; state: PlanState; update: (fn: (s: PlanState) => PlanState) => void }) {
  const income = state.monthlyIncome ?? b.income.recurring.amount;
  const spending = state.monthlySpending ?? b.spending.monthly.amount;
  const existing = state.existingInstallments ?? b.existingInstallments.monthly.amount;
  const free = income - spending - existing;
  const roleOf = (a: Baseline["accounts"][number]) => state.roles[a.id] ?? a.suggestedRole;
  const totals = { emergency: 0, goal: 0, spending: 0 };
  for (const a of b.accounts) {
    const r = roleOf(a);
    if (r !== "exclude") totals[r] += a.balance.amount;
  }
  const edited = state.monthlyIncome !== undefined || state.monthlySpending !== undefined || state.existingInstallments !== undefined || Object.keys(state.roles).length > 0;
  const empty = b.income.recurring.amount === 0 && b.spending.monthly.amount === 0;
  const range = b.months.length ? `${monthLabel(b.months[0]!, "short")} – ${monthLabel(b.months[b.months.length - 1]!)}` : "";
  const used = b.history.monthsUsed;
  const span = used < b.history.monthsRequested ? ` (${used} ${used === 1 ? "month" : "months"} of history)` : "";
  const thin = !empty && b.history.tooLittle;

  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold tracking-tight">Your month today</h2>
          <p className="text-xs text-muted-foreground">{empty ? "Type your own numbers to start." : `From your ledger, ${range}${span}.${edited ? " Edited by you." : ""}`}</p>
        </div>
        {edited && (
          <Button
            variant="link"
            size="xs"
            className="text-muted-foreground"
            onClick={() => update((s) => ({ ...s, monthlyIncome: undefined, monthlySpending: undefined, existingInstallments: undefined, roles: {} }))}
          >
            Reset to ledger
          </Button>
        )}
      </div>
      {empty && (
        <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          No complete months in your ledger yet, so there is nothing to start from. Import a few months of statements, or type your monthly income
          and spending below to try scenarios now.
        </p>
      )}
      {thin && (
        <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          Only {used} complete month of history so far, so these numbers are rough. Check them, or type your usual income and spending below.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Income / month" value={rp(income)} edited={state.monthlyIncome !== undefined} />
        <Stat label="Core spending / month" value={rp(spending)} edited={state.monthlySpending !== undefined} />
        <Stat label="Installments / month" value={rp(existing)} edited={state.existingInstallments !== undefined} />
        <Stat label="Free cash / month" value={rp(free)} tone={free < 0 ? "bad" : "good"} />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        Savings counted: emergency {rp(totals.emergency)} · goal {rp(totals.goal)} · spending {rp(totals.spending)}
      </p>

      <Disclosure plain title="Adjust income, spending and accounts" defaultOpen={empty}>
      <div className="space-y-4 pt-2 text-foreground">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Recurring income / month" hint={`Ledger: ${b.income.recurring.display}`}>
          <MoneyInput label="Monthly income" value={state.monthlyIncome} placeholder={rp(b.income.recurring.amount).replace("Rp ", "")} onChange={(v) => update((s) => ({ ...s, monthlyIncome: v }))} />
        </Field>
        <Field label="Core spending / month" hint={`Ledger: ${b.spending.monthly.display} (one-offs left out)`}>
          <MoneyInput label="Monthly spending" value={state.monthlySpending} placeholder={rp(b.spending.monthly.amount).replace("Rp ", "")} onChange={(v) => update((s) => ({ ...s, monthlySpending: v }))} />
        </Field>
        <Field label="Existing installments / month" hint="Loan payments are transfers, not spending">
          <MoneyInput label="Existing installments" value={state.existingInstallments} placeholder={rp(b.existingInstallments.monthly.amount).replace("Rp ", "")} onChange={(v) => update((s) => ({ ...s, existingInstallments: v }))} />
        </Field>
      </div>

      <div className="space-y-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What each account is for</h3>
          <p className="text-xs text-muted-foreground">The emergency fund is checked against 6 months of outflow; "Not counted" leaves an account out.</p>
        </div>
        <ul className="divide-y divide-border">
          {b.accounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm">{a.name}</p>
                <p className="text-xs tabular-nums text-muted-foreground">{a.balance.display}</p>
              </div>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Role of ${a.name}`}>
                {ROLES.map((r) => {
                  const on = roleOf(a) === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      title={r === a.suggestedRole ? `Suggested: ${a.reason}` : undefined}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                      onClick={() =>
                        update((s) => {
                          const roles = { ...s.roles };
                          if (r === a.suggestedRole) delete roles[a.id];
                          else roles[a.id] = r;
                          return { ...s, roles };
                        })
                      }
                    >
                      {ROLE_LABEL[r]}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Disclosure plain title="How these were worked out">
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Income sources</h3>
            <ul className="space-y-1">
              {b.income.sources.map((s) => (
                <li key={s.slug ?? "none"} className="flex items-baseline justify-between gap-2">
                  <span className={`min-w-0 ${s.irregular ? "text-muted-foreground line-through" : ""}`} title={s.reason ?? undefined}>
                    {s.name}
                    <span className="ml-1 text-[11px] text-muted-foreground no-underline">({s.monthsPresent}/{b.months.length} mo)</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{s.irregular ? `avg ${s.average.display}` : s.recurring.display}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">Crossed out: irregular, not counted. Regular sources use the lower of average and median; salary uses its median.</p>
          </div>
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">One-offs left out of spending</h3>
            {b.spending.excluded.length ? (
              <ul className="space-y-1">
                {b.spending.excluded.map((e) => (
                  <li key={e.id} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {e.description} <span className="text-[11px] text-muted-foreground">{e.date}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{e.display}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">None.</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              {b.spending.outlierRule}. Spending with them: {b.spending.average.display} on average.
            </p>
          </div>
        </div>
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {b.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Disclosure>
      </div>
      </Disclosure>
    </section>
  );
}

function Stat({ label, value, edited, tone }: { label: string; value: string; edited?: boolean; tone?: "good" | "bad" }) {
  return (
    <div className={cn("min-w-0 rounded-2xl px-3 py-2.5", tone ? "bg-primary-soft" : "bg-muted/60")}>
      <p className="truncate text-xs text-muted-foreground">
        {label}
        {edited && <span className="ml-1 font-semibold text-primary-ink">· edited</span>}
      </p>
      <p className={cn("truncate text-base font-bold tabular-nums sm:text-lg", tone === "bad" && "text-[var(--viz-bad-text)]", tone === "good" && "text-primary-ink")}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Scenario builder

function ScenarioCard({
  s,
  start,
  defaultOpen,
  result,
  onChange,
  onSave,
  saving,
  onRemove,
  onDuplicate,
}: {
  s: Scenario;
  start: string;
  defaultOpen?: boolean;
  result?: CompareScenario;
  onChange: (fn: (s: Scenario) => Scenario) => void;
  onSave: () => void;
  saving: boolean;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const dirty = isDirty(s);
  const setBlock = (key: string, b: Block) => onChange((x) => ({ ...x, blocks: x.blocks.map((y) => (y.key === key ? b : y)) }));
  const remove = (key: string) => onChange((x) => ({ ...x, blocks: x.blocks.filter((y) => y.key !== key) }));
  const add = (b: Block) => onChange((x) => ({ ...x, blocks: [...x.blocks, b] }));
  let loanIndex = 0;
  const summary = s.blocks.length ? s.blocks.map((b) => (b.kind === "baby" ? "Baby" : b.item.label || "Item")).join(" · ") : "No change yet";
  return (
    <details open={defaultOpen} className="group/sc card min-w-0 p-0 sm:p-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-3xl px-4 py-3.5 outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block size-3 shrink-0 rounded-full" style={{ background: `var(--viz-series-${s.slot})` }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{s.name || "Untitled"}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {summary}
            {s.savedId ? (dirty ? " · unsaved changes" : " · saved") : ""}
          </span>
        </span>
        {result && <VerdictBadge v={result.verdict} />}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open/sc:rotate-180" />
      </summary>
      <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
      <Input className={cn(DENSE, "font-semibold")} aria-label="Scenario name" value={s.name} onChange={(e) => onChange((x) => ({ ...x, name: e.target.value }))} />
      {s.blocks.length === 0 && <p className="text-sm text-muted-foreground">Nothing added yet: this is the same as no change.</p>}
      {s.blocks.map((b) => {
        if (b.kind === "loan") {
          const terms = result?.loans[loanIndex++];
          return <LoanEditor key={b.key} item={b.item} terms={terms} onChange={(item) => setBlock(b.key, { ...b, item })} onRemove={() => remove(b.key)} />;
        }
        if (b.kind === "baby") return <BabyEditor key={b.key} b={b} onChange={(nb) => setBlock(b.key, nb)} onRemove={() => remove(b.key)} />;
        return <ItemEditor key={b.key} item={b.item} onChange={(item) => setBlock(b.key, { ...b, item })} onRemove={() => remove(b.key)} />;
      })}
      <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
        <AddButton onClick={() => add(carBlock(start, `Car ${String.fromCharCode(65 + s.blocks.filter((b) => b.kind === "loan").length)}`))}>Car loan</AddButton>
        <AddButton onClick={() => onChange((x) => ({ ...x, blocks: [...x.blocks, ...upgradeBlocks(start)] }))}>Small car, then bigger</AddButton>
        <AddButton onClick={() => add(babyBlock(shiftMonth(start, 6)))}>Baby</AddButton>
        <AddButton onClick={() => add({ key: uid(), kind: "item", item: { type: "oneOff", label: "One-off cost", month: start, amount: 0, direction: "out", fundedFrom: "spending" } })}>One-off</AddButton>
        <AddButton onClick={() => add({ key: uid(), kind: "item", item: { type: "recurring", label: "Monthly cost", startMonth: start, monthly: 0 } })}>Monthly cost</AddButton>
        <AddButton onClick={() => add({ key: uid(), kind: "item", item: { type: "incomeChange", label: "Income change", startMonth: start, mode: "delta", amount: 0 } })}>Income change</AddButton>
        <AddButton onClick={() => add({ key: uid(), kind: "item", item: { type: "cut", label: "Spending cut", startMonth: start, monthly: 0 } })}>Spending cut</AddButton>
        <span className="ml-auto flex items-center gap-3 text-xs">
          <Button variant="link" size="xs" disabled={saving || (!!s.savedId && !dirty)} onClick={onSave}>
            {saving ? "Saving…" : !s.savedId ? "Save" : dirty ? "Save changes" : "Saved ✓"}
          </Button>
          <Button variant="link" size="xs" className="text-muted-foreground" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button variant="link" size="xs" className="text-destructive" onClick={onRemove}>
            Remove
          </Button>
        </span>
      </div>
      </div>
    </details>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="rounded-full border border-dashed border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft" onClick={onClick}>
      + {children}
    </button>
  );
}

function BlockShell({ title, sub, onRemove, children }: { title: ReactNode; sub?: ReactNode; onRemove: () => void; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-2xl bg-muted/50 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{title}</div>
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive" aria-label="Remove" onClick={onRemove}>
          <X />
        </Button>
      </div>
      {sub}
      {children}
    </div>
  );
}

const TENORS = [12, 24, 36, 48, 60, 72, 84];
/** The usual tenors plus the loan's own when a quote uses another (the Geely's 47 months), so the select shows it. */
const tenorChoices = (current: number) => (TENORS.includes(current) ? TENORS : [...TENORS, current].sort((a, b) => a - b));

const FUNDED = [
  ["goal", "Goal savings"],
  ["spending", "Spending accounts"],
  ["emergency", "Emergency fund"],
] as const;
const FUNDED_ITEMS = pairs(FUNDED);
const RATE_TYPE_ITEMS = pairs([["flat", "Flat"], ["effective", "Effective"]]);
const DIRECTION_ITEMS = pairs([["out", "Money out"], ["in", "Money in"]]);
const MODE_ITEMS = pairs([["delta", "Add / remove"], ["replace", "Income becomes"]]);

function LoanEditor({ item, terms, onChange, onRemove }: { item: LoanIn; terms?: CompareScenario["loans"][number]; onChange: (i: LoanIn) => void; onRemove: () => void }) {
  const set = (patch: Partial<LoanIn>) => onChange({ ...item, ...patch });
  const estimates = carTemplate({ month: "2000-01" }).estimates;
  return (
    <BlockShell
      onRemove={onRemove}
      title={<Input className={cn(DENSE, "font-semibold")} aria-label="Loan name" value={item.label ?? ""} onChange={(e) => set({ label: e.target.value })} />}
    >
      <div className={EDITOR_GRID}>
        <Field label="OTR price">
          <MoneyInput label="Price" value={item.price || undefined} placeholder="from the dealer" onChange={(v) => set({ price: v ?? 0 })} />
        </Field>
        <Field label="Down payment %" hint={item.downPayment !== undefined ? "From the amount" : undefined}>
          <NumInput
            label="Down payment percent"
            value={item.downPayment !== undefined ? undefined : item.downPaymentPct}
            placeholder={item.downPayment !== undefined && item.price ? String(Math.round((item.downPayment / item.price) * 1000) / 10) : undefined}
            max={100}
            onChange={(v) => set({ downPaymentPct: v, downPayment: undefined })}
          />
        </Field>
        <Field label="Down payment">
          <MoneyInput
            label="Down payment"
            value={item.downPayment}
            placeholder={item.price ? rp((item.price * (item.downPaymentPct ?? 0)) / 100).replace("Rp ", "") : undefined}
            onChange={(v) => set({ downPayment: v, ...(v === undefined ? {} : { downPaymentPct: undefined }) })}
          />
        </Field>
        <Field label="Tenor (months)">
          <Choice value={String(item.tenorMonths)} onValueChange={(v) => set({ tenorMonths: Number(v) })} items={tenorChoices(item.tenorMonths).map((m) => ({ value: String(m), label: String(m) }))} />
        </Field>
        <Field label="Rate % / year" hint={item.installment !== undefined ? "Not used: installment quoted" : "Ask the dealer"}>
          <NumInput label="Interest rate" value={item.ratePct} step={0.1} max={60} disabled={item.installment !== undefined} onChange={(v) => set({ ratePct: v })} />
        </Field>
        <Field label="Installment (quoted)" hint="Optional: the dealer's figure">
          <MoneyInput label="Quoted installment" value={item.installment} placeholder="from the rate" onChange={(v) => set({ installment: v, ...(v === undefined && item.ratePct === undefined ? { ratePct: 0 } : {}) })} />
        </Field>
        <Field label="Rate type">
          <Choice value={item.rateType ?? "flat"} onValueChange={(v) => set({ rateType: v as "flat" | "effective" })} items={RATE_TYPE_ITEMS} />
        </Field>
        <Field label="Buy in">
          <MonthInput label="Purchase month" value={item.month} onChange={(v) => set({ month: v })} />
        </Field>
        <Field label="DP paid from">
          <Choice value={item.fundedFrom ?? "goal"} onValueChange={(v) => set({ fundedFrom: v })} items={FUNDED_ITEMS} />
        </Field>
      </div>
      <Disclosure plain title="Insurance, fees and running costs (estimates)">
        <div className={cn(EDITOR_GRID, "mt-2")}>
          <Field label="Insurance yr 1 (% of price)">
            <NumInput label="Insurance first year percent" value={item.insuranceFirstYearPct} step={0.1} onChange={(v) => set({ insuranceFirstYearPct: v, insuranceFirstYear: undefined })} />
          </Field>
          <Field label="Insurance later (%/yr)">
            <NumInput label="Insurance renewal percent" value={item.insuranceRenewalPct} step={0.1} onChange={(v) => set({ insuranceRenewalPct: v })} />
          </Field>
          <Field label="Admin fee">
            <MoneyInput label="Admin fee" value={item.adminFee} onChange={(v) => set({ adminFee: v ?? 0 })} />
          </Field>
          <Field label="Provision %">
            <NumInput label="Provision percent" value={item.provisionPct} step={0.1} onChange={(v) => set({ provisionPct: v })} />
          </Field>
          <Field label="PKB (%/yr of price)">
            <NumInput label="Vehicle tax percent" value={item.annualTaxPct} step={0.1} onChange={(v) => set({ annualTaxPct: v, annualTax: undefined })} />
          </Field>
          <Field label="Fuel / month">
            <MoneyInput label="Fuel" value={item.fuelMonthly} onChange={(v) => set({ fuelMonthly: v ?? 0 })} />
          </Field>
          <Field label="Parking & toll / month">
            <MoneyInput label="Parking and toll" value={item.parkingTollMonthly} onChange={(v) => set({ parkingTollMonthly: v ?? 0 })} />
          </Field>
          <Field label="Maintenance / month">
            <MoneyInput label="Maintenance" value={item.maintenanceMonthly} onChange={(v) => set({ maintenanceMonthly: v ?? 0 })} />
          </Field>
          <Field label="Saves / month" hint="Grab, taxis it replaces">
            <MoneyInput label="Saves monthly" value={item.savesMonthly} onChange={(v) => set({ savesMonthly: v ?? 0 })} />
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Check label="Insurance in the loan" on={!!item.insuranceFinanced} set={(v) => set({ insuranceFinanced: v })} />
          <Check label="Fees in the loan" on={!!item.feesFinanced} set={(v) => set({ feesFinanced: v })} />
          <Check label="First installment upfront (ADDM)" on={item.payment === "advance"} set={(v) => set({ payment: v ? "advance" : "arrears" })} />
        </div>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11px] text-muted-foreground">
          {estimates.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </Disclosure>
      <SaleEditor item={item} sale={terms?.sale ?? null} set={set} />
      {terms && item.price > 0 && (
        <dl className={TERMS_GRID}>
          <Term k="Installment" v={terms.installment.display} strong />
          <Term k="Cash upfront" v={terms.upfront.display} />
          <Term k="Total interest" v={terms.totalInterest.display} />
          <Term k={`Cost over ${terms.tenorMonths} mo`} v={terms.totalCostOfOwnership.display} />
          {(item.rateType !== "effective" || item.installment !== undefined) && <Term k="Effective rate ≈" v={`${terms.effectiveRatePct}% / yr`} />}
        </dl>
      )}
      {!item.price && <p className="text-xs text-warning-ink">Enter the price to see the installment.</p>}
    </BlockShell>
  );
}

type SaleOut = NonNullable<CompareScenario["loans"][number]["sale"]>;

/** "Sell it after N months": the sale price first settles the loan, the rest comes back. */
function SaleEditor({ item, sale, set }: { item: LoanIn; sale: SaleOut | null; set: (patch: Partial<LoanIn>) => void }) {
  const s = item.sale;
  const after = s?.afterMonths ?? 18;
  const patch = (p: Partial<NonNullable<LoanIn["sale"]>>) => set({ sale: { afterMonths: after, ...s, ...p } });
  return (
    <div className="space-y-2">
      <Check label="Sell it later (upgrade path)" on={!!s} set={(v) => set({ sale: v ? { afterMonths: 18 } : undefined })} />
      {s && (
        <>
          <div className={EDITOR_GRID}>
            <Field label="Sell after (months)" hint={item.month ? `In ${monthYear(shiftMonth(item.month, after))}` : undefined}>
              <NumInput label="Sell after months" value={s.afterMonths} min={1} max={120} onChange={(v) => patch({ afterMonths: Math.max(1, Math.round(v)) })} />
            </Field>
            <Field label="Resale % of price" hint={s.resalePct === undefined && s.resaleAmount === undefined ? "EV estimate" : undefined}>
              <NumInput
                optional
                label="Resale percent"
                max={100}
                value={s.resalePct}
                placeholder={String(defaultResalePct(after))}
                onChange={(v) => patch({ resalePct: v, resaleAmount: undefined })}
              />
            </Field>
            <Field label="Early-settlement fee %" hint="Of the loan left">
              <NumInput label="Settlement penalty percent" value={s.settlementPenaltyPct} step={0.5} max={100} onChange={(v) => patch({ settlementPenaltyPct: v })} />
            </Field>
            <Field label="Proceeds go to">
              <Choice value={s.proceedsTo ?? "goal"} onValueChange={(v) => patch({ proceedsTo: v })} items={FUNDED_ITEMS} />
            </Field>
          </div>
          {sale && (
            <dl className={TERMS_GRID}>
              <Term k={`Sold ${monthYear(sale.month)} for`} v={`${sale.resale.display} (${sale.resalePct}%)`} />
              <Term k="Loan left to settle" v={sale.settlement.display} />
              <Term k={sale.net.amount >= 0 ? "Cash back" : "To pay"} v={sale.net.display.replace("-", "")} strong />
              <Term k={`Cost over ${sale.afterMonths} mo`} v={sale.costWhileOwned.display} />
            </dl>
          )}
          <p className="text-[11px] text-muted-foreground">
            Add the next car as another loan bought in the sale month. Default resale: battery EVs in Indonesia lose about 35% in the first year and 10% a year after;
            ask for a trade-in quote.
          </p>
        </>
      )}
    </div>
  );
}

function Term({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn("tabular-nums [overflow-wrap:anywhere]", strong && "font-semibold")}>{v}</dd>
    </div>
  );
}

function Check({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 py-1">
      <Checkbox checked={on} onCheckedChange={(checked) => set(checked)} />
      {label}
    </label>
  );
}

function BabyEditor({ b, onChange, onRemove }: { b: Extract<Block, { kind: "baby" }>; onChange: (b: Block) => void; onRemove: () => void }) {
  const regenerate = (caesar: boolean, caregiver: boolean) => onChange({ ...b, caesar, caregiver, items: babyTemplate({ birthMonth: b.birthMonth, caesar, caregiver }).items });
  const setItem = (i: number, item: ScenarioItemInput) => onChange({ ...b, items: b.items.map((x, j) => (j === i ? item : x)) });
  return (
    <BlockShell onRemove={onRemove} title={<p className="text-sm font-medium">Baby</p>}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Expected birth">
          <MonthInput label="Birth month" value={b.birthMonth} onChange={(v) => onChange(shiftBaby(b, v))} />
        </Field>
        <div className="flex flex-col justify-end gap-1 text-xs">
          <Check label="Caesarean" on={b.caesar} set={(v) => regenerate(v, b.caregiver)} />
          <Check label="Caregiver / nanny" on={b.caregiver} set={(v) => regenerate(b.caesar, v)} />
        </div>
      </div>
      <Disclosure plain title={<>{b.items.length} costs (estimates you can edit)</>}>
        <ul className="mt-2 space-y-2">
          {b.items.map((it, i) => (
            <li key={i} className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs">
              <span className="min-w-0">
                {it.label}
                <span className="block text-[11px] text-muted-foreground">
                  {it.type === "oneOff" ? `once, ${it.month}` : it.type === "recurring" ? `monthly from ${it.startMonth}${it.endMonth ? ` to ${it.endMonth}` : ""}${it.rampTo ? `, rising to ${rp(it.rampTo)}` : ""}` : ""}
                </span>
              </span>
              {it.type === "oneOff" && <MoneyInput className="w-32" label={it.label} value={it.amount} onChange={(v) => setItem(i, { ...it, amount: v ?? 0 })} />}
              {it.type === "recurring" && <MoneyInput className="w-32" label={it.label} value={it.monthly} onChange={(v) => setItem(i, { ...it, monthly: v ?? 0 })} />}
            </li>
          ))}
        </ul>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11px] text-muted-foreground">
          {babyTemplate({ birthMonth: b.birthMonth }).estimates.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </Disclosure>
    </BlockShell>
  );
}

function ItemEditor({ item, onChange, onRemove }: { item: PlainIn; onChange: (i: PlainIn) => void; onRemove: () => void }) {
  // The sign the "±" button shows. Kept here as well as in the amount so that "−" chosen before typing (amount 0) sticks.
  const [negativeWhileZero, setNegative] = useState(item.type === "incomeChange" && item.amount < 0);
  const negative = item.type === "incomeChange" && item.amount !== 0 ? item.amount < 0 : negativeWhileZero;
  const title = <Input className={cn(DENSE, "font-semibold")} aria-label="Name" value={item.label} onChange={(e) => onChange({ ...item, label: e.target.value })} />;
  if (item.type === "oneOff") {
    return (
      <BlockShell onRemove={onRemove} title={title}>
        <div className={EDITOR_GRID}>
          <Field label="Amount">
            <MoneyInput label="Amount" value={item.amount || undefined} onChange={(v) => onChange({ ...item, amount: v ?? 0 })} />
          </Field>
          <Field label="Month">
            <MonthInput label="Month" value={item.month} onChange={(v) => onChange({ ...item, month: v })} />
          </Field>
          <Field label="Direction">
            <Choice value={item.direction ?? "out"} onValueChange={(v) => onChange({ ...item, direction: v as "in" | "out" })} items={DIRECTION_ITEMS} />
          </Field>
          <Field label={item.direction === "in" ? "Goes to" : "Paid from"}>
            <Choice value={item.fundedFrom ?? "goal"} onValueChange={(v) => onChange({ ...item, fundedFrom: v })} items={FUNDED_ITEMS} />
          </Field>
        </div>
      </BlockShell>
    );
  }
  if (item.type === "recurring") {
    return (
      <BlockShell onRemove={onRemove} title={title}>
        <div className={EDITOR_GRID}>
          <Field label="Per month">
            <MoneyInput label="Monthly amount" value={item.monthly || undefined} onChange={(v) => onChange({ ...item, monthly: v ?? 0 })} />
          </Field>
          <Field label="From">
            <MonthInput label="Start month" value={item.startMonth} onChange={(v) => onChange({ ...item, startMonth: v })} />
          </Field>
          <Field label="Until (optional)">
            <MonthInput optional label="End month" value={item.endMonth} onChange={(v) => onChange({ ...item, endMonth: v })} />
          </Field>
          <Field label="Increase %/yr">
            <NumInput label="Yearly increase" value={item.annualIncreasePct} step={0.5} onChange={(v) => onChange({ ...item, annualIncreasePct: v })} />
          </Field>
        </div>
      </BlockShell>
    );
  }
  if (item.type === "cut") {
    return (
      <BlockShell onRemove={onRemove} title={title}>
        <div className={EDITOR_GRID}>
          <Field label="Less spending / month">
            <MoneyInput label="Monthly saving" value={item.monthly || undefined} onChange={(v) => onChange({ ...item, monthly: v ?? 0 })} />
          </Field>
          <Field label="From">
            <MonthInput label="Start month" value={item.startMonth} onChange={(v) => onChange({ ...item, startMonth: v })} />
          </Field>
          <Field label="Until (optional)">
            <MonthInput optional label="End month" value={item.endMonth} onChange={(v) => onChange({ ...item, endMonth: v })} />
          </Field>
        </div>
        {item.habit && <p className="text-[11px] text-muted-foreground">From Where to save: change the target there and add it again to update.</p>}
      </BlockShell>
    );
  }
  return (
    <BlockShell onRemove={onRemove} title={title}>
      <div className={EDITOR_GRID}>
        <Field label="Change">
          <Choice value={item.mode ?? "delta"} onValueChange={(v) => onChange({ ...item, mode: v as "delta" | "replace" })} items={MODE_ITEMS} />
        </Field>
        <Field label={item.mode === "replace" ? "New income / month" : "Per month (− to reduce)"}>
          <div className="flex gap-1">
            {item.mode !== "replace" && (
              <Button
                variant="secondary"
                size="icon-sm"
                className="text-base"
                aria-label="Flip sign"
                onClick={() => {
                  setNegative(!negative);
                  if (item.amount) onChange({ ...item, amount: -item.amount });
                }}
              >
                {negative ? "−" : "+"}
              </Button>
            )}
            <MoneyInput label="Amount" className="w-full" value={Math.abs(item.amount) || undefined} onChange={(v) => onChange({ ...item, amount: (negative ? -1 : 1) * (v ?? 0) })} />
          </div>
        </Field>
        <Field label="From">
          <MonthInput label="Start month" value={item.startMonth} onChange={(v) => onChange({ ...item, startMonth: v })} />
        </Field>
        <Field label="Until (optional)">
          <MonthInput optional label="End month" value={item.endMonth} onChange={(v) => onChange({ ...item, endMonth: v })} />
        </Field>
      </div>
    </BlockShell>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Results

function VerdictBadge({ v }: { v: keyof typeof VERDICT }) {
  const x = VERDICT[v];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${x.cls}`}>
      <span aria-hidden>{x.icon}</span>
      {x.label}
    </span>
  );
}

function colorOf(name: string, scenarios: Scenario[]) {
  const s = scenarios.find((x) => (x.name || "Untitled") === name);
  return s ? `var(--viz-series-${s.slot})` : "var(--viz-previous)";
}

function CompareView({ c, scenarios }: { c: Compare; scenarios: Scenario[] }) {
  const series = c.scenarios.map((s) => ({ key: s.name, label: s.name, color: colorOf(s.name, scenarios), dashed: !scenarios.some((x) => (x.name || "Untitled") === s.name), values: s.series.total }));
  const rows: { label: string; cell: (s: CompareScenario) => ReactNode }[] = [
    { label: "Verdict", cell: (s) => <VerdictBadge v={s.verdict} /> },
    { label: "New installments / month", cell: (s) => s.summary.installment.display },
    { label: "Cash out (DP, fees, one-offs)", cell: (s) => s.summary.upfront.display },
    { label: "Lowest liquid balance", cell: (s) => <>{s.summary.lowestBalance.display} <span className="text-muted-foreground">({monthLabel(s.summary.lowestBalance.month, "short")} {s.summary.lowestBalance.month.slice(2, 4)})</span></> },
    { label: "Emergency fund covers (worst)", cell: (s) => `${s.summary.emergencyCoverMonths >= 999 ? "∞" : s.summary.emergencyCoverMonths} months` },
    { label: "Installments / income", cell: (s) => `${s.summary.debtRatioPct}%` },
    { label: "Car installment / income", cell: (s) => (s.summary.carInstallment.amount ? `${s.summary.carRatioPct}%` : "–") },
    { label: "Average free cash / month", cell: (s) => s.summary.averageFreeCash.display },
    { label: `Balance after ${c.horizonMonths} months`, cell: (s) => s.summary.endBalance.display },
    { label: "Goal savings rebuilt", cell: (s) => (s.summary.goalRebuiltInMonths === null ? "not in this period" : s.summary.goalRebuiltInMonths === 0 ? "not touched" : `after ${s.summary.goalRebuiltInMonths} months`) },
  ];
  return (
    <>
      <section className="card min-w-0 space-y-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">Liquid money over time</h2>
          <p className="text-xs text-muted-foreground">
            Emergency, goal and spending accounts together, {monthLabel(c.startMonth, "short")} {c.startMonth.slice(0, 4)} onward.
          </p>
        </div>
        <Legend items={series.map((s) => ({ key: <LineKey color={s.color} dashed={s.dashed} />, label: s.label }))} />
        <ProjectionChart months={c.months} series={series} format={rp} monthShort={(m) => `${monthLabel(m, "short")} '${m.slice(2, 4)}`} />
      </section>

      <section className="card min-w-0 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-bold tracking-tight">Side by side</h2>
          {c.scenarios.length > 1 && <span className="text-xs text-muted-foreground sm:hidden">Swipe sideways for all {c.scenarios.length} →</span>}
        </div>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="sticky left-0 z-10 bg-card py-1 pr-3 font-normal" />
                {c.scenarios.map((s) => (
                  <th key={s.name} className="py-1 pr-3 font-medium text-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <LineKey color={colorOf(s.name, scenarios)} dashed={!scenarios.some((x) => (x.name || "Untitled") === s.name)} />
                      {s.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.label}>
                  <th className="sticky left-0 z-10 max-w-32 bg-card py-1.5 pr-3 text-left text-xs font-normal text-muted-foreground sm:max-w-none">{r.label}</th>
                  {c.scenarios.map((s) => (
                    <td key={s.name} className="py-1.5 pr-3 tabular-nums">
                      {r.cell(s)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Disclosure plain title="Why each verdict">
        <div className="grid gap-4 pt-2 text-foreground md:grid-cols-2">
        {c.scenarios.map((s) => (
          <div key={s.name} className="min-w-0 space-y-2 rounded-2xl bg-muted/50 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex min-w-0 items-center gap-1.5 truncate font-bold">
                <LineKey color={colorOf(s.name, scenarios)} dashed={!scenarios.some((x) => (x.name || "Untitled") === s.name)} />
                {s.name}
              </h3>
              <VerdictBadge v={s.verdict} />
            </div>
            <p className="text-sm">{plainVerdict(s)}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {s.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <Disclosure plain title="All checks">
              <ul className="mt-2 space-y-1.5 text-xs">
                {s.rules.map((r) => (
                  <li key={r.id} className="flex gap-2">
                    <span aria-label={r.status} className={`w-4 shrink-0 text-center font-semibold ${r.status === "ok" ? "text-positive" : r.status === "fail" ? "text-destructive" : r.status === "warn" ? "text-warning-ink" : "text-muted-foreground"}`}>
                      {STATUS_ICON[r.status]}
                    </span>
                    <span>
                      <span className="font-medium">{r.title}.</span> {r.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        ))}
        </div>
        </Disclosure>
        <Disclosure plain title="Assumptions and checks">
        <div className="space-y-1 text-xs">
        <ul className="list-disc space-y-0.5 pl-5">
          {c.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <p>
          Checks: emergency fund ≥ 6 months of the new monthly outflow (warn under 6, risky under 3); all installments ≤ 30% of income and the car ≤ 20% (risky above +10 points); liquid money
          never below zero; income covers the monthly outflow. Any risky check makes the plan risky; any warning makes it tight.
        </p>
        </div>
        </Disclosure>
      </section>
    </>
  );
}

function plainVerdict(s: CompareScenario): string {
  const low = s.summary.lowestBalance;
  if (s.verdict === "comfortable") return `This looks affordable on these numbers: every check passes and your liquid money stays above ${low.display}.`;
  if (s.verdict === "tight") return "Possible, but with little room for surprises. The points below are where it gets thin.";
  return "On these numbers this plan puts you at real risk. The points below say why; try a cheaper option, a bigger down payment from other savings, a longer tenor or a later date.";
}
