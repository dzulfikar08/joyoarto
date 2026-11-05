// Public landing page at "/" for visitors who are not signed in. Copy is Bahasa Indonesia first (casual, "kamu"),
// English via the toggle. Claims stay within what JoyoArto does today; future work is labelled "segera" / "soon".

import { Badge } from "@baroka/ui/components/badge";
import { buttonVariants } from "@baroka/ui/components/button";
import { cn } from "@baroka/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Plus, Smartphone, Users } from "lucide-react";
import type { ReactNode } from "react";

import { PricingPlans } from "@/components/pricing";
import { PublicFooter, PublicHeader, REPO_URL, WaitlistForm } from "@/components/public";
import { ANDROID_SECTION_ID, ANDROID_TESTERS_GROUP_EMAIL, ANDROID_TESTERS_GROUP_URL, ANDROID_TESTING_URL } from "@/lib/app-links";
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
        <WhyTrack t={t} />
        <HowItWorks t={t} />
        <Features t={t} />
        <Privacy t={t} />
        <AndroidTesters t={t} />
        <Pricing t={t} />
        <Waitlist t={t} />
        <Faq t={t} />
      </main>
      <PublicFooter />
    </div>
  );
}

function Section({ id, children, className = "" }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-16 px-4 py-14 sm:py-20", className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function Heading({ eyebrow, title, sub }: { eyebrow: ReactNode; title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-8 max-w-2xl sm:mb-10">
      <p className="text-sm font-bold text-primary">{eyebrow}</p>
      <h2 className="mt-1.5 text-[1.75rem] leading-tight font-extrabold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 text-pretty text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Hero({ t }: { t: T }) {
  return (
    <section className="relative overflow-hidden px-4 pt-10 pb-14 sm:pt-16 sm:pb-20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 mx-auto h-96 max-w-4xl rounded-full bg-primary/15 blur-3xl"
      />
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="text-[2.5rem] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-6xl">
            {t("Mampu nggak beli mobil?", "Can we afford the car?")}{" "}
            <span className="text-primary">{t("Lihat dulu angkanya.", "Check the numbers first.")}</span>
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground text-pretty">
            {t(
              "Cicilan di brosur dealer selalu kelihatan ringan. JoyoArto baca e-statement Jago dan GoPay-mu, hitung berapa yang benar-benar masuk dan keluar tiap bulan, lalu uji cicilannya: dana darurat masih cukup 6 bulan atau nggak, total cicilan masih di bawah 30% penghasilan atau nggak.",
              "The installment on the dealer's brochure always looks small. JoyoArto reads your Jago and GoPay statements, works out what really comes in and goes out each month, then tests the loan: is your emergency fund still 6 months, are all installments still under 30% of income?",
            )}
          </p>
          <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
            <a href="#waitlist" className={buttonVariants({ size: "lg" })}>
              {t("Gabung waitlist", "Join the waitlist")}
            </a>
            <Link to="/demo" className={buttonVariants({ variant: "outline", size: "lg", className: "border-transparent" })}>
              {t("Coba demo, tanpa akun", "Try the demo, no account")} <ArrowRight aria-hidden />
            </Link>
            <a href={`#${ANDROID_SECTION_ID}`} className={buttonVariants({ variant: "secondary", size: "lg" })}>
              <Smartphone aria-hidden /> {t("Jadi tester Android", "Test the Android app")}
            </a>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("Simulasinya hitungan dari transaksimu sendiri, bukan nasihat keuangan.", "The simulation is arithmetic on your own transactions, not financial advice.")}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Demo-nya jalan di browser kamu. Statement nggak diunggah ke mana-mana.", "The demo runs in your browser. Your statement is not uploaded anywhere.")}
            {REPO_URL && (
              <>
                {" "}
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-semibold underline hover:text-foreground">
                  {t("Lihat kodenya di GitHub", "Read the code on GitHub")}
                </a>
              </>
            )}
          </p>
        </div>
        <HeroVisual t={t} />
      </div>
    </section>
  );
}

