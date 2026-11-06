// Chrome shared by the public pages (landing, demo, Claude connector, privacy policy, terms): header and footer.

import { buttonVariants } from "@baroka/ui/components/button";
import { cn } from "@baroka/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import { Wordmark } from "@/components/kit";
import type { Lang } from "@/lib/lang";
import { setLang, useLang } from "@/lib/lang";

/** Set once the repository is public with its LICENSE; until then no source links are shown. */
export const REPO_URL: string | null = "https://github.com/dzulfikar08/joyoarto";

export function PublicHeader() {
  const lang = useLang();
  const en = lang === "en";
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-1.5 px-4">
        <Link to="/" className="mr-auto flex items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
          <Wordmark />
        </Link>
        <a href="/#fitur" className={NAV_LINK}>
          {en ? "Features" : "Fitur"}
        </a>
        <Link to="/demo" className={NAV_LINK}>
          Demo
        </Link>
        <a href="/#harga" className={NAV_LINK}>
          {en ? "Pricing" : "Harga"}
        </a>
        <a href="/#faq" className={NAV_LINK}>
          FAQ
        </a>
        <LangToggle lang={lang} />
        <Link to="/login" className={buttonVariants({ variant: "secondary", size: "sm", className: "ml-1" })}>
          {en ? "Sign in" : "Masuk"}
        </Link>
      </nav>
    </header>
  );
}

const NAV_LINK =
  "hidden h-9 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex";

function LangToggle({ lang }: { lang: Lang }) {
  return (
    <div role="group" aria-label="Bahasa / Language" className="flex rounded-full bg-muted p-1 text-xs">
      {(["id", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={cn(
            "h-7 rounded-full px-2.5 font-bold uppercase transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
            lang === l ? "bg-segment text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function PublicFooter() {
  const en = useLang() === "en";
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Wordmark className="text-[0.9375rem] text-foreground" markClassName="size-6" />
          <span>· {en ? "a family money ledger" : "catatan keuangan keluarga"}</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 sm:ml-auto">
          <Link to="/demo" className="hover:underline">
            Demo
          </Link>
          <Link to="/pricing" className="hover:underline">
            {en ? "Pricing" : "Harga"}
          </Link>
          <Link to="/claude" className="hover:underline">
            Claude
          </Link>
          <Link to="/privasi" className="hover:underline">
            {en ? "Privacy" : "Privasi"}
          </Link>
          <Link to="/syarat" className="hover:underline">
            {en ? "Terms" : "Syarat"}
          </Link>
          {REPO_URL && (
            <a href={REPO_URL} className="hover:underline" target="_blank" rel="noreferrer">
              {en ? "Source code (AGPL)" : "Kode sumber (AGPL)"}
            </a>
          )}
          <a href="/api/docs" className="hover:underline">
            API
          </a>
          <Link to="/login" className="hover:underline">
            {en ? "Sign in" : "Masuk"}
          </Link>
        </div>
      </div>
      <p className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted-foreground/80">
        {en ? "JoyoArto is not affiliated with any bank or e-wallet." : "JoyoArto tidak berafiliasi dengan bank atau e-wallet mana pun."}
      </p>
    </footer>
  );
}
