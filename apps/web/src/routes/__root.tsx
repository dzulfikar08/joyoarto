import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { hostRedirect } from "@/lib/hosts";
import { Link, Outlet, createRootRouteWithContext, useRouterState } from "@tanstack/react-router";
import BottomNav, { BOTTOM_NAV_SPACE, DesktopBar } from "@/components/bottom-nav";
import { AddSheet } from "@/components/add-sheet";
import { Wordmark } from "@/components/kit";
import { sessionQuery } from "@/lib/auth";

function Shell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: session } = useQuery(sessionQuery);
  // Public pages (login, consent, the demo, privacy policy and terms, the landing page for visitors) draw their own layout.
  const bare =
    ["/login", "/connect", "/demo", "/privasi", "/syarat"].some((p) => path.startsWith(p)) || (path === "/" && !session);
  const nav = !bare && !!session;
  // The chat keeps its composer at the bottom of the screen and manages its own spacing.
  const chat = path === "/joyo";
  return (
    <div className="min-h-dvh bg-background">
      {nav && <DesktopBar />}
      {nav && !chat && (
        <header className="pt-[env(safe-area-inset-top)] sm:hidden">
          <div className="mx-auto flex h-14 max-w-5xl items-center px-4">
            <Link to="/" className="flex items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
              <Wordmark />
            </Link>
          </div>
        </header>
      )}
      <main className={bare ? "" : chat ? "" : `mx-auto max-w-5xl px-4 pt-2 pb-6 sm:pt-6 ${nav ? BOTTOM_NAV_SPACE : ""}`}>
        <Outlet />
      </main>
      {nav && (
        <>
          <BottomNav />
          <AddSheet />
        </>
      )}
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Client-side navigation from the public site (e.g. "Masuk") crosses to the app host here; first loads are handled in index.html.
  beforeLoad: ({ location }) => {
    if (typeof window === "undefined") return;
    const to = hostRedirect(window.location.hostname, location.pathname, location.searchStr + (location.hash ? `#${location.hash}` : ""));
    if (to) window.location.replace(to);
  },
  component: Shell,
});
