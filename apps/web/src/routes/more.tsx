import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import { BriefcaseBusiness, ChartNoAxesCombined, ChevronRight, ExternalLink, FileDown, LogOut, Settings, ShieldCheck, Smartphone, Sparkles, WalletCards } from "lucide-react";
import type { ComponentType } from "react";

import { Avatar } from "@/components/avatar";
import { PageHeader, ThemeSwitch } from "@/components/kit";
import { ANDROID_SECTION_ID } from "@/lib/app-links";
import { requireSession, signOut } from "@/lib/auth";
import { SITE_URL } from "@/lib/brand";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/more")({ beforeLoad: requireSession, component: More });

type Item = { to: LinkProps["to"]; label: string; hint: string; Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> };

/** What the phone tab bar has no room for, in the order people look for it. */
const ITEMS: Item[] = [
  { to: "/plan", label: "Plan", hint: "Can we afford it? Car, baby, saved scenarios", Icon: ChartNoAxesCombined },
  { to: "/reimburse", label: "Reimburse", hint: "Diganti kantor: work expenses, claim reports with receipts", Icon: BriefcaseBusiness },
  { to: "/import", label: "Import", hint: "Statements: Jago, GoPay, CSV, by email", Icon: FileDown },
  { to: "/accounts", label: "Accounts", hint: "Add, archive, undo imports", Icon: WalletCards },
  { to: "/joyo", label: "Joyo AI", hint: "Ask about your money; your own API key", Icon: Sparkles },
  { to: "/settings", label: "Settings", hint: "Household, members, tokens, data & privacy", Icon: Settings },
  { to: "/privasi", label: "Privacy policy", hint: "What JoyoArto stores and shares", Icon: ShieldCheck },
];

/** The two tester steps live on the public landing page (lib/app-links.ts). */
const ANDROID_STEPS_URL = `${SITE_URL}/#${ANDROID_SECTION_ID}`;

const ROW = "flex min-h-16 items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none";

function More() {
  const me = useQuery(orpc.me.queryOptions());
  return (
    <div className="space-y-5">
      <PageHeader title="More" />
      <Link to="/settings" className="card flex items-center gap-4 transition-colors hover:bg-muted/60">
        <Avatar name={me.data?.user.name} image={me.data?.user.image} className="size-12 text-sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{me.data?.user.name ?? "…"}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {me.data ? `${me.data.user.email} · ${me.data.household.name}` : ""}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground/70" />
      </Link>
      {me.data?.demo && (
        <p className="rounded-2xl bg-warning-soft p-4 text-sm text-warning-ink">
          This is the demo account: the data is made up and resets every day. Inviting people, deleting the account and
          long-lived tokens are off.
        </p>
      )}
      <nav aria-label="More" className="card divide-y divide-border overflow-hidden p-0">
        {ITEMS.map(({ to, label, hint, Icon }) => (
          <Link key={label} to={to} className={ROW}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-ink">
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
            <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground/70" />
          </Link>
        ))}
        <a href={ANDROID_STEPS_URL} target="_blank" rel="noopener" className={ROW}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-ink">
            <Smartphone className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Pasang di Android</span>
            <span className="block text-xs text-muted-foreground">Join the testers' group, then install from Google Play. iPhone: soon</span>
          </span>
          <ExternalLink aria-hidden className="size-5 shrink-0 text-muted-foreground/70" />
        </a>
      </nav>
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold">Appearance</span>
        <ThemeSwitch />
      </section>
      <button
        type="button"
        onClick={() => void signOut()}
        className="card flex w-full items-center gap-4 text-left font-semibold text-destructive transition-colors hover:bg-muted/60"
      >
        <LogOut className="size-5" aria-hidden /> Sign out
      </button>
    </div>
  );
}
