// Settings → Billing: the signed-in user's Joyo Pro (plan and until, as JoyoRogo reports it), usage against the Free
// limits, and the way to JoyoRogo, where Joyo Pro is bought and managed. Also the one-line plan summary /pricing shows.

import { Badge } from "@baroka/ui/components/badge";
import { buttonVariants } from "@baroka/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { longDate } from "@/lib/billing";
import { useLang } from "@/lib/lang";
import { orpc } from "@/lib/orpc";
import type { client } from "@/lib/orpc";

export type BillingStatus = Awaited<ReturnType<typeof client.billing.status>>;
type T = <V>(id: V, en: V) => V;

/** One line on what the user has now. */
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

const PLAN_NAME: Record<string, { id: string; en: string }> = {
  monthly: { id: "bulanan", en: "monthly" },
  yearly: { id: "tahunan", en: "yearly" },
  lifetime: { id: "seumur hidup", en: "lifetime" },
};

function planLine(s: BillingStatus, t: T, en: boolean): string {
  const e = s.entitlement;
  const until = e.until ? longDate(e.until, en) : "";
  if (e.source === "selfhost") return t("Server ini tanpa batasan: semua fitur aktif.", "This server has no limits: every feature is on.");
  if (e.source === "grant") return t("Pro, diberikan oleh pengelola.", "Pro, granted by the operator.");
  if (e.source === "joyo") {
    const name = s.joyo?.plan ? PLAN_NAME[s.joyo.plan] : undefined;
    const kind = name ? ` ${en ? name.en : name.id}` : "";
    return until ? t(`Joyo Pro${kind}, aktif sampai ${until}.`, `Joyo Pro${kind}, active until ${until}.`) : t(`Joyo Pro${kind}.`, `Joyo Pro${kind}.`);
  }
  if (e.source === "grandfather") return t(`Pro gratis untuk pengguna awal, sampai ${until}.`, `Free Pro for early users, until ${until}.`);
  if (e.source === "trial") return t(`Masa coba Pro sampai ${until}.`, `Pro trial until ${until}.`);
  return t("Free.", "Free.");
}

export function BillingSettings() {
  const en = useLang() === "en";
  const t: T = (id, eng) => (en ? eng : id);
  const status = useQuery(orpc.billing.status.queryOptions());
  const s = status.data;
  if (status.isError) return null;
  if (!s) return <section className="card h-28" aria-busy />;
  // Self-hosted without billing: nothing to buy, nothing to show.
  if (!s.proUrl) return null;

  const imports = s.usage.statementImports;
  const members = s.usage.members;
  const joyo = s.joyo;
  // Joyo Pro bought in JoyoRogo but not the reason this account is Pro right now (trial or grandfathered is longer).
  const joyoBehind = joyo?.pro && s.entitlement.source !== "joyo";

  return (
    <section className="card space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold tracking-tight">{t("Langganan", "Billing")}</h2>
        <PlanBadge plan={s.plan} />
      </div>
      <p>{planLine(s, t, en)}</p>
      {joyoBehind && joyo && (
        <p className="text-muted-foreground">
          {joyo.until
            ? t(`Joyo Pro-mu di JoyoRogo aktif sampai ${longDate(joyo.until, en)}.`, `Your Joyo Pro in JoyoRogo is active until ${longDate(joyo.until, en)}.`)
            : t("Joyo Pro-mu di JoyoRogo aktif.", "Your Joyo Pro in JoyoRogo is active.")}
        </p>
      )}
      {joyo?.stale && (
        <p className="text-muted-foreground">
          {t("JoyoRogo sedang nggak bisa dihubungi; status di atas dari pengecekan terakhir.", "JoyoRogo can't be reached right now; the status above is from the last check.")}
        </p>
      )}
      <p className="text-muted-foreground">
        {t(
          "Joyo Pro itu satu langganan per akun, berlaku di JoyoArto, JoyoRogo dan JoyoFit. Beli dan kelola di JoyoRogo dengan akun Google yang sama; di sini Pro aktif dalam beberapa menit. Anggota rumah tangga lain punya paketnya sendiri.",
          "Joyo Pro is one subscription per account, valid in JoyoArto, JoyoRogo and JoyoFit. Buy and manage it in JoyoRogo with the same Google account; it shows up here within minutes. Other household members have their own plan.",
        )}
      </p>

      {s.plan === "free" && (
        <ul className="space-y-1 text-muted-foreground">
          {imports.limit !== null && (
            <li>{t(`Import statement-mu bulan ini: ${imports.used} dari ${imports.limit}`, `Your statement imports this month: ${imports.used} of ${imports.limit}`)}</li>
          )}
          <li>{t(`Anggota (termasuk undangan): ${members.used} dari ${members.limit}`, `Members (invites included): ${members.used} of ${members.limit}`)}</li>
          <li>{t(`Joyo AI: ${s.limits.aiDailyCap} pertanyaan sehari`, `Joyo AI: ${s.limits.aiDailyCap} questions a day`)}</li>
        </ul>
      )}

      <a href={s.proUrl} target="_blank" rel="noopener" className={buttonVariants({ size: "sm", variant: joyo?.pro ? "secondary" : "default" })}>
        {joyo?.pro ? t("Kelola di JoyoRogo", "Manage in JoyoRogo") : t("Beli Joyo Pro di JoyoRogo", "Get Joyo Pro in JoyoRogo")} <ExternalLink aria-hidden />
      </a>
    </section>
  );
}