/** A still life of what JoyoArto does: a verified statement, a named GoPay payment, a question to Claude. */
function HeroVisual({ t }: { t: T }) {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-md select-none">
      <div className="space-y-3 rounded-3xl bg-card p-5 shadow-float">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Bank Jago · {t("Oktober", "October")} 2026</p>
            <p className="font-bold">Main Pocket</p>
          </div>
          <Badge tone="positive">
            <Check aria-hidden strokeWidth={3} /> {t("Saldo cocok", "Balances match")}
          </Badge>
        </div>
        <ul className="divide-y divide-border text-sm">
          {[
            { m: "PT Sinar Maju", c: t("Gaji", "Salary"), a: "+12.500.000", pos: true },
            { m: "Kopi Kenangan", c: t("Kopi & jajan", "Coffee & snacks"), a: "-28.000", from: "Gopay - Generic" },
            { m: "Indomaret", c: t("Belanja harian", "Groceries"), a: "-187.300", from: "Gopay - Generic" },
            { m: "PLN", c: t("Listrik", "Electricity"), a: "-302.500" },
          ].map((r) => (
            <li key={r.m} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.m}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.c}
                  {r.from && <span className="text-muted-foreground/70 line-through decoration-muted-foreground/60"> · {r.from}</span>}
                </p>
              </div>
              <span className={cn("font-semibold tabular-nums", r.pos && "text-positive")}>{r.a}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative -mt-4 ml-8 rounded-3xl rounded-tl-md bg-primary p-4 text-sm text-primary-foreground shadow-float sm:ml-16">
        <p className="text-xs font-semibold opacity-80">{t("Kamu → Claude", "You → Claude")}</p>
        <p className="mt-0.5">{t("“Kalau ambil mobil Rp 300 jt, tabungan buat si kecil aman nggak?”", "“If we buy a Rp 300m car, is the baby fund still safe?”")}</p>
      </div>
    </div>
  );
}

