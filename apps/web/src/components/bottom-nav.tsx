// Ported from JoyoRogo apps/web/src/components/bottom-nav.tsx: the phone tab bar with a centre action and the desktop
// top bar. JoyoArto floats the phone bar as a pill above the bottom edge (safe-area aware) and the centre button opens
// the add-transaction sheet instead of a camera.

import { cn } from "@baroka/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Ellipsis, House, Plus, ReceiptText, Sparkles } from "lucide-react";
import type { ComponentType } from "react";

import { Avatar } from "@/components/avatar";
import { Wordmark } from "@/components/kit";
import { openAddSheet } from "@/lib/add-sheet";
import { signOut } from "@/lib/auth";
import { orpc } from "@/lib/orpc";

type Tab = { to: "/" | "/transactions" | "/joyo" | "/more"; label: string; Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> };

/**
 * Phone IA: the two things done daily (see the month, find a transaction) and the two ways in (add, ask Joyo) are one
 * tap away; Plan, Import, Accounts and Settings are used weekly or monthly and live under More.
 */
const TABS: readonly Tab[] = [
  { to: "/", label: "Home", Icon: House },
  { to: "/transactions", label: "Transactions", Icon: ReceiptText },
  { to: "/joyo", label: "Joyo AI", Icon: Sparkles },
  { to: "/more", label: "More", Icon: Ellipsis },
];

/** Pages a tab stands for besides its own. */
const TAB_GROUPS: Partial<Record<Tab["to"], readonly string[]>> = {
  "/more": ["/more", "/plan", "/import", "/accounts", "/settings"],
};

function isActive(pathname: string, to: Tab["to"]): boolean {
  if (to === "/") return pathname === "/";
  const group = TAB_GROUPS[to] ?? [to];
  return group.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function TabLink({ to, label, Icon, active }: Tab & { active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-full text-[0.6875rem] font-semibold transition-colors focus-visible:outline-none",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-12 items-center justify-center rounded-full transition-colors group-focus-visible:ring-[3px] group-focus-visible:ring-ring/40",
          active && "bg-primary-soft text-primary-ink",
        )}
      >
        <Icon className={cn("size-[1.3rem]", active && "stroke-[2.3]")} aria-hidden />
      </span>
      {label}
    </Link>
  );
}

/** The floating phone tab bar (below `sm`). The page reserves {@link BOTTOM_NAV_SPACE} so nothing hides under it. */
export default function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-label="Main"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-[max(0.75rem,env(safe-area-inset-left))] pb-[calc(0.625rem+env(safe-area-inset-bottom))] sm:hidden"
    >
      <ul className="pointer-events-auto mx-auto grid max-w-md grid-cols-5 items-center rounded-full border border-border/70 bg-card/95 px-1.5 shadow-float backdrop-blur-md">
        {TABS.slice(0, 2).map((tab) => (
          <li key={tab.to}>
            <TabLink {...tab} active={isActive(pathname, tab.to)} />
          </li>
        ))}
        <li className="flex justify-center">
          <button
            type="button"
            onClick={openAddSheet}
            aria-label="Add transaction"
            className="-mt-7 mb-1 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-float ring-[6px] ring-background transition-transform focus-visible:ring-ring/50 focus-visible:outline-none active:scale-95"
          >
            <Plus className="size-8" strokeWidth={2.4} aria-hidden />
          </button>
        </li>
        {TABS.slice(2).map((tab) => (
          <li key={tab.to}>
            <TabLink {...tab} active={isActive(pathname, tab.to)} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Space the page keeps at the bottom on phones for the floating bar. */
export const BOTTOM_NAV_SPACE = "pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:pb-8";

const DESKTOP_LINKS = [
  { to: "/", label: "Home" },
  { to: "/transactions", label: "Transactions" },
  { to: "/plan", label: "Plan" },
  { to: "/import", label: "Import" },
  { to: "/accounts", label: "Accounts" },
  { to: "/settings", label: "Settings" },
] as const;

/** Desktop and tablet top bar (`sm` and up): every page, Joyo AI, and the Add button that opens the same sheet. */
export function DesktopBar({ wide }: { wide?: boolean }) {
  return (
    <header className="sticky top-0 z-30 hidden border-b border-border/60 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur sm:block">
      <nav aria-label="Main" className={`mx-auto flex h-16 ${wide ? "max-w-[100rem]" : "max-w-5xl"} items-center gap-1 px-4`}>
        <Link to="/" className="mr-3 flex shrink-0 items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
          <Wordmark />
        </Link>
        <ul className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {DESKTOP_LINKS.map((n) => (
            <li key={n.to}>
              <Link
                to={n.to}
                className="inline-flex h-9 items-center rounded-full px-3 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 lg:px-3.5"
                activeProps={{ className: "bg-primary-soft text-primary-ink hover:bg-primary-soft hover:text-primary-ink" }}
                activeOptions={{ exact: n.to === "/" }}
              >
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <Link
          to="/joyo"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
          activeProps={{ className: "bg-primary-soft text-primary-ink hover:bg-primary-soft hover:text-primary-ink" }}
          aria-label="Joyo AI"
          title="Joyo AI"
        >
          <Sparkles className="size-[1.125rem]" aria-hidden />
          <span className="hidden lg:inline">Joyo AI</span>
        </Link>
        <button
          type="button"
          onClick={openAddSheet}
          className="ml-1 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-float transition-transform outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 active:scale-[0.97]"
        >
          <Plus className="size-[1.125rem]" aria-hidden />
          Add
        </button>
        <DesktopAvatar />
        <button
          type="button"
          onClick={() => void signOut()}
          className="ml-1 hidden h-9 shrink-0 items-center rounded-full px-3 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:inline-flex"
        >
          Sign out
        </button>
      </nav>
    </header>
  );
}

/** Signed-in member's Google picture in the desktop bar; opens Settings. */
function DesktopAvatar() {
  const me = useQuery(orpc.me.queryOptions());
  return (
    <Link to="/settings" title={me.data ? `${me.data.user.name} · ${me.data.user.email}` : "Settings"} className="ml-1 shrink-0 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
      <Avatar name={me.data?.user.name} image={me.data?.user.image} className="size-9" />
    </Link>
  );
}
