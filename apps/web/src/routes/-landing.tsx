// Public landing page at "/" for visitors who are not signed in. Positioning: personal finance in one place (accounts,
// cash flow, budgets, plans, AI), not an expense tracker. Copy is Bahasa Indonesia first (casual, "kamu"), English via
// the toggle, and short: one line per idea. Claims stay within what JoyoArto does today.

import { Badge } from "@baroka/ui/components/badge";
import { buttonVariants } from "@baroka/ui/components/button";
import { cn } from "@baroka/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Calculator, Check, Code, Landmark, LockKeyhole, MessagesSquare, PieChart, Plus, ShieldCheck, Sparkles, TrendingUp, Users } from "lucide-react";
import type { ReactNode } from "react";

import { PricingPlans } from "@/components/pricing";
import { AndroidLogo, AppleLogo } from "@/components/brand-icons";
import { PublicFooter, PublicHeader, REPO_URL } from "@/components/public";
import {
  ANDROID_SECTION_ID,
  ANDROID_TESTERS_GROUP_EMAIL,
  ANDROID_TESTERS_GROUP_URL,
  ANDROID_TESTING_URL,
  DISCORD_URL,
  IOS_SECTION_ID,
  IOS_TESTFLIGHT_URL,
  TESTFLIGHT_APP_STORE_URL,
} from "@/lib/app-links";
import { useLang } from "@/lib/lang";

type T = (id: ReactNode, en: ReactNode) => ReactNode;

export function Landing() {
  const en = useLang() === "en";
  const t: T = (id, eng) => (en ? eng : id);
  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main>
        <Hero t={t} />
        <Features t={t} />
        <Spotlights t={t} />
        <Privacy t={t} />
        <GetTheApp t={t} />
        <Pricing t={t} />
        <Faq t={t} />
        <FinalCta t={t} />
      </main>
      <PublicFooter />
    </div>
  );
}