/** Why anyone tracks spending: a decision that needs real averages. The questions are examples, not features. */
function WhyTrack({ t }: { t: T }) {
  const questions = [
    t("Cicilan mobil 4 juta sebulan, masih aman?", "A Rp 4 juta monthly car installment: still safe?"),
    t("Anak pertama lahir tahun depan, tabungan masih jalan?", "First baby next year: can we keep saving?"),
    t("Pindah ke kontrakan yang lebih besar, sisa berapa tiap bulan?", "A bigger rental: what's left each month?"),
    t("Cicilan dan paylater sekarang sudah makan berapa persen gaji?", "How much of my salary do installments and paylater already take?"),
  ];
  return (
    <Section id="kenapa" className="pt-4 sm:pt-6">
      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <div className="max-w-2xl">
          <h2 className="text-[1.75rem] leading-tight font-extrabold tracking-tight text-balance sm:text-4xl">
            {t("Nyatat pengeluaran itu membosankan kalau nggak ada tujuannya.", "Tracking spending is boring when it isn't for anything.")}
          </h2>
          <p className="mt-3 text-pretty text-muted-foreground">
            {t(
              "Tujuannya biasanya datang sendiri: mau beli mobil, anak mau lahir, kontrak rumah mau habis. Saat itu kamu butuh rata-rata pengeluaran dari bulan-bulan yang sudah lewat, bukan perkiraan. JoyoArto mengumpulkannya dari statement, jadi kamu nggak perlu mengetik tiap transaksi.",
              "The reason usually shows up on its own: a car, a baby, a lease running out. Then you need your average spending from past months, not a guess. JoyoArto builds it from your statements, so you don't type in every purchase.",
            )}
          </p>
          <Link to="/demo" className={buttonVariants({ variant: "link", className: "mt-3 px-0" })}>
            {t("Coba dengan statement-mu di demo", "Try it with your statement in the demo")} <ArrowRight aria-hidden />
          </Link>
        </div>
        <ul className="space-y-2.5" aria-label={t("Contoh pertanyaan", "Example questions") as string}>
          {questions.map((q, i) => (
            <li key={i} className="rounded-3xl rounded-tl-md bg-card px-4 py-3 font-semibold text-pretty">
              {q}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function HowItWorks({ t }: { t: T }) {
  const steps = [
    {
      n: "1",
      title: t("Upload statement", "Upload a statement"),
      body: t(
        "Download e-statement Bank Jago dan GoPay (PDF) dari aplikasinya, lalu taruh di JoyoArto. Bank lain bisa lewat CSV atau minta Claude bacain PDF-nya.",
        "Download your Bank Jago and GoPay e-statements (PDF) from their apps and drop them in. Other banks work via CSV, or ask Claude to read the PDF.",
      ),
    },
    {
      n: "2",
      title: t("Dicek sampai cocok", "Checked until it adds up"),
      body: t(
        "Setiap saldo berjalan dan total per pocket dihitung ulang. Kalau ada satu angka yang meleset, nggak ada yang disimpan. Upload ulang pun aman, nggak dobel.",
        "Every running balance and pocket total is recomputed. If a single number is off, nothing is saved. Re-uploading is safe too: nothing is counted twice.",
      ),
    },
    {
      n: "3",
      title: t("Tanya Claude, bikin rencana", "Ask Claude, make a plan"),
      body: t(
        "Sambungkan Claude, lalu tanya pakai bahasa sehari-hari. Atau simulasikan keputusan besar: cicilan mobil, biaya bayi, pindah rumah.",
        "Connect Claude and ask in plain words. Or simulate a big decision: a car loan, baby costs, moving house.",
      ),
    },
  ];
  return (
    <Section id="cara-kerja">
      <Heading eyebrow={t("Cara kerjanya", "How it works")} title={t("Tiga langkah, sebulan sekali.", "Three steps, once a month.")} />
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n} className="rounded-3xl bg-card p-5">
            <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground">{s.n}</span>
            <h3 className="mt-3 text-lg font-bold tracking-tight">{s.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Features({ t }: { t: T }) {
  const items: { icon: ReactNode; title: ReactNode; body: ReactNode; soon?: boolean }[] = [
    {
      icon: <Icon d="M9 12l2 2 4-4M7 3h10a2 2 0 012 2v14l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 012-2z" />,
      title: t("Baca statement Jago & GoPay, dicek tiap saldonya", "Reads Jago & GoPay statements, checks every balance"),
      body: t(
        "Setiap pocket Jago jadi rekening sendiri. Saldo berjalan dan total harus cocok dengan statement, jadi angkanya bisa dipercaya.",
        "Every Jago pocket becomes its own account. Running balances and totals must match the statement, so you can trust the numbers.",
      ),
    },
    {
      icon: <Icon d="M8 7h12M8 7l3-3M8 7l3 3M16 17H4m12 0l-3-3m3 3l-3 3" />,
      title: t("“Gopay - Generic” jadi nama merchant asli", "“Gopay - Generic” becomes the real merchant"),
      body: t(
        "Bayar GoPay pakai Jago cuma tercatat “Gopay - Generic”. JoyoArto mencocokkan dengan e-statement GoPay, jadi kelihatan itu Kopi Kenangan atau Indomaret.",
        "Paying with GoPay from Jago only shows “Gopay - Generic”. JoyoArto matches it with the GoPay e-statement, so you see whether it was Kopi Kenangan or Indomaret.",
      ),
    },
    {
      icon: <Icon d="M17 20h5v-2a3 3 0 00-5.4-1.8M9 20H2v-2a4 4 0 017-2.6M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0z" />,
      title: t("Satu buku untuk keluarga", "One ledger for the family"),
      body: t(
        "Undang pasangan ke rumah tangga yang sama. Rekening, kategori dan rencana dipakai bareng, tiap orang tetap login pakai akunnya sendiri.",
        "Invite your spouse to the same household. Accounts, categories and plans are shared; everyone signs in with their own account.",
      ),
    },
    {
      icon: <Icon d="M8 10h8M8 14h5M21 12a9 9 0 01-13.4 7.8L3 21l1.2-4.6A9 9 0 1121 12z" />,
      title: t("Tanya Claude soal uangmu", "Ask Claude about your money"),
      body: t(
        "Konektor Claude (MCP) untuk claude.ai, Claude Desktop dan Claude Code. Claude bisa cari transaksi, rangkum pengeluaran dan bantu kategorikan, dengan izin dari kamu.",
        "A Claude connector (MCP) for claude.ai, Claude Desktop and Claude Code. Claude can search transactions, summarise spending and help categorise, with your permission.",
      ),
    },
    {
      icon: <Icon d="M3 17l6-6 4 4 8-8M14 7h7v7" />,
      title: t("Rencana & simulasi", "Plan & simulate"),
      body: t(
        "“Kuat nggak ambil mobil ini, padahal bayi mau lahir?” Hitungan dari data asli: dana darurat, porsi cicilan, saldo bulan demi bulan.",
        "“Can we afford this car with a baby on the way?” Worked out from your real data: emergency fund, share of income on loans, balance month by month.",
      ),
    },
    {
      icon: <Icon d="M12 5v14M5 12h14" />,
      title: t("Catat cepat, statement yang mengonfirmasi", "Quick add, the statement confirms"),
      body: t(
        "Ketik “kopi 25rb” (atau suruh Claude). Masuk sebagai pending dan langsung dihitung; nanti statement bulanan yang menggantikan dengan angka resminya.",
        "Type “coffee 25k” (or tell Claude). It is saved as pending and counted right away; the monthly statement later replaces it with the official row.",
      ),
    },
    {
      icon: <Icon d="M3 7h3l2-3h8l2 3h3v13H3zM12 17a4 4 0 100-8 4 4 0 000 8z" />,
      title: t("Foto struk & klaim reimburse", "Receipt photos & reimbursement claims"),
      body: t(
        "Foto struknya, AI yang mengisi. Tandai “Diganti kantor” supaya tidak terhitung pengeluaran rumah tangga, lalu buat laporan klaim PDF lengkap dengan foto struk untuk disetujui atasan.",
        "Snap the receipt and AI fills it in. Mark it “paid back by work” so it is not household spending, then make a PDF claim report with the receipts for approval.",
      ),
    },
    {
      icon: <Icon d="M16 18l6-6-6-6M8 6l-6 6 6 6" />,
      title: t("Open source (AGPL)", "Open source (AGPL)"),
      body: t(
        "Kodenya terbuka (AGPL). Mau host sendiri boleh; mau praktis, pakai versi yang kami jalankan, dengan Joyo Pro untuk batas yang lebih longgar.",
        "The code is open (AGPL). Host it yourself, or use the version we run for you, with Joyo Pro for higher limits.",
      ),
    },
    {
      icon: <Icon d="M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2zm4 17h2" />,
      title: t("Aplikasi Android & baca notifikasi", "Android app & notification capture"),
      body: t(
        "Aplikasi Android (tahap uji di Google Play) mencatat dari notifikasi Jago & GoPay dan menerima PDF statement. iPhone: segera, sementara pakai web dan iOS Shortcuts.",
        "The Android app (testing on Google Play) captures from Jago & GoPay notifications and takes statement PDFs. iPhone: soon; meanwhile use the web app and iOS Shortcuts.",
      ),
    },
  ];
  return (
    <Section id="fitur">
      <Heading
        eyebrow={t("Fitur", "Features")}
        title={t("Dibuat buat rekening yang kamu pakai beneran.", "Built for the accounts you actually use.")}
        sub={t(
          "JoyoArto membaca statement asli dan memastikan saldonya cocok dulu. Baru setelah itu Claude ikut bantu.",
          "JoyoArto reads the real statements and makes sure the balances add up first. Then Claude helps.",
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((f, i) => (
          <div key={i} className={cn("rounded-3xl p-5", f.soon ? "border-2 border-dashed border-border" : "bg-card")}>
            <div className="flex items-center justify-between">
              <span className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary-ink">{f.icon}</span>
              {f.soon && <Badge tone="warning">{t("Segera", "Soon")}</Badge>}
            </div>
            <h3 className="mt-3 font-bold tracking-tight text-balance">{f.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** Android closed testing: join the Google Group, then opt in on Play (lib/app-links.ts). iOS comes later via TestFlight. */
function AndroidTesters({ t }: { t: T }) {
  const steps = [
    {
      n: "1",
      icon: <Users aria-hidden className="size-5" />,
      title: t("Gabung grup tester", "Join the testers' group"),
      body: t(
        "Siapa pun bisa gabung. Pakai akun Google yang sama dengan di HP-mu.",
        "Anyone can join. Use the same Google account as on your phone.",
      ),
      href: ANDROID_TESTERS_GROUP_URL,
      cta: t("Buka Google Groups", "Open Google Groups"),
      small: ANDROID_TESTERS_GROUP_EMAIL,
    },
    {
      n: "2",
      icon: <Smartphone aria-hidden className="size-5" />,
      title: t("Daftar jadi tester, lalu pasang", "Opt in, then install"),
      body: t(
        "Ketuk “Jadi penguji” di halaman Google Play, lalu pasang JoyoArto dari Play Store. Update-nya datang lewat Play juga.",
        "Tap “Become a tester” on the Google Play page, then install JoyoArto from the Play Store. Updates come through Play too.",
      ),
      href: ANDROID_TESTING_URL,
      cta: t("Daftar di Google Play", "Opt in on Google Play"),
    },
  ];
  return (
    <Section id={ANDROID_SECTION_ID}>
      <div className="grid gap-8 rounded-[2rem] bg-card p-6 sm:p-10 lg:grid-cols-[1fr_1.2fr] lg:items-start">
        <div>
          <p className="text-sm font-bold text-primary">{t("Aplikasi HP", "Phone app")}</p>
          <h2 className="mt-1.5 text-[1.75rem] leading-tight font-extrabold tracking-tight text-balance sm:text-4xl">
            {t("Jadi tester aplikasi Android JoyoArto.", "Test the JoyoArto Android app.")}
          </h2>
          <p className="mt-3 text-pretty text-muted-foreground">
            {t(
              "Aplikasinya sudah di Google Play, masih tahap uji. Catat cepat, baca notifikasi Jago & GoPay, dan kirim PDF statement langsung dari HP. Dua langkah untuk memasangnya:",
              "It is on Google Play, still in testing. Quick add, capture from Jago & GoPay notifications, and send statement PDFs straight from your phone. Two steps to install it:",
            )}
          </p>
          <p className="mt-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge tone="warning">{t("Segera", "Soon")}</Badge>
            {t("iPhone: segera lewat TestFlight. Sementara itu, pakai web di Safari.", "iPhone: coming soon via TestFlight. Meanwhile, use the web app in Safari.")}
          </p>
        </div>
        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.n} className="rounded-3xl bg-muted/60 p-5">
              <div className="flex items-start gap-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground">{s.n}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold tracking-tight">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener"
                    className="mt-3 inline-flex min-h-11 items-center gap-2.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    {s.icon}
                    {s.cta}
                  </a>
                  {s.small && <p className="mt-2 text-xs break-all text-muted-foreground">{s.small}</p>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Privacy({ t }: { t: T }) {
  const points = [
    {
      title: t("Yang disimpan", "What is stored"),
      body: t(
        "Transaksi dari statement (tanggal, jumlah, keterangan asli, saldo), nama rekening/pocket, kategori dan catatanmu. Bukan PIN, bukan password bank: JoyoArto nggak pernah login ke bank-mu.",
        "Transactions from your statements (date, amount, original description, balance), account/pocket names, categories and your notes. Never a PIN or bank password: JoyoArto never logs in to your bank.",
      ),
    },
    {
      title: t("Demo: diproses di browser", "Demo: processed in your browser"),
      body: t(
        "Di halaman demo, PDF dibaca dan dihitung di perangkatmu sendiri. Nggak ada yang dikirim ke server, nggak ada yang disimpan.",
        "On the demo page the PDF is read and analysed on your own device. Nothing is sent to a server and nothing is kept.",
      ),
    },
    {
      title: t("Datamu tetap punyamu", "Your data stays yours"),
      body: t(
        "Data dipisah per rumah tangga; cuma anggota yang kamu undang yang bisa lihat. Claude hanya bisa akses kalau kamu sendiri yang menyambungkan dan menyetujuinya.",
        "Data is separated per household; only members you invite can see it. Claude gets access only when you connect it and approve it yourself.",
      ),
    },
    {
      title: t("Kode terbuka", "Open code"),
      body: t("Semua logikanya bisa dibaca (AGPL): cek sendiri, atau jalankan di server-mu.", "All the logic is readable (AGPL): check it yourself, or run it on your own server."),
    },
  ];
  return (
    <Section id="privasi" className="bg-[oklch(0.25_0.06_268)] text-white">
      <div className="mb-8 max-w-2xl sm:mb-10">
        <p className="text-sm font-bold text-coin">{t("Privasi", "Privacy")}</p>
        <h2 className="mt-1.5 text-[1.75rem] leading-tight font-extrabold tracking-tight text-balance sm:text-4xl">
          {t("Uang itu urusan pribadi. Kami anggap begitu juga.", "Money is personal. We treat it that way.")}
        </h2>
        <p className="mt-3 text-pretty text-white/70">
          {t(
            "Kodenya terbuka, jadi siapa pun bisa periksa ke mana datamu pergi. Nggak dijual, nggak dipakai buat iklan.",
            "The code is open, so anyone can check where your data goes. Never sold, never used for ads.",
          )}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {points.map((p, i) => (
          <div key={i} className="rounded-3xl bg-white/[0.07] p-5">
            <h3 className="font-bold">{p.title}</h3>
            <p className="mt-1.5 text-sm text-white/70">{p.body}</p>
          </div>
        ))}
      </div>
      {REPO_URL && (
        <p className="mt-6 text-sm text-white/70">
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="underline hover:text-white">
            {t("Lihat kode sumbernya", "Read the source code")}
          </a>
        </p>
      )}
    </Section>
  );
}

function Pricing({ t }: { t: T }) {
  const tt = <V,>(id: V, eng: V): V => t(id as ReactNode, eng as ReactNode) as V;
  return (
    <Section id="harga">
      <Heading
        eyebrow={t("Harga", "Pricing")}
        title={t("Gratis untuk mulai. Joyo Pro kalau perlu lebih.", "Free to start. Joyo Pro when you need more.")}
        sub={t(
          "Joyo Pro itu satu langganan per akun yang membuka Pro di JoyoArto, JoyoRogo dan JoyoFit. Dibeli di JoyoRogo dengan akun Google yang sama.",
          "Joyo Pro is one subscription per account that unlocks Pro in JoyoArto, JoyoRogo and JoyoFit. You buy it in JoyoRogo with the same Google account.",
        )}
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

function Waitlist({ t }: { t: T }) {
  return (
    <Section id="waitlist">
      <div className="mx-auto grid max-w-4xl gap-8 rounded-[2rem] bg-primary-soft p-6 sm:p-10 lg:grid-cols-2">
        <div>
          <p className="text-sm font-bold text-primary-ink">Waitlist</p>
          <h2 className="mt-1.5 text-[1.75rem] leading-tight font-extrabold tracking-tight text-balance sm:text-3xl">{t("Jadi yang pertama pakai JoyoArto.", "Be first in line for JoyoArto.")}</h2>
          <p className="mt-3 text-muted-foreground">
            {t(
              "Versi hosted, tinggal pakai. Gratis untuk mulai; Joyo Pro (dibeli di JoyoRogo) membuka batas yang lebih longgar.",
              "The hosted version, ready to use. Free to start; Joyo Pro (bought in JoyoRogo) raises the limits.",
            )}
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("Kasih tahu bank yang kamu pakai, biar kami tahu mana yang dibikin duluan.", "Tell us which banks you use, so we know which to support next.")}
          </p>
        </div>
        <WaitlistForm source="landing" />
      </div>
    </Section>
  );
}

function Faq({ t }: { t: T }) {
  const qa: [ReactNode, ReactNode][] = [
    [
      t("Bank apa aja yang bisa dibaca?", "Which banks can it read?"),
      t(
        "Sekarang Bank Jago (statement bulanan) dan GoPay (e-statement), langsung dibaca dan diverifikasi oleh JoyoArto. Berikutnya: BCA, BRI, Mandiri, DANA, SeaBank dan lainnya, urutannya ikut permintaan di waitlist. Sementara itu, bank lain bisa lewat CSV atau minta Claude membaca PDF-nya.",
        "Today: Bank Jago (monthly statements) and GoPay (e-statements), read and verified by JoyoArto itself. Next: BCA, BRI, Mandiri, DANA, SeaBank and more, in the order the waitlist asks for them. Meanwhile, other banks work via CSV or by asking Claude to read the PDF.",
      ),
    ],
    [
      t("Berapa harganya?", "How much does it cost?"),
      t(
        "Ada paket Free (catat manual, CSV, 2 import statement sebulan) dan Joyo Pro: satu langganan per akun yang juga membuka Pro di JoyoRogo dan JoyoFit, dibeli di JoyoRogo per bulan atau per tahun. Harga terbarunya ada di halaman Harga. Kalau mau gratis sepenuhnya, kodenya open source: silakan host sendiri.",
        "There is a Free plan (manual entries, CSV, 2 statement imports a month) and Joyo Pro: one subscription per account that also unlocks Pro in JoyoRogo and JoyoFit, bought in JoyoRogo monthly or yearly. Current prices are on the Pricing page. If you'd rather not pay at all, the code is open source: host it yourself.",
      ),
    ],
    [
      t("Apakah JoyoArto nyambung langsung ke rekening bank?", "Does JoyoArto connect to my bank account?"),
      t(
        "Nggak. JoyoArto nggak minta login bank dan nggak menarik data otomatis. Kamu yang download statement dari aplikasi bank lalu upload. Lebih repot sedikit, tapi lebih aman dan angkanya bisa dicek.",
        "No. JoyoArto never asks for your bank login and does not pull data automatically. You download the statement from your bank app and upload it. A little more effort, but safer, and the numbers can be checked.",
      ),
    ],
    [
      t("Harus pakai Claude?", "Do I need Claude?"),
      t(
        "Nggak wajib. Dashboard, import, kategori dan simulasi semua ada di web. Claude itu bonus: kalau kamu sudah pakai Claude, tinggal sambungkan dan tanya.",
        "No. The dashboard, imports, categories and simulations are all in the web app. Claude is a bonus: if you already use it, connect it and ask.",
      ),
    ],
    [
      t("Ada aplikasi HP?", "Is there a mobile app?"),
      t(
        "Ada untuk Android, sudah di Google Play dalam tahap uji: catat cepat, baca notifikasi Jago dan GoPay, dan kirim PDF statement dari HP. Versi iPhone segera lewat TestFlight; sementara itu web-nya enak dipakai di HP dan ada iOS Shortcuts buat catat cepat.",
        "Yes for Android, on Google Play in testing: quick add, capture from Jago and GoPay notifications, and send statement PDFs from your phone. An iPhone version is coming via TestFlight; meanwhile the web app works well on phones and iOS Shortcuts can quick-add.",
      ),
    ],
    [
      t("Gimana cara pasang aplikasi Android-nya?", "How do I install the Android app?"),
      t(
        "Dua langkah. Pertama, gabung grup Google joyoarto-testers (groups.google.com/g/joyoarto-testers, siapa pun bisa gabung) pakai akun Google yang ada di HP-mu. Kedua, buka play.google.com/apps/testing/com.joyodigitama.joyoarto, ketuk “Jadi penguji”, lalu pasang JoyoArto dari Play Store.",
        "Two steps. First, join the joyoarto-testers Google Group (groups.google.com/g/joyoarto-testers, anyone can join) with the Google account on your phone. Second, open play.google.com/apps/testing/com.joyodigitama.joyoarto, tap “Become a tester”, then install JoyoArto from the Play Store.",
      ),
    ],
    [
      t("Data saya dipakai buat apa?", "What is my data used for?"),
      t(
        "Cuma buat nampilin keuanganmu ke kamu (dan anggota rumah tangga yang kamu undang). Datamu nggak kami jual dan nggak dipakai buat iklan.",
        "Only to show your finances to you (and household members you invite). We never sell your data or use it for ads.",
      ),
    ],
  ];
  return (
    <Section id="faq">
      <Heading eyebrow="FAQ" title={t("Yang sering ditanyain", "Common questions")} />
      <div className="max-w-3xl divide-y divide-border overflow-hidden rounded-3xl bg-card">
        {qa.map(([q, a], i) => (
          <details key={i} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
              {q}
              <Plus className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-45" aria-hidden="true" />
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
