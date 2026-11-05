// "Bisa hemat di mana" / "Where to save": everyday habits from the household's own history (plan.savings), a target per
// habit the member chooses, and what the chosen cuts do to the plan. The block lives on /plan; the dashboard shows a
// short card linking to it.
import type { AppRouterClient } from "@baroka/api/routers/index";
import { Badge } from "@baroka/ui/components/badge";
import { Button } from "@baroka/ui/components/button";
import { Select } from "@baroka/ui/components/select";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { formatMoney, monthLabel } from "@/lib/format";
import { useLang } from "@/lib/lang";
import { errorMessage, orpc } from "@/lib/orpc";
import { itemsWithoutCuts } from "@/lib/plan-state";
import type { CutIn, PlanState } from "@/lib/plan-state";

export type Savings = Awaited<ReturnType<AppRouterClient["plan"]["savings"]>>;
export type Habit = Savings["habits"][number];
type Suggestion = NonNullable<Habit["suggestion"]>;
type Milestone = NonNullable<Savings["effect"]>["milestones"][number];

/** Indonesian by default, English when the member chose it. */
export function useCopy() {
  const en = useLang() === "en";
  return { en, t: (id: string, english: string) => (en ? english : id) };
}

const num = (x: number, en: boolean) => x.toLocaleString(en ? "en-GB" : "id-ID", { maximumFractionDigits: 1 });
const monthYear = (m: string) => `${monthLabel(m, "short")} ${m.slice(0, 4)}`;

export function habitName(h: Pick<Habit, "kind" | "name">, en: boolean) {
  return h.kind === "minimarket" ? (en ? "Minimarket snacks" : "Jajan di minimarket") : h.name;
}

function per(unit: Suggestion["unit"], en: boolean) {
  return unit === "week" ? (en ? "a week" : "seminggu") : en ? "a month" : "sebulan";
}

/** "2,7x → 2x seminggu" or "maks. Rp 600.000 sebulan". */
export function targetText(s: Suggestion, target: number, en: boolean, capDisplay?: string) {
  if (s.unit === "cap") return en ? `at most ${capDisplay} a month` : `maks. ${capDisplay} sebulan`;
  return `${num(s.current, en)}x → ${target}x ${per(s.unit, en)}`;
}

function frequency(h: Habit, en: boolean) {
  return h.perWeek >= 1.5 ? `${num(h.perWeek, en)}x ${en ? "a week" : "seminggu"}` : `${num(h.perMonth, en)}x ${en ? "a month" : "sebulan"}`;
}

function trendText(h: Habit, en: boolean) {
  const tr = h.trend;
  if (tr.direction === "new") return en ? "new lately" : "baru belakangan";
  if (tr.pct === null) return null;
  if (tr.direction === "flat") return en ? "steady" : "stabil";
  const up = tr.direction === "up";
  return en ? `${up ? "up" : "down"} ${Math.abs(tr.pct)}% lately` : `${up ? "naik" : "turun"} ${Math.abs(tr.pct)}% belakangan`;
}

const RULE_ID: Record<string, { id: string; en: string }> = {
  emergency: { id: "Dana darurat cukup", en: "Emergency fund is enough" },
  debt: { id: "Cicilan ≤ 30% pemasukan", en: "Installments ≤ 30% of income" },
  car: { id: "Cicilan mobil ≤ 20% pemasukan", en: "Car installment ≤ 20% of income" },
  balance: { id: "Saldo tidak pernah minus", en: "Money never runs out" },
  cashflow: { id: "Pemasukan menutup pengeluaran bulanan", en: "Income covers the monthly outflow" },
};
const VERDICT: Record<string, { id: string; en: string }> = {
  comfortable: { id: "Aman", en: "Comfortable" },
  tight: { id: "Pas-pasan", en: "Tight" },
  risky: { id: "Berisiko", en: "Risky" },
};

function milestoneText(m: Milestone, horizon: number, en: boolean): string | null {
  const title =
    m.id === "emergency" ? (en ? "Emergency fund covers 6 months" : "Dana darurat cukup 6 bulan") : m.id === "goalRebuilt" ? (en ? "Goal savings back to today's level" : "Tabungan tujuan kembali utuh") : en ? "Goal reached" : "Target tercapai";
  if (m.onlyWithCuts && m.with) return en ? `${title}: ${monthYear(m.with)}; without the cuts not within ${horizon} months.` : `${title}: ${monthYear(m.with)}; tanpa hemat belum tercapai dalam ${horizon} bulan.`;
  if (m.monthsSooner && m.monthsSooner > 0 && m.with && m.without)
    return en
      ? `${title}: ${monthYear(m.with)}, ${m.monthsSooner} month${m.monthsSooner > 1 ? "s" : ""} sooner (${monthYear(m.without)} without).`
      : `${title}: ${monthYear(m.with)}, ${m.monthsSooner} bulan lebih cepat (tanpa hemat ${monthYear(m.without)}).`;
  return null;
}