function Section({ id, children, className = "" }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-16 px-4 py-16 sm:py-24", className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function Heading({ eyebrow, title, sub, center }: { eyebrow: ReactNode; title: ReactNode; sub?: ReactNode; center?: boolean }) {
  return (
    <div className={cn("mb-10 max-w-2xl sm:mb-12", center && "mx-auto text-center")}>
      <p className="text-sm font-semibold text-primary">{eyebrow}</p>
      <h2 className="mt-2 text-3xl leading-tight font-extrabold tracking-tight text-balance sm:text-[2.5rem]">{title}</h2>
      {sub && <p className="mt-3 text-lg text-pretty text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Hero

function Hero({ t }: { t: T }) {
  return (
    <section className="relative overflow-hidden px-4 pt-12 pb-16 sm:pt-20 sm:pb-24">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-gradient-to-b from-primary-soft/70 to-transparent" />
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div>
          <Badge tone="primary" className="mb-5">
            {t("Keuangan pribadi & keluarga", "Personal & family finance")}
          </Badge>
          <h1 className="text-[2.5rem] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-[3.5rem]">
            {t("Keputusan uang besar,", "Big money decisions,")} <span className="text-primary">{t("dengan angka yang pasti.", "backed by real numbers.")}</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-pretty text-muted-foreground">
            {t(
              "Mobil, rumah, anak pertama. JoyoArto merangkum semua rekeningmu dan menjawab dari data aslimu.",
              "A car, a home, a first baby. JoyoArto brings your accounts together and answers from your own data.",
            )}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/login" className={buttonVariants({ size: "lg" })}>
              {t("Mulai gratis", "Start free")} <ArrowRight aria-hidden />
            </Link>
            <Link to="/demo" className={buttonVariants({ variant: "outline", size: "lg" })}>
              {t("Coba demo, tanpa akun", "Try the demo, no account")}
            </Link>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {[
              t("Tanpa login bank", "No bank login"),
              t("Data nggak dijual", "Data never sold"),
              t("Open source", "Open source"),
            ].map((x, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <Check aria-hidden className="size-4 text-positive" strokeWidth={2.5} /> {x}
              </li>
            ))}
          </ul>
          <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {t("Web, Android & iPhone", "Web, Android & iPhone")}
            <a href={`#${ANDROID_SECTION_ID}`} className="inline-flex items-center gap-1.5 font-semibold text-foreground hover:text-primary [&_svg]:size-4">
              <AndroidLogo /> Android
            </a>
            <a href={`#${IOS_SECTION_ID}`} className="inline-flex items-center gap-1.5 font-semibold text-foreground hover:text-primary [&_svg]:size-4">
              <AppleLogo /> iPhone
            </a>
          </p>
        </div>
        <HeroVisual t={t} />
      </div>
    </section>
  );
}

/**
 * The hero picture: a member asks whether they can afford a car and Joyo AI answers from their own ledger with a
 * 24-month projection (no change vs with the car) against the 6-month emergency fund line. The numbers hang together:
 * Rp 160 jt saved, Rp 18 jt in and Rp 11 jt out a month; a Rp 250 jt car with 30% down in February, Rp 3,65 jt
 * installment (20% of income) and Rp 0,8 jt running costs. Lines draw in once; reduced motion shows them still.
 */
function HeroVisual({ t }: { t: T }) {
  // y = 150 - value_jt * 140 / 340, x = month * 320 / 24 (Nov 2026 = month 0, down payment in month 3).
  const withCar = "M0,84.1 L40,75.5 L40,106.4 L320,84.3";
  const noChange = "M0,84.1 L320,14.9";
  const checks = [
    { k: t("Dana darurat", "Emergency fund"), v: t("6,9 bln", "6.9 mo") },
    { k: t("Cicilan", "Installments"), v: "20%" },
    { k: t("Terendah", "Lowest"), v: "Rp 106 jt" },
  ];
  return (
    <div aria-hidden="true" className="hero-anim relative mx-auto w-full max-w-lg select-none">
      <style>{`
        @keyframes hero-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
        @keyframes hero-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        .hero-anim .rise { animation: hero-rise .6s cubic-bezier(.2,.7,.2,1) both }
        .hero-anim .draw { stroke-dasharray: 1; animation: hero-draw 1.6s cubic-bezier(.4,0,.2,1) both }
        @media (prefers-reduced-motion: reduce) { .hero-anim .rise, .hero-anim .draw { animation: none } }
      `}</style>
      <div className="rise ml-auto w-fit max-w-[85%] rounded-3xl rounded-br-md bg-primary px-4 py-3 text-[0.9375rem] text-primary-foreground shadow-float">
        {t("Kalau ambil mobil Rp 250 jt bulan Februari, kami masih aman nggak?", "If we buy a Rp 250m car in February, are we still OK?")}
      </div>
      <div className="rise mt-3 rounded-3xl bg-card p-5 shadow-float ring-1 ring-border/60 sm:p-6" style={{ animationDelay: "250ms" }}>
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-primary-ink">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold">Joyo AI</p>
            <p className="truncate text-xs text-muted-foreground">{t("Dari 6 bulan transaksi di 5 rekening", "From 6 months of transactions in 5 accounts")}</p>
          </div>
        </div>
        <p className="mt-4 text-lg leading-snug font-bold text-balance">
          {t("Aman. Tabungan tetap naik, dana darurat di atas 6 bulan.", "Yes. Savings keep growing and the emergency fund stays above 6 months.")}
        </p>
        <svg viewBox="0 0 320 160" className="mt-4 w-full overflow-visible">
          <defs>
            <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--viz-series-1)" stopOpacity="0.18" />
              <stop offset="1" stopColor="var(--viz-series-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[30, 70, 110, 150].map((y) => (
            <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="var(--viz-grid)" strokeWidth="1" />
          ))}
          <line x1="0" x2="320" y1="111.8" y2="111.8" stroke="var(--viz-warning)" strokeWidth="1.5" strokeDasharray="4 4" />
          <text x="318" y="124" textAnchor="end" fontSize="9" fill="var(--viz-muted)">
            {t("Dana darurat 6 bulan", "6-month emergency fund")}
          </text>
          <path d={`${withCar} L320,150 L0,150 Z`} fill="url(#hero-area)" className="rise" style={{ animationDelay: "1.2s" }} />
          <path d={noChange} pathLength={1} fill="none" stroke="var(--viz-previous)" strokeWidth="2" strokeDasharray="1" className="draw" style={{ animationDelay: "500ms" }} />
          <path d={withCar} pathLength={1} fill="none" stroke="var(--viz-series-1)" strokeWidth="2.75" strokeLinejoin="round" className="draw" style={{ animationDelay: "700ms" }} />
          <circle cx="40" cy="106.4" r="4" fill="var(--card)" stroke="var(--viz-series-1)" strokeWidth="2" className="rise" style={{ animationDelay: "1s" }} />
          <text x="48" y="97" fontSize="9" fontWeight="600" fill="var(--foreground)" className="rise" style={{ animationDelay: "1s" }}>
            {t("DP mobil", "Down payment")}
          </text>
          <text x="318" y="10" textAnchor="end" fontSize="9" fill="var(--viz-muted)">
            {t("Tanpa mobil · Rp 328 jt", "No car · Rp 328m")}
          </text>
          <text x="318" y="72" textAnchor="end" fontSize="9" fontWeight="700" fill="var(--viz-series-1)">
            {t("Dengan mobil · Rp 160 jt", "With car · Rp 160m")}
          </text>
        </svg>
        <div className="mt-1 flex justify-between text-[0.6875rem] text-muted-foreground">
          <span>Nov 2026</span>
          <span>Nov 2027</span>
          <span>Nov 2028</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {checks.map((c, i) => (
            <div key={i} className="rounded-2xl bg-muted/70 px-3 py-2.5">
              <p className="truncate text-[0.6875rem] text-muted-foreground">{c.k}</p>
              <p className="mt-0.5 flex items-center gap-1 text-sm font-bold whitespace-nowrap tabular-nums">
                {c.v} <Check className="size-3.5 text-positive" strokeWidth={3} />
              </p>
            </div>
          ))}
        </div>
      </div>
      <div
        className="rise absolute -bottom-5 -left-3 hidden items-center gap-2 rounded-full bg-card px-3.5 py-2 text-xs font-semibold shadow-float ring-1 ring-border/60 sm:flex lg:-left-8"
        style={{ animationDelay: "1.4s" }}
      >
        <ShieldCheck className="size-4 text-positive" /> {t("Saldo cocok dengan e-statement", "Balances match your statements")}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Features

function Features({ t }: { t: T }) {
  const items: { icon: ReactNode; title: ReactNode; body: ReactNode }[] = [
    {
      icon: <Landmark />,
      title: t("Semua rekening", "Every account"),
      body: t("Bank, kartu kredit dan e-wallet dalam satu saldo.", "Banks, credit cards and e-wallets in one balance."),
    },
    {
      icon: <TrendingUp />,
      title: t("Arus kas", "Cash flow"),
      body: t("Uang masuk dan keluar tiap bulan, per kategori.", "Money in and out each month, by category."),
    },
    {
      icon: <PieChart />,
      title: t("Anggaran", "Budgets"),
      body: t("Pasang batas per kategori dan pantau sisanya.", "Set limits per category and watch what's left."),
    },
    {
      icon: <Calculator />,
      title: t("Rencana & simulasi", "Plans & simulations"),
      body: t("Uji cicilan mobil atau biaya bayi sebelum memutuskan.", "Test a car loan or baby costs before you decide."),
    },
    {
      icon: <Sparkles />,
      title: t("Asisten AI", "AI assistant"),
      body: t("Tanya Joyo AI atau Claude pakai bahasa sehari-hari.", "Ask Joyo AI or Claude in plain words."),
    },
    {
      icon: <Users />,
      title: t("Untuk keluarga", "Made for families"),
      body: t("Satu buku bareng pasangan, akun masing-masing.", "One shared ledger, everyone on their own login."),
    },
  ];
  return (
    <Section id="fitur" className="bg-card">
      <Heading
        center
        eyebrow={t("Fitur", "Features")}
        title={t("Lebih dari catatan pengeluaran.", "More than an expense tracker.")}
        sub={t("Semua yang kamu perlu untuk mengatur uang, dari hari ini sampai rencana tahun depan.", "Everything you need to run your money, from today to next year's plans.")}
      />
      <div className="grid gap-px overflow-hidden rounded-3xl bg-border ring-1 ring-border sm:grid-cols-2 lg:grid-cols-3">
        {items.map((f, i) => (
          <div key={i} className="bg-card p-6 sm:p-8">
            <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary-ink [&_svg]:size-5">{f.icon}</span>
            <h3 className="mt-5 text-lg font-bold tracking-tight">{f.title}</h3>
            <p className="mt-1.5 text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Spotlights: two things that set JoyoArto apart, each with a small picture.

function Spotlights({ t }: { t: T }) {
  return (
    <Section>
      <div className="space-y-20 sm:space-y-28">
      <Spotlight
        eyebrow={t("Gambaran bulanan", "Monthly picture")}
        title={t("Tahu sisa uangmu sebelum akhir bulan.", "Know what's left before the month ends.")}
        body={t(
          "Semua rekening, e-wallet dan kartu kredit jadi satu gambaran: uang masuk, keluar, dan anggaran yang hampir habis.",
          "Every account, e-wallet and credit card in one picture: money in, money out, and budgets running low.",
        )}
        points={[t("Satu saldo untuk semua rekening", "One balance across accounts"), t("Anggaran per kategori", "Budgets per category"), t("Catat cepat dari HP", "Quick add from your phone")]}
        visual={<MonthVisual t={t} />}
      />
      <Spotlight
        reverse
        eyebrow={t("Data yang akurat", "Accurate data")}
        title={t("Angka yang bisa dipercaya.", "Numbers you can trust.")}
        body={t(
          "Upload e-statement, JoyoArto cek setiap saldo sampai cocok. Catat cepat dari HP, statement yang mengonfirmasi.",
          "Upload a statement and JoyoArto checks every balance until it adds up. Quick-add on your phone; the statement confirms it.",
        )}
        points={[t("Bank Jago & GoPay dibaca otomatis", "Bank Jago & GoPay read automatically"), t("Bank lain lewat CSV", "Other banks via CSV"), t("Upload ulang aman, nggak dobel", "Re-upload safely, no duplicates")]}
        visual={<StatementVisual t={t} />}
      />
      </div>
    </Section>
  );
}

function Spotlight({ eyebrow, title, body, points, visual, reverse }: { eyebrow: ReactNode; title: ReactNode; body: ReactNode; points: ReactNode[]; visual: ReactNode; reverse?: boolean }) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={cn(reverse && "lg:order-2")}>
        <p className="text-sm font-semibold text-primary">{eyebrow}</p>
        <h2 className="mt-2 text-3xl leading-tight font-extrabold tracking-tight text-balance sm:text-[2.5rem]">{title}</h2>
        <p className="mt-4 max-w-md text-lg text-pretty text-muted-foreground">{body}</p>
        <ul className="mt-6 space-y-2.5">
          {points.map((p, i) => (
            <li key={i} className="flex items-center gap-2.5 font-medium">
              <span className="grid size-5 place-items-center rounded-full bg-positive-soft text-positive-ink">
                <Check aria-hidden className="size-3" strokeWidth={3} />
              </span>
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className={cn("rounded-[2rem] bg-muted/60 p-6 sm:p-10", reverse && "lg:order-1")}>{visual}</div>
    </div>
  );
}

function MonthVisual({ t }: { t: T }) {
  const budgets = [
    { name: t("Makan & minum", "Food & drink"), pct: 64 },
    { name: t("Transportasi", "Transport"), pct: 42 },
    { name: t("Belanja", "Shopping"), pct: 91, warn: true },
  ];
  return (
    <div aria-hidden="true" className="mx-auto max-w-sm rounded-3xl bg-card p-6 shadow-float select-none">
      <p className="text-xs text-muted-foreground">{t("November 2026 · 5 rekening", "November 2026 · 5 accounts")}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{t("Masuk", "In")}</p>
          <p className="font-bold whitespace-nowrap text-positive tabular-nums">+Rp 18.000.000</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("Keluar", "Out")}</p>
          <p className="font-bold whitespace-nowrap tabular-nums">−Rp 11.240.000</p>
        </div>
      </div>
      <p className="mt-6 text-sm font-bold">{t("Anggaran", "Budgets")}</p>
      <ul className="mt-3 space-y-3 text-sm">
        {budgets.map((b, i) => (
          <li key={i}>
            <div className="flex justify-between">
              <span>{b.name}</span>
              <span className={cn("font-semibold tabular-nums", b.warn ? "text-warning-ink" : "text-muted-foreground")}>{b.pct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-muted">
              <div className={cn("h-full rounded-full", b.warn ? "bg-warning" : "bg-primary")} style={{ width: `${b.pct}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatementVisual({ t }: { t: T }) {
  const rows = [
    { m: "PT Sinar Maju", c: t("Gaji", "Salary"), a: "+12.500.000", pos: true },
    { m: "Indomaret", c: t("Belanja harian", "Groceries"), a: "−187.300" },
    { m: "PLN", c: t("Listrik", "Electricity"), a: "−302.500" },
  ];
  return (
    <div aria-hidden="true" className="mx-auto max-w-sm rounded-3xl bg-card p-6 shadow-float select-none">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Bank Jago · {t("Oktober", "October")} 2026</p>
          <p className="font-bold">Main Pocket</p>
        </div>
        <Badge tone="positive">
          <ShieldCheck aria-hidden /> {t("Saldo cocok", "Balanced")}
        </Badge>
      </div>
      <ul className="mt-4 divide-y divide-border text-sm">
        {rows.map((r) => (
          <li key={r.m} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{r.m}</p>
              <p className="truncate text-xs text-muted-foreground">{r.c}</p>
            </div>
            <span className={cn("font-semibold tabular-nums", r.pos && "text-positive")}>{r.a}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Privacy

function Privacy({ t }: { t: T }) {
  const points = [
    {
      icon: <LockKeyhole />,
      title: t("Tanpa login bank", "No bank login"),
      body: t("Kami nggak pernah minta PIN atau password bank.", "We never ask for your bank PIN or password."),
    },
    {
      icon: <ShieldCheck />,
      title: t("Datamu milikmu", "Your data is yours"),
      body: t("Nggak dijual, nggak dipakai buat iklan.", "Never sold, never used for ads."),
    },
    {
      icon: <Code />,
      title: t("Kode terbuka", "Open code"),
      body: t("Siapa pun bisa periksa ke mana datamu pergi.", "Anyone can check where your data goes."),
    },
  ];
  return (
    <Section id="privasi" className="bg-[oklch(0.22_0.05_268)] text-white">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-center">
        <div>
          <p className="text-sm font-semibold text-coin">{t("Privasi", "Privacy")}</p>
          <h2 className="mt-2 text-3xl leading-tight font-extrabold tracking-tight text-balance sm:text-[2.5rem]">
            {t("Uang itu urusan pribadi.", "Money is personal.")}
          </h2>
          {REPO_URL && (
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white/75 hover:text-white">
              {t("Lihat kode sumbernya", "Read the source code")} <ArrowRight aria-hidden className="size-4" />
            </a>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {points.map((p, i) => (
            <div key={i} className="rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/10">
              <span className="text-coin [&_svg]:size-5">{p.icon}</span>
              <h3 className="mt-3 font-bold">{p.title}</h3>
              <p className="mt-1 text-sm text-white/70">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Phone apps (both still in testing): compact install steps, one card per platform.

type Step = { title: ReactNode; href?: string; to?: "/login"; cta?: ReactNode; small?: ReactNode };

function GetTheApp({ t }: { t: T }) {
  const android: Step[] = [
    { title: t("Gabung grup tester", "Join the testers' group"), href: ANDROID_TESTERS_GROUP_URL, cta: "Google Groups", small: ANDROID_TESTERS_GROUP_EMAIL },
    { title: t("Daftar jadi tester, lalu pasang dari Play Store", "Opt in, then install from the Play Store"), href: ANDROID_TESTING_URL, cta: "Google Play" },
    { title: t("Masuk pakai Google", "Sign in with Google") },
  ];
  const iphone: Step[] = [
    { title: t("Pasang TestFlight dari App Store", "Install TestFlight from the App Store"), href: TESTFLIGHT_APP_STORE_URL, cta: "App Store" },
    IOS_TESTFLIGHT_URL
      ? { title: t("Buka undangan JoyoArto, ketuk Accept lalu Install", "Open the JoyoArto invite, tap Accept, then Install"), href: IOS_TESTFLIGHT_URL, cta: "TestFlight" }
      : { title: t("Undangan TestFlight segera; sementara pakai web di Safari", "TestFlight invite coming soon; meanwhile use the web app in Safari"), to: "/login", cta: t("Buka web", "Open web app") },
    { title: t("Masuk pakai Apple atau Google", "Sign in with Apple or Google") },
  ];
  return (
    <Section id="aplikasi" className="bg-card">
      <Heading
        center
        eyebrow={t("Aplikasi", "Apps")}
        title={t("Di web, Android dan iPhone.", "On the web, Android and iPhone.")}
        sub={t("Aplikasi HP masih tahap uji. Catat cepat, baca notifikasi Jago & GoPay, kirim PDF statement.", "The phone apps are in testing. Quick add, Jago & GoPay notification capture, statement PDFs.")}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <InstallCard id={ANDROID_SECTION_ID} logo={<AndroidLogo />} platform="Android" note={t("Google Play, tahap uji", "Google Play, testing")} steps={android} />
        <InstallCard id={IOS_SECTION_ID} logo={<AppleLogo />} platform="iPhone" note={t("TestFlight, tahap uji", "TestFlight, testing")} steps={iphone} />
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        <a href={DISCORD_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 font-semibold text-foreground hover:text-primary [&_svg]:size-4">
          <MessagesSquare aria-hidden /> {t("Gabung Discord untuk lapor bug dan diskusi", "Join our Discord to report bugs and talk with us")}
        </a>
      </p>
    </Section>
  );
}

function InstallCard({ id, logo, platform, note, steps }: { id: string; logo: ReactNode; platform: ReactNode; note: ReactNode; steps: Step[] }) {
  const linkCls = buttonVariants({ variant: "outline", size: "xs", className: "shrink-0" });
  return (
    <div id={id} className="scroll-mt-20 rounded-3xl bg-background p-6 ring-1 ring-border sm:p-8">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-foreground text-background [&_svg]:size-5">{logo}</span>
        <div>
          <h3 className="text-lg font-bold tracking-tight">{platform}</h3>
          <p className="text-sm text-muted-foreground">{note}</p>
        </div>
      </div>
      <ol className="mt-6 space-y-4">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-ink">{i + 1}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <p className="font-semibold text-pretty">{s.title}</p>
                {s.small && <p className="text-xs break-all text-muted-foreground">{s.small}</p>}
              </div>
              {s.href && (
                <a href={s.href} target="_blank" rel="noopener" className={linkCls}>
                  {s.cta} <ArrowRight aria-hidden />
                </a>
              )}
              {s.to && (
                <Link to={s.to} className={linkCls}>
                  {s.cta} <ArrowRight aria-hidden />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Pricing, FAQ, closing call to action

function Pricing({ t }: { t: T }) {
  const tt = <V,>(id: V, eng: V): V => t(id as ReactNode, eng as ReactNode) as V;
  return (
    <Section id="harga">
      <Heading
        center
        eyebrow={t("Harga", "Pricing")}
        title={t("Gratis untuk mulai.", "Free to start.")}
        sub={t("Joyo Pro: satu langganan untuk JoyoArto, JoyoRogo dan JoyoFit.", "Joyo Pro: one subscription for JoyoArto, JoyoRogo and JoyoFit.")}
      />
      <PricingPlans
        t={tt}
        freeAction={
          <Link to="/login" className={buttonVariants({ variant: "secondary", className: "w-full" })}>
            {t("Mulai gratis", "Start free")}
          </Link>
        }
      />
    </Section>
  );
}

function Faq({ t }: { t: T }) {
  const qa: [ReactNode, ReactNode][] = [
    [
      t("Bank apa aja yang bisa dibaca?", "Which banks can it read?"),
      t(
        "Bank Jago dan GoPay dibaca dan diverifikasi otomatis. Bank lain bisa lewat CSV atau minta Claude membaca PDF-nya. BCA, BRI, Mandiri dan lainnya menyusul.",
        "Bank Jago and GoPay are read and verified automatically. Other banks work via CSV or by asking Claude to read the PDF. BCA, BRI, Mandiri and more are coming.",
      ),
    ],
    [
      t("Apakah JoyoArto nyambung langsung ke rekening bank?", "Does JoyoArto connect to my bank account?"),
      t(
        "Nggak. JoyoArto nggak pernah minta login bank. Kamu download statement dari aplikasi bank lalu upload, jadi lebih aman dan angkanya bisa dicek.",
        "No. JoyoArto never asks for your bank login. You download the statement from your bank app and upload it, which is safer and the numbers can be checked.",
      ),
    ],
    [
      t("Berapa harganya?", "How much does it cost?"),
      t(
        "Paket Free gratis selamanya. Joyo Pro adalah satu langganan per akun yang juga membuka Pro di JoyoRogo dan JoyoFit, bulanan atau tahunan. Kodenya open source, jadi kamu juga bisa host sendiri.",
        "The Free plan is free forever. Joyo Pro is one subscription per account that also unlocks Pro in JoyoRogo and JoyoFit, monthly or yearly. The code is open source, so you can also host it yourself.",
      ),
    ],
    [
      t("Harus pakai Claude?", "Do I need Claude?"),
      t(
        "Nggak wajib. Semua fitur ada di web dan aplikasi, termasuk Joyo AI. Claude itu bonus kalau kamu sudah memakainya.",
        "No. Every feature is in the web and phone apps, including Joyo AI. Claude is a bonus if you already use it.",
      ),
    ],
    [
      t("Gimana cara pasang aplikasi Android-nya?", "How do I install the Android app?"),
      t(
        "Gabung grup Google joyoarto-testers (groups.google.com/g/joyoarto-testers), buka play.google.com/apps/testing/com.joyodigitama.joyoarto dan ketuk “Jadi penguji”, lalu pasang JoyoArto dari Play Store dan masuk pakai Google. Ada bug atau pertanyaan? Gabung Discord kami di discord.gg/vtud8UYekp.",
        "Join the joyoarto-testers Google Group (groups.google.com/g/joyoarto-testers), open play.google.com/apps/testing/com.joyodigitama.joyoarto and tap “Become a tester”, then install JoyoArto from the Play Store and sign in with Google. Found a bug or have a question? Join our Discord at discord.gg/vtud8UYekp.",
      ),
    ],
    [
      t("Data saya dipakai buat apa?", "What is my data used for?"),
      t(
        "Cuma buat nampilin keuanganmu ke kamu dan anggota rumah tangga yang kamu undang. Nggak dijual, nggak dipakai buat iklan.",
        "Only to show your finances to you and the household members you invite. Never sold, never used for ads.",
      ),
    ],
  ];
  return (
    <Section id="faq" className="bg-card">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
        <Heading eyebrow="FAQ" title={t("Pertanyaan umum", "Common questions")} />
        <div className="divide-y divide-border border-y border-border">
          {qa.map(([q, a], i) => (
            <details key={i} className="group py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold">
                {q}
                <Plus className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-45" aria-hidden="true" />
              </summary>
              <p className="mt-2 text-pretty text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

function FinalCta({ t }: { t: T }) {
  return (
    <Section className="py-16 sm:py-20">
      <div className="rounded-[2rem] bg-primary px-6 py-12 text-center text-primary-foreground sm:px-12 sm:py-16">
        <h2 className="text-3xl leading-tight font-extrabold tracking-tight text-balance sm:text-[2.5rem]">
          {t("Mulai rapikan keuanganmu hari ini.", "Get your finances in order today.")}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-lg text-primary-foreground/80">{t("Gratis, tanpa kartu kredit.", "Free, no credit card.")}</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to="/login" className={buttonVariants({ size: "lg", variant: "secondary" })}>
            {t("Mulai gratis", "Start free")} <ArrowRight aria-hidden />
          </Link>
          <Link to="/demo" className={buttonVariants({ size: "lg", className: "bg-white/10 text-primary-foreground hover:bg-white/20" })}>
            {t("Coba demo", "Try the demo")}
          </Link>
        </div>
      </div>
    </Section>
  );
}
