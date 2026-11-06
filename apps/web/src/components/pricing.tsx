// Free vs Joyo Pro, shared by the landing page and /pricing. Limits come from this server (billing.pricing); prices are
// JoyoRogo's, read from its public config at runtime, so they never drift. Joyo Pro is one subscription per account,
// bought in JoyoRogo with the same Google account, and it unlocks Pro in JoyoRogo, JoyoFit and JoyoArto.

import { Badge } from "@baroka/ui/components/badge";
import { buttonVariants } from "@baroka/ui/components/button";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { cn } from "@baroka/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Minus } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { rupiah, usd } from "@/lib/billing";
import { client, orpc } from "@/lib/orpc";

export type Interval = "monthly" | "yearly";
type T = <V>(id: V, en: V) => V;
export type Pricing = Awaited<ReturnType<typeof client.billing.pricing>>;

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
          {v === "monthly" ? t("Bulanan", "Monthly") : t("Tahunan (lebih hemat)", "Yearly (saves more)")}
        </button>
      ))}
    </div>
  );
}

/** The button to JoyoRogo's Pro checkout (opens JoyoRogo; same Google account). */
export function BuyInJoyoRogo({ href, t, label, className }: { href: string; t: T; label?: string; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener" className={buttonVariants({ className: cn("w-full", className) })}>
      {label ?? t("Beli Joyo Pro di JoyoRogo", "Get Joyo Pro in JoyoRogo")} <ExternalLink aria-hidden />
    </a>
  );
}

/** "Rp 15.000/bulan" etc. for the chosen period, and the promo line, from JoyoRogo's prices. */
function ProPrice({ p, interval, t }: { p: Pricing; interval: Interval; t: T }) {
  const per = interval === "monthly" ? t("/bulan", "/month") : t("/tahun", "/year");
  if (!p.prices) {
    return <p className="mt-1 text-sm text-muted-foreground">{t("Harga terbaru ada di halaman Pro JoyoRogo.", "Current prices are on JoyoRogo's Pro page.")}</p>;
  }
  const { idr, promo, usdCents } = p.prices;
  const left = promo ? promo.slots - promo.taken : 0;
  return (
    <>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-3xl font-extrabold tracking-tight tabular-nums">{rupiah(idr[interval])}</span>
        <span className="text-sm text-muted-foreground">{per}</span>
      </p>
      {interval === "yearly" && (
        <p className="text-sm text-muted-foreground tabular-nums">{t(`Setara ${rupiah(Math.round(idr.yearly / 12))} sebulan.`, `About ${rupiah(Math.round(idr.yearly / 12))} a month.`)}</p>
      )}
      {promo && left > 0 && (
        <p className="mt-2 text-sm">
          <Badge tone="warning">{t("Harga perkenalan", "Intro price")}</Badge>{" "}
          {promo.nextPriceIdr
            ? t(`Sisa ${left} slot di harga ini, lalu ${rupiah(promo.nextPriceIdr)}/bulan.`, `${left} slots left at this price, then ${rupiah(promo.nextPriceIdr)}/month.`)
            : t(`Sisa ${left} slot di harga ini.`, `${left} slots left at this price.`)}{" "}
          {t("Yang sudah bayar tetap di harganya saat perpanjang.", "Buyers keep their price when they renew.")}
        </p>
      )}
      {usdCents && (
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Di luar Indonesia:", "Outside Indonesia:")} {usd(usdCents[interval])}
          {per} {t("dengan kartu.", "by card.")}
        </p>
      )}
    </>
  );
}

/**
 * Free and Joyo Pro side by side. `action` renders the Pro card's button (sign in, or buy in JoyoRogo); by default the
 * link to JoyoRogo's checkout. Renders nothing on a server without billing (self-hosts give everyone Pro).
 */
export function PricingPlans({ t, action, freeAction }: { t: T; action?: (p: Pricing) => ReactNode; freeAction?: ReactNode }) {
  const pricing = usePricing();
  const [interval, setInterval] = useState<Interval>("yearly");
  const p = pricing.data;
  if (pricing.isPending) return <Skeleton className="h-96 rounded-3xl" />;
  if (!p?.available || !p.proUrl) return null;
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
    { label: t("Foto struk dibaca AI per hari", "Receipt photos read by AI a day"), free: String(free.receiptScansPerDay ?? 0), pro: pro.receiptScansPerDay === null ? t("Sampai batas harian server", "Up to the daily limit") : String(pro.receiptScansPerDay) },
    {
      label: t("Laporan klaim reimburse (PDF + foto struk)", "Reimbursement claim reports (PDF + receipts)"),
      free: t(`${free.claimReportsPerMonth ?? 0} per bulan`, `${free.claimReportsPerMonth ?? 0} a month`),
      pro: t("Tanpa batas", "Unlimited"),
    },
    { label: t("Anggota rumah tangga yang kamu undang", "Household members you invite"), free: String(free.members), pro: String(pro.members) },
    { label: t("Simpan skenario Rencana & simulasi", "Saved Plan & simulate scenarios"), free: false, pro: true },
    { label: t("Konektor Claude (claude.ai, Desktop, Code)", "Claude connector (claude.ai, Desktop, Code)"), free: t("Baca dan tanya", "Read and ask"), pro: t("Baca, catat dan ubah", "Read, add and change") },
    { label: t("Pro di JoyoRogo dan JoyoFit juga", "Pro in JoyoRogo and JoyoFit too"), free: false, pro: true },
  ];
  const cell = (v: ReactNode) =>
    v === true ? (
      <Check className="size-4 text-positive" aria-label={t("Ya", "Yes")} />
    ) : v === false ? (
      <Minus className="size-4 text-muted-foreground" aria-label={t("Tidak", "No")} />
    ) : (
      <span className="font-semibold">{v}</span>
    );

  return (
    <div className="space-y-5">
      {p.prices && <IntervalSwitch value={interval} onChange={setInterval} t={t} />}
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
          <h3 className="text-lg font-bold tracking-tight">Joyo Pro</h3>
          <ProPrice p={p} interval={interval} t={t} />
          <p className="mt-2 text-sm text-muted-foreground">
            {t(
              "Satu langganan untuk akunmu, berlaku di JoyoArto, JoyoRogo dan JoyoFit. Dibeli di JoyoRogo dengan akun Google yang sama.",
              "One subscription for your account, valid in JoyoArto, JoyoRogo and JoyoFit. Bought in JoyoRogo with the same Google account.",
            )}
          </p>
          <ul className="mt-5 flex-1 space-y-2.5 text-sm">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span>{r.label}</span>
                {cell(r.pro)}
              </li>
            ))}
          </ul>
          <div className="mt-6 space-y-2">{action ? action(p) : <BuyInJoyoRogo href={p.proUrl} t={t} />}</div>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {p.trialDays > 0 && `${t(`Akun baru dapat ${p.trialDays} hari Pro gratis di JoyoArto.`, `New accounts get ${p.trialDays} days of Pro free in JoyoArto.`)} `}
        {t(
          "Pembayaran diproses JoyoRogo, dengan cara bayar yang tersedia di sana; JoyoArto tidak menerima pembayaran sendiri. Pro berlaku per akun: anggota rumah tangga lain perlu Pro sendiri untuk batas Pro. JoyoArto open source (AGPL): mau host sendiri, semuanya gratis.",
          "Payments are processed by JoyoRogo, with the payment methods it offers; JoyoArto takes no payments itself. Pro is per account: other household members need their own Pro for Pro limits. JoyoArto is open source (AGPL): self-host it and everything is free.",
        )}
      </p>
    </div>
  );
}
