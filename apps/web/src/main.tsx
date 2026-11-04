import { ThemeProvider } from "@baroka/ui/hooks/use-theme";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { captureOAuthQuery } from "./lib/oauth-query";
import { queryClient } from "./lib/orpc";
import { registerServiceWorker } from "./lib/shared-files";
import { routeTree } from "./routeTree.gen";

// Before the router touches the URL: the consent query is signed and must be sent back byte for byte.
captureOAuthQuery(window.location);

// Only for the share target (statement PDFs shared from the phone); it caches nothing else.
registerServiceWorker();

// The prerendered body is for crawlers without JavaScript (scripts/prerender.ts); the "js" class already hid it.
document.getElementById("prerender")?.remove();

// Toasts only follow a user action, so sonner loads right after first paint instead of in the entry bundle.
const Toaster = lazy(() => import("@baroka/ui/components/sonner").then((m) => ({ default: m.Toaster })));

const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <ThemeProvider storageKey="baroka.theme">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
      <Suspense fallback={null}>
        <Toaster position="top-center" richColors={false} closeButton />
      </Suspense>
    </ThemeProvider>
  </StrictMode>,
);
