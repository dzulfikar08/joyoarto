import { Button } from "@baroka/ui/components/button";
import { Input } from "@baroka/ui/components/input";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { BrandMark } from "@/components/kit";
import { sessionQuery } from "@/lib/auth";
import { authClient } from "@/lib/auth-client";
import { SERVER_URL, queryClient } from "@/lib/orpc";
import { safeRedirect } from "@/lib/safe-redirect";

type Search = { redirect?: string };

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): Search => (typeof s.redirect === "string" ? { redirect: s.redirect } : {}),
  beforeLoad: async ({ search }) => {
    if (await queryClient.ensureQueryData(sessionQuery)) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: Login,
});

function Login() {
  const { redirect: target } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const done = safeRedirect(target);

  const google = async () => {
    const { error: e } = await authClient.signIn.social({ provider: "google", callbackURL: new URL(done, location.origin).toString() });
    if (e) setError(e.message ?? "Google sign-in failed");
  };
  const dev = async () => {
    const res = await fetch(`${SERVER_URL}/api/auth/sign-in/dev-user`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!res.ok) return setError("Dev login is off (set DEV_LOGIN on the server).");
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    location.assign(done);
  };

  /** Store reviewers: a demo code (DEMO_LOGIN_CODE on the server) opens the demo account, whose made-up data resets daily. */
  const demo = async (code: string) => {
    setError(null);
    const res = await fetch(`${SERVER_URL}/api/auth/sign-in/demo`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return setError(res.status === 404 ? "Demo login is not available." : (body?.message ?? "Demo sign-in failed."));
    }
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    location.assign(done);
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="space-y-5 rounded-3xl bg-card p-6 text-center sm:p-8">
          <BrandMark className="mx-auto size-14" />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Joyo<span className="text-primary">Arto</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Your money, readable by you and your AI.</p>
          </div>
          <div className="space-y-2.5">
            <Button
              variant="outline"
              className="w-full gap-2.5 border-[#747775] bg-white text-[#1f1f1f] hover:bg-[#f2f2f2] dark:border-[#8e918f] dark:bg-[#131314] dark:text-[#e3e3e3] dark:hover:bg-[#1f1f20]"
              onClick={() => void google()}
            >
              <GoogleIcon />
              Continue with Google
            </Button>
            {import.meta.env.DEV && (
              <Button variant="secondary" className="w-full" onClick={() => void dev()}>
                Dev login
              </Button>
            )}
          </div>
          <details className="group text-left text-sm">
            <summary className="cursor-pointer list-none text-center text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
              Demo account (reviewers)
            </summary>
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const code = new FormData(e.currentTarget).get("code");
                if (typeof code === "string" && code.trim()) void demo(code.trim());
              }}
            >
              <Input name="code" aria-label="Demo code" placeholder="Demo code" autoComplete="off" autoCapitalize="none" spellCheck={false} />
              <Button type="submit" variant="secondary" className="w-full">
                Open the demo
              </Button>
              <p className="text-xs text-muted-foreground">Made-up data that resets every day. Nothing you do there reaches real people.</p>
            </form>
          </details>
          {error && (
            <p role="alert" className="rounded-2xl bg-destructive-soft p-3 text-sm text-destructive-ink">
              {error}
            </p>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          By continuing you agree to the{" "}
          <a href="/syarat" className="underline hover:text-foreground">
            Terms
          </a>{" "}
          and{" "}
          <a href="/privasi" className="underline hover:text-foreground">
            Privacy Policy
          </a>
          , including storage of your data outside Indonesia.
        </p>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link to="/" className="font-semibold hover:text-foreground">
            ← JoyoArto
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * Google's standard four-colour "G", unaltered (Sign in with Google branding guidelines). The button around it uses
 * Google's own light theme (white, #747775 stroke, #1F1F1F text) and, in dark mode, its dark theme (#131314, #8E918F
 * stroke, #E3E3E3 text) rather than the JoyoArto tokens, as the guidelines require.
 */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-5">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
