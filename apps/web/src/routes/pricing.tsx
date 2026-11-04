import { buttonVariants } from "@baroka/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/kit";
import { BuyInJoyoRogo, PricingPlans } from "@/components/pricing";
import { PublicFooter, PublicHeader } from "@/components/public";
import { sessionQuery } from "@/lib/auth";
import { useLang } from "@/lib/lang";
import { orpc } from "@/lib/orpc";

import { CurrentPlan } from "./-billing";

// Public: Free vs Joyo Pro. Joyo Pro is bought in JoyoRogo (same Google account); this page only explains and links.
export const Route = createFileRoute("/pricing")({ component: Pricing });

function Pricing() {
  const { data: session, isPending } = useQuery(sessionQuery);
  const en = useLang() === "en";
  const t = <V,>(id: V, eng: V) => (en ? eng : id);
  if (isPending) return null;
  const subtitle = t(
    "Gratis untuk mulai. Joyo Pro: satu langganan untuk JoyoArto, JoyoRogo dan JoyoFit.",
    "Free to start. Joyo Pro: one subscription for JoyoArto, JoyoRogo and JoyoFit.",
  );
  if (!session) {
    return (
      <div className="min-h-dvh">
        <PublicHeader />
        <main className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:py-16">
          <PageHeader title={t("Harga JoyoArto", "JoyoArto pricing")} subtitle={subtitle} />
          <PricingPlans
            t={t}
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
  return <MemberPricing t={t} en={en} subtitle={subtitle} />;
}

/** Signed in: the user's plan on top, then the plans with the way to JoyoRogo. */
function MemberPricing({ t, en, subtitle }: { t: <V>(id: V, en: V) => V; en: boolean; subtitle: string }) {
  const status = useQuery(orpc.billing.status.queryOptions());
  const s = status.data;
  return (
    <div className="space-y-6">
      <PageHeader title={t("Paket", "Plans")} subtitle={subtitle} />
      {s && <CurrentPlan s={s} t={t} en={en} />}
      {s && !s.proUrl ? null : (
        <PricingPlans
          t={t}
          action={(p) =>
            p.proUrl && (
              <>
                <BuyInJoyoRogo href={p.proUrl} t={t} label={s?.joyo?.pro ? t("Kelola di JoyoRogo", "Manage in JoyoRogo") : undefined} />
                <p className="text-xs text-muted-foreground">
                  {t(
                    "Masuk ke JoyoRogo dengan akun Google yang sama dengan JoyoArto. Setelah bayar, Pro aktif di sini dalam beberapa menit.",
                    "Sign in to JoyoRogo with the same Google account as JoyoArto. After paying, Pro shows up here within minutes.",
                  )}
                </p>
              </>
            )
          }
        />
      )}
    </div>
  );
}
