// Layout of the privacy policy and terms: public header and footer, readable prose, the same language toggle as the
// landing page (Bahasa Indonesia first; the Indonesian text is the one that counts).

import type { ReactNode } from "react";

import { PublicFooter, PublicHeader } from "@/components/public";
import { POLICY_EFFECTIVE } from "@/lib/brand";
import { useLang } from "@/lib/lang";

export type Section = { id: string; title: { id: string; en: string }; body: { id: ReactNode; en: ReactNode } };

function effective(en: boolean): string {
  const d = new Date(`${POLICY_EFFECTIVE}T00:00:00+07:00`);
  return d.toLocaleDateString(en ? "en-GB" : "id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
}

export function LegalPage({
  title,
  intro,
  sections,
  dated = true,
}: {
  title: { id: string; en: string };
  intro: { id: ReactNode; en: ReactNode };
  sections: Section[];
  /** Show the effective date (policies); off for the support page. */
  dated?: boolean;
}) {
  const lang = useLang();
  const en = lang === "en";
  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">{title[lang]}</h1>
        {dated && (
          <p className="mt-2 text-sm text-muted-foreground">
            {en ? "Effective" : "Berlaku sejak"} {effective(en)}
            {en && " · The Indonesian version prevails if the two differ."}
          </p>
        )}
        <div className="mt-6 text-foreground">{intro[lang]}</div>
        <nav aria-label={en ? "Contents" : "Daftar isi"} className="mt-6 rounded-xl border border-border p-4 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-primary hover:underline">
                  {s.title[lang]}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="mt-8 scroll-mt-16">
            <h2 className="text-xl font-semibold tracking-tight">
              {i + 1}. {s.title[lang]}
            </h2>
            <div className="mt-2 text-foreground">{s.body[lang]}</div>
          </section>
        ))}
      </main>
      <PublicFooter />
    </div>
  );
}

/** Small prose helpers so the policy text stays readable in code. */
export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 leading-relaxed text-pretty">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed">{children}</ul>;
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-primary underline">
      {children}
    </a>
  );
}
