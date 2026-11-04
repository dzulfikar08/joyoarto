// The upgrade prompt: opened by any call that hits a Free limit (lib/orpc.ts), or by a page that knows ahead of time.

import { buttonVariants } from "@baroka/ui/components/button";
import { Sheet } from "@baroka/ui/components/sheet";
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

import { closeUpgrade, upgradeCopy, useUpgradePrompt } from "@/lib/billing";
import type { UpgradeFeature } from "@/lib/billing";
import { useLang } from "@/lib/lang";

export function UpgradeSheet() {
  const feature = useUpgradePrompt();
  const en = useLang() === "en";
  const t = <V,>(id: V, eng: V) => (en ? eng : id);
  const copy = feature ? upgradeCopy(feature, t) : null;
  return (
    <Sheet open={!!feature} onOpenChange={(open) => !open && closeUpgrade()} title={copy?.title ?? ""} description={copy?.body} closeLabel={t("Tutup", "Close")}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t(
            "Joyo Pro itu satu langganan per akun, berlaku di JoyoArto, JoyoRogo dan JoyoFit. Dibeli di JoyoRogo dengan akun Google yang sama.",
            "Joyo Pro is one subscription per account, valid in JoyoArto, JoyoRogo and JoyoFit. You buy it in JoyoRogo with the same Google account.",
          )}
        </p>
        <Link to="/pricing" onClick={() => closeUpgrade()} className={buttonVariants({ className: "w-full" })}>
          <Sparkles aria-hidden /> {t("Lihat Joyo Pro", "See Joyo Pro")}
        </Link>
      </div>
    </Sheet>
  );
}

/** Inline notice for a page that already knows a feature is Pro (email import, the Claude connector). */
export function ProNotice({ feature, className }: { feature: UpgradeFeature; className?: string }) {
  const en = useLang() === "en";
  const t = <V,>(id: V, eng: V) => (en ? eng : id);
  const copy = upgradeCopy(feature, t);
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-2xl bg-primary-soft p-3 text-sm text-primary-ink ${className ?? ""}`}>
      <Sparkles className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{copy.title}</span>
      <Link to="/pricing" className={buttonVariants({ size: "sm" })}>
        {t("Upgrade", "Upgrade")}
      </Link>
    </div>
  );
}
