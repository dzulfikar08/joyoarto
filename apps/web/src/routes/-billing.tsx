// Settings → Billing: the household's plan and renewal, usage against the Free limits, upgrade or the card portal, and
// orders. Also the one-line plan summary /pricing shows.

import { Badge } from "@baroka/ui/components/badge";
import { Button, buttonVariants } from "@baroka/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { longDate } from "@/lib/billing";
import { useLang } from "@/lib/lang";
import { client, errorMessage, orpc } from "@/lib/orpc";

export type BillingStatus = Awaited<ReturnType<typeof client.billing.status>>;
type T = <V>(id: V, en: V) => V;

/** One line on what the household has now. */
export function CurrentPlan({ s, t, en }: { s: BillingStatus; t: T; en: boolean }) {
  return (
    <section className="card flex flex-wrap items-center gap-3 text-sm">
      <PlanBadge plan={s.plan} />
      <span className="min-w-0 flex-1">{planLine(s, t, en)}</span>
    </section>
  );
}

function PlanBadge({ plan }: { plan: "free" | "pro" }) {
  return <Badge tone={plan === "pro" ? "primary" : "muted"}>{plan === "pro" ? "Pro" : "Free"}</Badge>;
}

function planLine(s: BillingStatus, t: T, en: boolean): string {
  const e = s.entitlement;
  const until = e.periodEnd ? longDate(e.periodEnd, en) : "";
  if (e.source === "selfhost") return t("Server ini tanpa batasan: semua fitur aktif.", "This server has no limits: every feature is on.");
  if (e.source === "grant") return t("Pro, diberikan oleh pengelola.", "Pro, granted by the operator.");
  if (e.source === "grandfather") return t(`Pro gratis untuk pengguna awal, sampai ${until}.`, `Free Pro for early users, until ${until}.`);
  if (e.source === "trial") return t(`Masa coba Pro sampai ${until}.`, `Pro trial until ${until}.`);
  if (e.plan === "pro" && e.status === "past_due") return t("Pro, tapi perpanjangan gagal dibayar. Perbarui kartu di portal.", "Pro, but the renewal payment failed. Update the card in the portal.");
  if (e.plan === "pro" && (e.cancelAtPeriodEnd || e.provider === "doku" || e.provider === "manual")) return t(`Pro sampai ${until}.`, `Pro until ${until}.`);
  if (e.plan === "pro") return t(`Pro, diperpanjang otomatis ${until}.`, `Pro, renews ${until}.`);
  if (e.status === "free") return t("Free.", "Free.");
  return t(`Free. Pro berakhir ${until}.`, `Free. Pro ended ${until}.`);
}

const ORDER_STATUS: Record<string, { id: string; en: string; tone: "positive" | "warning" | "destructive" | "muted" }> = {
  paid: { id: "Lunas", en: "Paid", tone: "positive" },
  pending: { id: "Menunggu", en: "Pending", tone: "warning" },
  failed: { id: "Batal", en: "Not paid", tone: "muted" },
  refunded: { id: "Dikembalikan", en: "Refunded", tone: "destructive" },
};

