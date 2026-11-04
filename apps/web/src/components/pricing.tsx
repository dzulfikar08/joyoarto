// Free vs Pro cards, shared by the landing page and /pricing. Prices and limits come from the server
// (billing.pricing), so a change in wrangler vars or lib/billing/plans.ts shows up here without a web deploy.

import { Badge } from "@baroka/ui/components/badge";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { cn } from "@baroka/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { rupiah, usd } from "@/lib/billing";
import { orpc } from "@/lib/orpc";

export type Interval = "monthly" | "yearly";
type T = <V>(id: V, en: V) => V;

export function usePricing() {
  return useQuery({ ...orpc.billing.pricing.queryOptions(), staleTime: 5 * 60_000 });
}

export function IntervalSwitch({ value, onChange, t }: { value: Interval; onChange: (v: Interval) => void; t: T }) {
  return (
    <div role="radiogroup" aria-label={t("Periode", "Billing period")} className="inline-flex rounded-full bg-muted p-1 text-sm">
      {(["monthly", "yearly"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "h-8 rounded-full px-3.5 font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
            value === v ? "bg-segment text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v === "monthly" ? t("Bulanan", "Monthly") : t("Tahunan (2 bulan gratis)", "Yearly (2 months free)")}
        </button>
      ))}
    </div>
  );
}

/**
 * The two plans side by side. `action` renders the Pro card's button(s) for the chosen period: sign in, or checkout.
 * Renders nothing on a server without billing (self-hosts give everyone Pro).
 */
export function PricingPlans({ t, action, freeAction }: { t: T; action: (interval: Interval) => ReactNode; freeAction?: ReactNode }) {
  const pricing = usePricing();
  const [interval, setInterval] = useState<Interval>("monthly");
  const p = pricing.data;
  if (pricing.isPending) return <Skeleton className="h-96 rounded-3xl" />;
  if (!p?.available || !p.priceIdr) return null;
  const founder = p.founder && p.founder.slotsLeft > 0 ? p.founder : null;
  const price = founder ? founder.priceIdr[interval] : p.priceIdr[interval];
  const per = interval === "monthly" ? t("/bulan", "/month") : t("/tahun", "/year");
  const free = p.limits.free;
  const pro = p.limits.pro;

  const rows: { label: ReactNode; free: ReactNode; pro: ReactNode }[] = [
    { label: t("Catat manual, quick add & import CSV", "Manual entries, quick add & CSV import"), free: true, pro: true },
    {
      label: t("Import statement (Jago, GoPay)", "Statement imports (Jago, GoPay)"),
      free: t(`${free.statementImportsPerMonth} per bulan`, `${free.statementImportsPerMonth} a month`),
      pro: t("Tanpa batas", "Unlimited"),
    },
    { label: t("Banyak statement sekaligus, kirim lewat email, share dari HP", "Bulk import, email-in, share-to-app"), free: false, pro: true },
    { label: t("Pertanyaan Joyo AI per hari", "Joyo AI questions a day"), free: String(free.aiDailyCap ?? 0), pro: String(pro.aiDailyCap ?? 0) },
    { label: t("Anggota rumah tangga", "Household members"), free: String(free.members), pro: String(pro.members) },
    { label: t("Simpan skenario Rencana & simulasi", "Saved Plan & simulate scenarios"), free: false, pro: true },
    { label: t("Konektor Claude (claude.ai, Desktop, Code)", "Claude connector (claude.ai, Desktop, Code)"), free: false, pro: true },
  ];
  const cell = (v: ReactNode) =>
    v === true ? <Check className="size-4 text-positive" aria-label={t("Ya", "Yes")} /> : v === false ? <Minus className="size-4 text-muted-foreground" aria-label={t("Tidak", "No")} /> : <span className="font-semibold">{v}</span>;

  return (
    <div className="space-y-5">
      <IntervalSwitch value={interval} onChange={setInterval} t={t} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col rounded-3xl bg-card p-6">
          <h3 className="text-lg font-bold tracking-tight">Free</h3>
          <p className="mt-1 text-3xl font-extrabold tracking-tight">Rp 0</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("Untuk mulai rapi, selamanya gratis.", "To get organised, free forever.")}</p>
          <ul className="mt-5 flex-1 space-y-2.5 text-sm">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className={cn(r.free === false && "text-muted-foreground")}>{r.label}</span>
                {cell(r.free)}
              </li>
            ))}
          </ul>
          {freeAction && <div className="mt-6">{freeAction}</div>}
        </div>
        <div className="flex flex-col rounded-3xl bg-card p-6 ring-2 ring-primary">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold tracking-tight">Pro</h3>
            {founder && <Badge tone="warning">{t(`Harga founder · sisa ${founder.slotsLeft}`, `Founder price · ${founder.slotsLeft} left`)}</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-3xl font-extrabold tracking-tight">{rupiah(price)}</span>
            <span className="text-sm text-muted-foreground">{per}</span>
            {founder && <span className="text-sm text-muted-foreground line-through">{rupiah(p.priceIdr[interval])}</span>}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Satu langganan untuk seluruh rumah tangga.", "One plan for the whole household.")}
            {p.usdCents && ` ${t("Kartu luar negeri:", "Cards from abroad:")} ${usd(p.usdCents[interval])}${per}.`}
          </p>
          <ul className="mt-5 flex-1 space-y-2.5 text-sm">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span>{r.label}</span>
                {cell(r.pro)}
              </li>
            ))}
          </ul>
          <div className="mt-6 space-y-2">{action(interval)}</div>
          {founder && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("Harga founder berlaku seterusnya untuk rumah tangga yang membeli sekarang.", "Households that buy now keep the founder price on renewal.")}
            </p>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {p.trialDays > 0 && `${t(`Rumah tangga baru dapat ${p.trialDays} hari Pro gratis.`, `New households get ${p.trialDays} days of Pro free.`)} `}
        {t(
          "Bayar per bulan atau per tahun pakai QRIS, e-wallet atau virtual account; nggak diperpanjang otomatis. JoyoArto open source (AGPL): mau host sendiri, semuanya gratis.",
          "Pay per month or per year with QRIS, e-wallets or a virtual account; it never renews by itself. JoyoArto is open source (AGPL): self-host it and everything is free.",
        )}
      </p>
    </div>
  );
}
