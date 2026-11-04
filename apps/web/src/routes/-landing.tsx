// Public landing page at "/" for visitors who are not signed in. Copy is Bahasa Indonesia first (casual, "kamu"),
// English via the toggle. Claims stay within what JoyoArto does today; future work is labelled "segera" / "soon".

import { Badge } from "@baroka/ui/components/badge";
import { buttonVariants } from "@baroka/ui/components/button";
import { cn } from "@baroka/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { PricingPlans } from "@/components/pricing";
import { PublicFooter, PublicHeader, REPO_URL, WaitlistForm } from "@/components/public";
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
        <HowItWorks t={t} />
        <Features t={t} />
        <Privacy t={t} />
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
            {t("Catat keuangan keluarga.", "Track your family's money.")}{" "}
            <span className="text-primary">{t("Tanpa ada yang nyadap.", "Nobody listening in.")}</span>
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground text-pretty">
            {t(
              "Kodenya terbuka, jadi siapa pun bisa periksa ke mana datamu pergi. Nggak dijual, nggak dipakai buat iklan. Upload e-statement, JoyoArto cek setiap saldo sampai cocok, lalu tinggal tanya: “bulan ini kita habis berapa buat makan di luar?”",
              "The code is open, so anyone can check where your data goes. Never sold, never used for ads. Upload your statements, JoyoArto checks every balance until it adds up, then just ask: “how much did we spend eating out this month?”",
            )}
          </p>
          <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
            <a href="#waitlist" className={buttonVariants({ size: "lg" })}>
              {t("Gabung waitlist", "Join the waitlist")}
            </a>
            <Link to="/demo" className={buttonVariants({ variant: "outline", size: "lg", className: "border-transparent" })}>
              {t("Coba demo, tanpa akun", "Try the demo, no account")} <ArrowRight aria-hidden />
            </Link>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
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
      icon: <Icon d="M16 18l6-6-6-6M8 6l-6 6 6 6" />,
      title: t("Open source (AGPL)", "Open source (AGPL)"),
      body: t(
        "Kodenya terbuka (AGPL). Mau host sendiri boleh; mau praktis, pakai JoyoArto Pro yang kami jalankan.",
        "The code is open (AGPL). Host it yourself, or use JoyoArto Pro, which we run for you.",
      ),
    },
    {
      icon: <Icon d="M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2zm4 17h2" />,
      title: t("Aplikasi HP & baca notifikasi", "Mobile app & notification capture"),
      body: t(
        "Sekarang lewat web di HP dan iOS Shortcuts. Aplikasi Android yang bisa baca notifikasi bank: segera.",
        "Today: the web app on your phone and iOS Shortcuts. An Android app that reads bank notifications: soon.",
      ),
      soon: true,
    },
  ];
  return (
    <Section id="fitur">
      <Heading
        eyebrow={t("Fitur", "Features")}
        title={t("Dibuat buat rekening yang kamu pakai beneran.", "Built for the accounts you actually use.")}
        sub={t(
          "Bukan cuma chatbot di atas catatan manual. JoyoArto membaca statement asli, membuktikan angkanya, baru kemudian AI ikut bantu.",
          "Not just a chatbot on top of manual entries. JoyoArto reads the real statements and proves the numbers first; then AI helps.",
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
        title={t("Gratis untuk mulai. Pro untuk seluruh keluarga.", "Free to start. Pro for the whole family.")}
        sub={t(
          "Satu langganan per rumah tangga, jadi kamu dan pasangan sama-sama Pro. Bayar pakai QRIS, e-wallet atau virtual account.",
          "One plan per household, so you and your partner both get Pro. Pay with QRIS, e-wallets or a virtual account.",
        )}
      />
      <PricingPlans
        t={tt}
        action={() => (
          <Link to="/pricing" className={buttonVariants({ className: "w-full" })}>
            {t("Pilih Pro", "Choose Pro")} <ArrowRight aria-hidden />
          </Link>
        )}
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
          <h2 className="mt-1.5 text-[1.75rem] leading-tight font-extrabold tracking-tight text-balance sm:text-3xl">{t("Jadi yang pertama pakai JoyoArto Pro.", "Be first in line for JoyoArto Pro.")}</h2>
          <p className="mt-3 text-muted-foreground">
            {t(
              "Versi hosted, tinggal pakai. Harganya nanti murah, dalam rupiah, dan yang gabung sekarang dapat harga founder.",
              "The hosted version, ready to use. It will be cheap, priced in rupiah, and people who join now get a founder price.",
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
        "Ada paket Free (catat manual, CSV, 2 import statement sebulan) dan Pro untuk seluruh rumah tangga, dalam rupiah, bayar per bulan atau per tahun. Rumah tangga yang beli lebih awal dapat harga founder. Kalau mau gratis sepenuhnya, kodenya open source: silakan host sendiri.",
        "There is a Free plan (manual entries, CSV, 2 statement imports a month) and Pro for the whole household, in rupiah, paid monthly or yearly. Early households get a founder price. If you'd rather not pay at all, the code is open source: host it yourself.",
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
        "Web-nya enak dipakai di HP, dan ada iOS Shortcuts buat catat cepat. Aplikasi Android dan pencatatan dari notifikasi: segera.",
        "The web app works well on phones, and iOS Shortcuts can quick-add. An Android app and capture from notifications: soon.",
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
