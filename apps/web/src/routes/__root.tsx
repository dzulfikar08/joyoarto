import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { hostRedirect } from "@/lib/hosts";
import { Link, Outlet, createRootRouteWithContext, useRouterState } from "@tanstack/react-router";
import { Suspense, lazy, useEffect } from "react";
import BottomNav, { BOTTOM_NAV_SPACE, DesktopBar } from "@/components/bottom-nav";
import { Wordmark } from "@/components/kit";
import { NotFound } from "@/components/not-found";
import { sessionQuery } from "@/lib/auth";
import { syncHead } from "@/lib/head";

// Signed-in only: kept out of the entry chunk so the public pages do not download the add sheet (comboboxes, voice).
const AddSheet = lazy(() => import("@/components/add-sheet").then((m) => ({ default: m.AddSheet })));
const UpgradeSheet = lazy(() => import("@/components/upgrade").then((m) => ({ default: m.UpgradeSheet })));

function Shell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: session } = useQuery(sessionQuery);
  // Public pages (login, consent, the demo, privacy policy and terms, the landing page for visitors) draw their own layout.
  const bare =
    ["/login", "/connect", "/demo", "/privasi", "/syarat"].some((p) => path.startsWith(p)) || ((path === "/" || path === "/pricing") && !session);
  const nav = !bare && !!session;
  // The chat is a detail page on phones: no bottom nav, its own header with a back button, the composer at the bottom.
  const chat = path === "/joyo";
  // Title, description, canonical and share tags follow client-side navigation (first loads are prerendered).
  useEffect(() => syncHead(path), [path]);
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
          {!chat && <BottomNav />}
          <Suspense fallback={null}>
            <AddSheet />
            <UpgradeSheet />
          </Suspense>
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
  notFoundComponent: NotFound,
});