export function BillingSettings() {
  const en = useLang() === "en";
  const t: T = (id, eng) => (en ? eng : id);
  const status = useQuery(orpc.billing.status.queryOptions());
  const portal = useMutation({
    mutationFn: () => client.billing.portal(),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = status.data;
  if (status.isError) return null;
  if (!s) return <section className="card h-28" aria-busy />;
  // Self-hosted without billing: nothing to buy, nothing to show.
  if (!s.enforced && s.entitlement.source === "selfhost" && !s.orders.length) return null;

  const imports = s.usage.statementImports;
  const members = s.usage.members;
  const paidRenewing = s.entitlement.source === "subscription" && s.entitlement.provider === "polar";
  const prepaid = s.entitlement.source === "subscription" && (s.entitlement.provider === "doku" || s.entitlement.provider === "manual");

  return (
    <section className="card space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold tracking-tight">{t("Langganan", "Billing")}</h2>
        <PlanBadge plan={s.plan} />
      </div>
      <p>{planLine(s, t, en)}</p>
      <p className="text-muted-foreground">{t("Pro berlaku untuk seluruh rumah tangga ini, jadi semua anggota ikut Pro.", "Pro covers this whole household, so every member gets it.")}</p>

      {s.plan === "free" && (
        <ul className="space-y-1 text-muted-foreground">
          {imports.limit !== null && (
            <li>
              {t(`Import statement bulan ini: ${imports.used} dari ${imports.limit}`, `Statement imports this month: ${imports.used} of ${imports.limit}`)}
            </li>
          )}
          <li>{t(`Anggota (termasuk undangan): ${members.used} dari ${members.limit}`, `Members (invites included): ${members.used} of ${members.limit}`)}</li>
          <li>{t(`Joyo AI: ${s.limits.aiDailyCap} pertanyaan sehari`, `Joyo AI: ${s.limits.aiDailyCap} questions a day`)}</li>
        </ul>
      )}

      {s.pendingOrder && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-warning-soft p-3 text-warning-ink">
          <span className="min-w-0 flex-1">{t(`Ada pembayaran ${s.pendingOrder.display} yang belum selesai.`, `A ${s.pendingOrder.display} payment is not finished yet.`)}</span>
          <Link to="/payment" search={{ order: s.pendingOrder.id }} className={buttonVariants({ size: "sm", variant: "secondary", className: "bg-card" })}>
            {t("Cek pembayaran", "Check payment")}
          </Link>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(s.checkout.doku || s.checkout.polar) && !paidRenewing && (
          <Link to="/pricing" className={buttonVariants({ size: "sm" })}>
            {s.plan === "pro" && prepaid ? t("Perpanjang", "Renew") : s.plan === "pro" && s.entitlement.source === "subscription" ? t("Lihat paket", "See plans") : t("Upgrade ke Pro", "Upgrade to Pro")}
          </Link>
        )}
        {s.polarSubscription && s.checkout.polar && (
          <Button size="sm" variant="secondary" disabled={portal.isPending} onClick={() => portal.mutate()}>
            {portal.isPending ? t("Membuka…", "Opening…") : t("Kelola langganan kartu (batal, invoice)", "Manage card subscription (cancel, invoices)")}
          </Button>
        )}
      </div>
      {prepaid && (
        <p className="text-xs text-muted-foreground">
          {t(
            "Pembayaran QRIS/e-wallet/VA itu prabayar: nggak diperpanjang otomatis, jadi nggak perlu dibatalkan. Perpanjang kapan saja; waktunya ditambahkan setelah masa yang ada.",
            "QRIS/e-wallet/VA payments are prepaid: nothing renews by itself, so there is nothing to cancel. Renew any time; the time is added after what you have.",
          )}
        </p>
      )}

      {!!s.orders.length && (
        <div className="space-y-1">
          <div className="label">{t("Riwayat pembayaran", "Orders")}</div>
          <ul className="divide-y divide-border">
            {s.orders.map((o) => {
              const st = ORDER_STATUS[o.status] ?? { id: o.status, en: o.status, tone: "muted" as const };
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="font-semibold tabular-nums">{o.display}</span>
                  <span className="text-muted-foreground">
                    {o.interval === "yearly" ? t("1 tahun", "1 year") : t("1 bulan", "1 month")} · {o.provider === "doku" ? "QRIS/e-wallet/VA" : o.provider === "polar" ? t("Kartu (USD)", "Card (USD)") : o.provider}
                  </span>
                  {o.isTest && <Badge tone="warning">sandbox</Badge>}
                  <Badge tone={st.tone}>{en ? st.en : st.id}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">{longDate(o.paidAt ?? o.createdAt, en)}</span>
                  <code className="basis-full text-[11px] text-muted-foreground">{o.id}</code>
                </li>
              );
            })}
          </ul>
          {s.polarSubscription && <p className="text-xs text-muted-foreground">{t("Invoice kartu ada di portal langganan.", "Card invoices are in the subscription portal.")}</p>}
        </div>
      )}
    </section>
  );
}