type Targets = Record<string, number | null>;

/** The block on /plan. `onApply` puts the cuts into scenario `target` (null: a new scenario). */
export function SavingsBlock({ state, onApply }: { state: PlanState; onApply: (cuts: CutIn[], target: string | null) => void }) {
  const { en, t } = useCopy();
  const [targets, setTargets] = useState<Targets>({});
  const [target, setTarget] = useState<string>(state.scenarios[0]?.id ?? "");
  const scenario = state.scenarios.find((s) => s.id === target);
  useEffect(() => {
    if (target && !scenario) setTarget("");
  }, [target, scenario]);

  const input = useMemo(
    () => ({
      monthlyIncome: state.monthlyIncome,
      monthlySpending: state.monthlySpending,
      existingInstallments: state.existingInstallments,
      roles: state.roles,
      horizonMonths: state.horizonMonths,
      items: (scenario ? itemsWithoutCuts(scenario) : []) as never,
      targets,
      effect: true,
    }),
    [state, scenario, targets],
  );
  const [debounced, setDebounced] = useState(input);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(input), 400);
    return () => clearTimeout(id);
  }, [input]);
  const q = useQuery({ ...orpc.plan.savings.queryOptions({ input: debounced }), placeholderData: keepPreviousData });
  const d = q.data;

  const ready = d?.habits.filter((h) => h.suggestion) ?? [];
  const waiting = d?.habits.filter((h) => !h.suggestion) ?? [];
  const chosen = d?.cutItems ?? [];
  const scenarioItems = [
    { value: "", label: t("Skenario baru: hanya hemat", "New scenario: only the cuts") },
    ...state.scenarios.map((s) => ({ value: s.id, label: s.name || "Untitled" })),
  ];
  const range = d?.months.length ? `${monthLabel(d.months[0]!, "short")} – ${monthLabel(d.months[d.months.length - 1]!, "short")}` : "";
  const milestones = (d?.effect?.milestones ?? []).map((m) => milestoneText(m, d!.effect!.horizonMonths, en)).filter((x): x is string => !!x);
  const endGain = d?.effect ? d.effect.endBalance.with.amount - d.effect.endBalance.without.amount : 0;

  return (
    <section className="card space-y-4" aria-labelledby="savings-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="savings-title" className="text-base font-bold tracking-tight">
            {t("Bisa hemat di mana", "Where to save")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {range
              ? t(`Dari kebiasaan kamu sendiri, ${range}. Pilih yang mau kamu ubah, sisanya biarkan saja.`, `From your own habits, ${range}. Pick what you'd like to change and leave the rest.`)
              : t("Dari kebiasaan kamu sendiri.", "From your own habits.")}
          </p>
        </div>
        {d && d.totalSaving.amount > 0 && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{t("Total hemat", "Total saving")}</p>
            <p className="text-lg font-semibold tabular-nums text-positive-ink">
              {d.totalSaving.display}
              <span className="text-xs font-normal text-muted-foreground">{t(" /bulan", " /month")}</span>
            </p>
            {d.totalSavingIncomePct !== null && (
              <p className="text-[11px] text-muted-foreground">{t(`${num(d.totalSavingIncomePct, en)}% dari pemasukan rutin`, `${num(d.totalSavingIncomePct, en)}% of recurring income`)}</p>
            )}
          </div>
        )}
      </div>

      {q.isError && <p className="text-sm text-destructive">{errorMessage(q.error)}</p>}
      {q.isPending && <p className="text-sm text-muted-foreground">{t("Membaca kebiasaan kamu…", "Reading your habits…")}</p>}
      {d && !d.habits.length && (
        <p className="text-sm text-muted-foreground">
          {t(
            "Belum ada kebiasaan yang bisa dihitung: belum ada transaksi kopi, jajan, makan di luar, pesan antar, ojek online, belanja online atau minimarket di bulan-bulan lengkap terakhir.",
            "Nothing to work with yet: no coffee, snacks, eating out, delivery, ride-hailing, online shopping or minimarket rows in the last complete months.",
          )}
        </p>
      )}

      {ready.length > 0 && (
        <ul className={`divide-y divide-border transition-opacity ${q.isPlaceholderData || q.isFetching ? "opacity-70" : ""}`}>
          {ready.map((h) => (
            <HabitRow key={h.key} h={h} value={targets[h.key]} onChange={(v) => setTargets((x) => ({ ...x, [h.key]: v }))} />
          ))}
        </ul>
      )}

      {waiting.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:underline">
            {t(`${waiting.length} kebiasaan belum cukup data`, `${waiting.length} habit${waiting.length > 1 ? "s" : ""} without enough data`)}
          </summary>
          <ul className="mt-2 space-y-1">
            {waiting.map((h) => (
              <li key={h.key} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">
                  {habitName(h, en)} <span className="text-[11px] text-muted-foreground">{frequency(h, en)}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {h.monthly.display}
                  {t(" /bulan", " /month")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("Saran muncul setelah ada minimal 2 bulan lengkap dan sekitar 4 transaksi sebulan.", "Suggestions start from 2 complete months and about 4 purchases a month.")}
          </p>
        </details>
      )}

      {ready.length > 0 && d?.effect && (
        <div className="space-y-3 rounded-2xl bg-muted/50 p-3 text-sm sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("Dampak ke rencana", "Effect on the plan")}</span>
            <Select
              size="xs"
              className="w-auto min-w-48"
              aria-label={t("Rencana yang dibandingkan", "Plan to compare with")}
              value={scenario ? target : ""}
              onValueChange={setTarget}
              items={scenarioItems}
            />
          </div>
          {chosen.length === 0 ? (
            <p className="text-muted-foreground">{t("Belum ada yang dipilih untuk dihemat.", "Nothing chosen to cut yet.")}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              {milestones.map((m) => (
                <li key={m}>{m}</li>
              ))}
              {d.effect.rulesImproved.map((r) => (
                <li key={r.id}>{t(`Jadi lolos: ${RULE_ID[r.id]?.id ?? r.title}.`, `Now passes: ${RULE_ID[r.id]?.en ?? r.title}.`)}</li>
              ))}
              {d.effect.verdict.with !== d.effect.verdict.without && (
                <li>
                  {t("Penilaian", "Verdict")}: {VERDICT[d.effect.verdict.without]?.[en ? "en" : "id"]} → {VERDICT[d.effect.verdict.with]?.[en ? "en" : "id"]}
                </li>
              )}
              {endGain > 0 && (
                <li>
                  {t(
                    `Setelah ${d.effect.horizonMonths} bulan, uang kamu sekitar ${formatMoney(endGain, d.currency)} lebih banyak.`,
                    `After ${d.effect.horizonMonths} months you'd have about ${formatMoney(endGain, d.currency)} more.`,
                  )}
                </li>
              )}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!chosen.length && !scenario} onClick={() => onApply(chosen as CutIn[], scenario ? target : null)}>
              {scenario ? t(`Masukkan ke "${scenario.name || "Untitled"}"`, `Add to "${scenario.name || "Untitled"}"`) : t("Buat skenario hemat", "Make a savings scenario")}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {t("Simulasi di bawah ikut berubah. Ini perkiraan dari riwayat kamu, bukan janji.", "The simulation below updates. These are estimates from your history, not promises.")}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function HabitRow({ h, value, onChange }: { h: Habit; value: number | null | undefined; onChange: (v: number | null) => void }) {
  const { en, t } = useCopy();
  const s = h.suggestion!;
  const keep = value === null;
  const current = keep ? "keep" : String(s.target);
  const items = [
    ...s.options.map((o) => ({
      value: String(o.target),
      label: s.unit === "cap" ? targetText(s, o.target, en, o.display) : targetText(s, o.target, en),
      hint: t(`hemat ${o.saving.display}`, `save ${o.saving.display}`),
    })),
    { value: "keep", label: t("Biarkan seperti sekarang", "Keep as it is") },
  ];
  const trend = trendText(h, en);
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{habitName(h, en)}</span>
          {trend && <Badge tone="muted">{trend}</Badge>}
        </div>
        <p className="text-xs tabular-nums text-muted-foreground">
          {frequency(h, en)} · {t("rata-rata", "average")} {h.averageTicket.display} · {h.monthly.display}
          {t(" /bulan", " /month")}
          {h.incomeSharePct !== null && ` (${num(h.incomeSharePct, en)}% ${t("pemasukan", "of income")})`}
        </p>
        {h.topMerchants.length > 0 && <p className="truncate text-xs text-muted-foreground">{h.topMerchants.map((m) => `${m.name} ${m.count}x`).join(", ")}</p>}
      </div>
      <div className="flex items-center gap-3 sm:justify-end">
        <Select
          size="sm"
          className="min-w-0 flex-1 sm:w-64 sm:flex-none"
          aria-label={t(`Target untuk ${habitName(h, en)}`, `Target for ${habitName(h, en)}`)}
          value={current}
          onValueChange={(v) => onChange(v === "keep" ? null : Number(v))}
          items={items}
        />
        <span className={`w-28 shrink-0 text-right text-sm font-semibold tabular-nums ${keep ? "text-muted-foreground" : "text-positive-ink"}`}>
          {keep ? "–" : `+${s.saving.display}`}
        </span>
      </div>
    </li>
  );
}
