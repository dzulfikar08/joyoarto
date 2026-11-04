import { Button, buttonVariants } from "@baroka/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { PageHeader } from "@/components/kit";
import { PricingPlans } from "@/components/pricing";
import type { Interval } from "@/components/pricing";
import { PublicFooter, PublicHeader } from "@/components/public";
import { sessionQuery } from "@/lib/auth";
import { longDate } from "@/lib/billing";

import { CurrentPlan } from "./-billing";
import { useLang } from "@/lib/lang";
import { client, errorMessage, orpc } from "@/lib/orpc";

// Public: visitors see the plans and sign in to buy; members see their plan and check out for the household.
export const Route = createFileRoute("/pricing")({ component: Pricing });

function Pricing() {
  const { data: session, isPending } = useQuery(sessionQuery);
  const en = useLang() === "en";
  const t = <V,>(id: V, eng: V) => (en ? eng : id);
  if (isPending) return null;
  if (!session) {
    return (
      <div className="min-h-dvh">
        <PublicHeader />
        <main className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:py-16">
          <PageHeader title={t("Harga JoyoArto", "JoyoArto pricing")} subtitle={t("Gratis untuk mulai. Pro untuk seluruh rumah tangga.", "Free to start. Pro for the whole household.")} />
          <PricingPlans
            t={t}
            action={() => (
              <Link to="/login" search={{ redirect: "/pricing" }} className={buttonVariants({ className: "w-full" })}>
                {t("Masuk untuk upgrade", "Sign in to upgrade")}
              </Link>
            )}
            freeAction={
              <Link to="/login" search={{ redirect: "/" }} className={buttonVariants({ variant: "secondary", className: "w-full" })}>
                {t("Mulai gratis", "Start free")}
              </Link>
            }
          />
        </main>
        <PublicFooter />
      </div>
    );
  }
  return <MemberPricing t={t} en={en} />;
}

/** Signed in: the household's plan on top, then the plans with checkout buttons. */
function MemberPricing({ t, en }: { t: <V>(id: V, en: V) => V; en: boolean }) {
  const status = useQuery(orpc.billing.status.queryOptions());
  const doku = useMutation({
    mutationFn: (interval: Interval) => client.billing.checkout({ interval }),
    onSuccess: (r) => window.location.assign(r.paymentUrl),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const polar = useMutation({
    mutationFn: (interval: Interval) => client.billing.polarCheckout({ interval }),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = status.data;
  const busy = doku.isPending || polar.isPending;
  const cardSubscription = s?.polarSubscription === "active" || s?.polarSubscription === "past_due";
  return (
    <div className="space-y-6">
      <PageHeader title={t("Paket", "Plans")} subtitle={t("Pro dibeli untuk rumah tangga: semua anggota ikut Pro.", "Pro is bought for the household: every member gets it.")} />
      {s && <CurrentPlan s={s} t={t} en={en} />}
      {s && !s.enforced && s.entitlement.source === "selfhost" ? null : (
        <PricingPlans
          t={t}
          action={(interval) =>
            cardSubscription ? (
              <p className="text-sm text-muted-foreground">{t("Rumah tangga ini sudah berlangganan lewat kartu. Kelola di Pengaturan → Langganan.", "This household has a card subscription. Manage it in Settings → Billing.")}</p>
            ) : (
              <>
                {s?.checkout.doku && (
                  <Button className="w-full" disabled={busy} onClick={() => doku.mutate(interval)}>
                    {doku.isPending ? t("Membuka pembayaran…", "Opening payment…") : t("Bayar: QRIS, e-wallet, VA", "Pay: QRIS, e-wallet, VA")}
                  </Button>
                )}
                {s?.checkout.polar && (
                  <Button className="w-full" variant="secondary" disabled={busy} onClick={() => polar.mutate(interval)}>
                    {polar.isPending ? t("Membuka checkout…", "Opening checkout…") : t("Kartu luar negeri (USD, otomatis diperpanjang)", "Card from abroad (USD, renews automatically)")}
                  </Button>
                )}
                {s?.freeTimeEnd && s.checkout.doku && (
                  <p className="text-xs text-muted-foreground">
                    {t(`Masa Pro gratismu sampai ${longDate(s.freeTimeEnd, en)}; bulan yang dibayar dimulai setelahnya.`, `Your free Pro lasts until ${longDate(s.freeTimeEnd, en)}; paid months start after it.`)}
                  </p>
                )}
              </>
            )
          }
        />
      )}
    </div>
  );
}
