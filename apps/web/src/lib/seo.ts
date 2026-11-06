// Search and social sharing for the public site (arto.joyorogo.com): per-page meta, share cards, JSON-LD and the
// plain-HTML body crawlers read without JavaScript.
//
// Used in three places, so keep this module free of React, DOM and "@/" imports:
// - scripts/prerender.ts (run by vite build) writes dist/<page>.html with these tags in <head>;
// - src/lib/head.ts keeps document.title and the tags in sync on client-side navigation;
// - scripts/og.ts draws the share cards from OG_CARDS.
// Copy is Indonesian (the site's default language). The English toggle has no URL of its own, so there is no hreflang.

import {
  ANDROID_SECTION_ID,
  ANDROID_TESTERS_GROUP_EMAIL,
  ANDROID_TESTERS_GROUP_URL,
  ANDROID_TESTING_URL,
  IOS_SECTION_ID,
  IOS_TESTFLIGHT_URL,
  TESTFLIGHT_APP_STORE_URL,
} from "./app-links";
import { CONTACT_EMAIL, PRODUCT_NAME, SITE_URL } from "./brand";

export const REPO = "https://github.com/dzulfikar08/joyoarto";
export const LANDING_HOST = new URL(SITE_URL).hostname;

/**
 * Joyo Pro monthly price ladder in whole rupiah (structured data only; the pricing page reads live prices from the
 * server). Keep in step with the billing config when prices change.
 */
export const PRO_MONTHLY_IDR = [15000, 29000, 49000] as const;

// ---------------------------------------------------------------------------------------------------------------
// Share cards (1200×630, public/og/*.png, drawn by scripts/og.ts)

export type OgCard = { file: string; eyebrow?: string; title: [string, string]; sub: string; alt: string };

const card = (c: OgCard) => c;
/**
 * Bump when the cards change (scripts/og.ts): WhatsApp, Telegram, X and Facebook cache share images by URL for days,
 * so a new ?v= makes them fetch the new picture.
 */
export const OG_VERSION = "20261105";
/** Absolute-path URL of a share card, versioned for scraper caches. */
export const ogPath = (c: Pick<OgCard, "file">) => `/${c.file}?v=${OG_VERSION}`;
export const OG = {
  home: card({
    file: "og/home.png",
    title: ["Mampu nggak beli mobil?", "Lihat dulu angkanya."],
    sub: "Dihitung dari e-statement Jago & GoPay-mu: dana darurat, porsi cicilan, sisa tiap bulan.",
    alt: "JoyoArto: Mampu nggak beli mobil? Lihat dulu angkanya, dihitung dari e-statement Jago & GoPay-mu.",
  }),
  demo: card({
    file: "og/demo.png",
    eyebrow: "Demo tanpa akun",
    title: ["Coba pakai e-statement", "Jago & GoPay-mu."],
    sub: "Dibaca di browser-mu sendiri. Nggak diunggah ke mana-mana.",
    alt: "Demo JoyoArto: coba pakai e-statement Jago & GoPay-mu, dibaca di browser tanpa diunggah.",
  }),
  pricing: card({
    file: "og/pricing.png",
    eyebrow: "Harga",
    title: ["Gratis untuk mulai.", "Satu Pro, tiga aplikasi."],
    sub: "Satu langganan Joyo Pro: JoyoArto, JoyoRogo dan JoyoFit.",
    alt: "Harga JoyoArto: gratis untuk mulai, Joyo Pro satu langganan untuk JoyoArto, JoyoRogo dan JoyoFit.",
  }),
  claude: card({
    file: "og/claude.png",
    eyebrow: "Konektor Claude",
    title: ["Tanya Claude", "soal uangmu."],
    sub: "Sambungkan JoyoArto ke Claude: pengeluaran, anggaran, cicilan. Kamu yang pegang izinnya.",
    alt: "JoyoArto untuk Claude: sambungkan buku keuangan keluargamu ke Claude dan tanya soal pengeluaran, anggaran dan cicilan.",
  }),
  legal: card({
    file: "og/legal.png",
    eyebrow: "Privasi & syarat",
    title: ["Uang itu urusan pribadi.", "Datamu tetap punyamu."],
    sub: "Nggak dijual, nggak dipakai buat iklan. Sesuai UU PDP, kodenya terbuka.",
    alt: "JoyoArto: uang itu urusan pribadi, datamu tetap punyamu. Kebijakan privasi dan syarat layanan.",
  }),
  /** public/og.png: the fallback for any page without its own card (same picture as home). */
  default: card({
    file: "og.png",
    title: ["Mampu nggak beli mobil?", "Lihat dulu angkanya."],
    sub: "Dihitung dari e-statement Jago & GoPay-mu: dana darurat, porsi cicilan, sisa tiap bulan.",
    alt: "JoyoArto: Mampu nggak beli mobil? Lihat dulu angkanya.",
  }),
} satisfies Record<string, OgCard>;
export const OG_CARDS: OgCard[] = Object.values(OG);
export const OG_SIZE = { width: 1200, height: 630 } as const;

// ---------------------------------------------------------------------------------------------------------------
// FAQ (the landing page's FAQ in Indonesian, word for word; seo.test.ts fails when -landing.tsx changes it)

export const FAQ: { q: string; a: string }[] = [
  {
    q: "Bank apa aja yang bisa dibaca?",
    a: "Sekarang Bank Jago (statement bulanan) dan GoPay (e-statement), langsung dibaca dan diverifikasi oleh JoyoArto. Berikutnya: BCA, BRI, Mandiri, DANA, SeaBank dan lainnya. Sementara itu, bank lain bisa lewat CSV atau minta Claude membaca PDF-nya.",
  },
  {
    q: "Berapa harganya?",
    a: "Ada paket Free (catat manual, CSV, 2 import statement sebulan) dan Joyo Pro: satu langganan per akun yang juga membuka Pro di JoyoRogo dan JoyoFit, dibeli di JoyoRogo per bulan atau per tahun. Harga terbarunya ada di halaman Harga. Kalau mau gratis sepenuhnya, kodenya open source: silakan host sendiri.",
  },
  {
    q: "Apakah JoyoArto nyambung langsung ke rekening bank?",
    a: "Nggak. JoyoArto nggak minta login bank dan nggak menarik data otomatis. Kamu yang download statement dari aplikasi bank lalu upload. Lebih repot sedikit, tapi lebih aman dan angkanya bisa dicek.",
  },
  {
    q: "Harus pakai Claude?",
    a: "Nggak wajib. Dashboard, import, kategori dan simulasi semua ada di web. Claude itu bonus: kalau kamu sudah pakai Claude, tinggal sambungkan dan tanya.",
  },
  {
    q: "Ada aplikasi HP?",
    a: IOS_TESTFLIGHT_URL
      ? "Ada untuk Android, sudah di Google Play dalam tahap uji: catat cepat, baca notifikasi Jago dan GoPay, dan kirim PDF statement dari HP. Versi iPhone juga ada dalam tahap uji lewat TestFlight; langkahnya ada di bagian iPhone di atas."
      : "Ada untuk Android, sudah di Google Play dalam tahap uji: catat cepat, baca notifikasi Jago dan GoPay, dan kirim PDF statement dari HP. Versi iPhone dibagikan lewat TestFlight dan link publiknya segera; langkahnya ada di bagian iPhone di atas. Sementara itu web-nya enak dipakai di Safari dan ada iOS Shortcuts buat catat cepat.",
  },
  {
    q: "Gimana cara pasang aplikasi Android-nya?",
    a: "Tiga langkah. Pertama, gabung grup Google joyoarto-testers (groups.google.com/g/joyoarto-testers, siapa pun bisa gabung) pakai akun Google yang ada di HP-mu. Kedua, buka play.google.com/apps/testing/com.joyodigitama.joyoarto, ketuk “Jadi penguji”, lalu pasang JoyoArto dari Play Store. Ketiga, buka aplikasinya dan masuk pakai Google; rumah tanggamu langsung dibuat.",
  },
  {
    q: "Data saya dipakai buat apa?",
    a: "Cuma buat nampilin keuanganmu ke kamu (dan anggota rumah tangga yang kamu undang). Datamu nggak kami jual dan nggak dipakai buat iklan.",
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Pages

export type PublicPage = {
  path: "/" | "/demo" | "/pricing" | "/claude" | "/privasi" | "/syarat";
  /** File in dist/ (Workers assets serve demo.html at /demo). */
  file: string;
  /** Route sources whose last commit dates the page (sitemap lastmod). */
  sources: string[];
  title: string;
  description: string;
  /** Shorter, punchier copy for share previews; defaults to title/description. */
  social?: { title: string; description: string };
  og: OgCard;
  priority: number;
  /** Plain HTML for crawlers without JavaScript (hidden once the app runs). */
  body: () => string;
};

export const SITE_NAME = PRODUCT_NAME;
export const url = (path: string) => (path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`);

const SOFTWARE_DESCRIPTION =
  "Aplikasi keuangan keluarga open source untuk Indonesia: baca e-statement Bank Jago dan GoPay, cek setiap saldo sampai cocok, atur anggaran rumah tangga bareng pasangan, dan tanya Claude soal uangmu.";

export const PAGES: PublicPage[] = [
  {
    path: "/",
    file: "index.html",
    sources: ["src/routes/-landing.tsx", "src/routes/index.tsx"],
    title: "JoyoArto: Mampu Nggak Beli Mobil? Cek dari e-Statement Jago & GoPay",
    description:
      "Cicilan di brosur selalu kelihatan ringan. JoyoArto baca e-statement Jago & GoPay-mu, hitung uang masuk dan keluar tiap bulan, lalu uji cicilannya.",
    social: {
      title: "Mampu nggak beli mobil? Lihat dulu angkanya.",
      description: "JoyoArto baca e-statement Jago & GoPay-mu, lalu uji cicilannya: dana darurat masih 6 bulan, total cicilan di bawah 30% penghasilan. Coba demonya tanpa akun.",
    },
    og: OG.home,
    priority: 1,
    body: homeBody,
  },
  {
    path: "/demo",
    file: "demo.html",
    sources: ["src/routes/demo.tsx"],
    title: "Demo JoyoArto: Baca e-Statement Bank Jago & GoPay Tanpa Akun",
    description:
      "Taruh e-statement Bank Jago atau GoPay (PDF) dan lihat pengeluaran per kategori, plus merchant asli di balik “Gopay - Generic”. Diproses di browser, nggak diunggah.",
    social: {
      title: "Coba JoyoArto pakai e-statement Jago & GoPay-mu",
      description: "Tanpa akun. PDF-nya dibaca di browser-mu sendiri dan nggak diunggah ke mana-mana.",
    },
    og: OG.demo,
    priority: 0.8,
    body: demoBody,
  },
  {
    path: "/pricing",
    file: "pricing.html",
    sources: ["src/routes/pricing.tsx", "src/components/pricing.tsx"],
    title: "Harga JoyoArto: Gratis untuk Mulai, Joyo Pro untuk Keluarga",
    description:
      "Mulai gratis. Joyo Pro, satu langganan untuk JoyoArto, JoyoRogo dan JoyoFit: import e-statement tanpa batas, konektor Claude dan simulasi rencana keluarga.",
    og: OG.pricing,
    priority: 0.8,
    body: pricingBody,
  },
  {
    path: "/claude",
    file: "claude.html",
    sources: ["src/routes/claude.tsx"],
    title: "JoyoArto untuk Claude: Sambungkan Keuangan Keluarga ke Claude",
    description:
      "Cara menyambungkan JoyoArto ke Claude (konektor MCP): data apa yang dilihat Claude, izin baca dan tulis, contoh pertanyaan, dan cara memutuskannya.",
    social: {
      title: "Tanya Claude soal uangmu",
      description: "Sambungkan JoyoArto ke Claude: pengeluaran, anggaran dan simulasi cicilan dari transaksimu sendiri. Kamu yang pegang izinnya.",
    },
    og: OG.claude,
    priority: 0.6,
    body: claudeBody,
  },
  {
    path: "/privasi",
    file: "privasi.html",
    sources: ["src/routes/privasi.tsx"],
    title: "Kebijakan Privasi JoyoArto",
    description:
      "Data apa yang disimpan JoyoArto, untuk apa dan berapa lama, serta hak-hakmu menurut UU PDP. Datamu nggak dijual dan nggak dipakai buat iklan.",
    og: OG.legal,
    priority: 0.3,
    body: () => legalBody("Kebijakan Privasi", "Data apa yang disimpan JoyoArto, untuk apa dan berapa lama, serta hak-hakmu menurut UU PDP (UU No. 27 Tahun 2022)."),
  },
  {
    path: "/syarat",
    file: "syarat.html",
    sources: ["src/routes/syarat.tsx"],
    title: "Syarat Layanan JoyoArto",
    description: "Syarat penggunaan layanan JoyoArto: akun, rumah tangga dan anggotanya, langganan Joyo Pro, dan batas tanggung jawab.",
    og: OG.legal,
    priority: 0.3,
    body: () => legalBody("Syarat Layanan", "Syarat penggunaan layanan JoyoArto yang kami jalankan: akun, rumah tangga dan anggotanya, langganan Joyo Pro, dan batas tanggung jawab."),
  },
];

export const pageFor = (pathname: string): PublicPage | undefined => {
  const path = pathname.replace(/\/+$/, "").replace(/\.html$/, "") || "/";
  return PAGES.find((p) => p.path === path);
};

// ---------------------------------------------------------------------------------------------------------------
// <head>

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Every tag a public page needs, as HTML (prerender). The client mirrors the changing ones in head.ts. */
export function headTags(page: PublicPage): string {
  const canonical = url(page.path);
  const social = page.social ?? { title: page.title, description: page.description };
  const image = url(ogPath(page.og));
  const meta = (attr: "name" | "property", key: string, value: string | number) => `<meta ${attr}="${key}" content="${esc(String(value))}" />`;
  return [
    `<title>${esc(page.title)}</title>`,
    meta("name", "description", page.description),
    meta("name", "robots", "index, follow, max-image-preview:large"),
    `<link rel="canonical" href="${canonical}" />`,
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", SITE_NAME),
    meta("property", "og:url", canonical),
    meta("property", "og:title", social.title),
    meta("property", "og:description", social.description),
    meta("property", "og:image", image),
    meta("property", "og:image:secure_url", image),
    meta("property", "og:image:type", "image/png"),
    meta("property", "og:image:width", OG_SIZE.width),
    meta("property", "og:image:height", OG_SIZE.height),
    meta("property", "og:image:alt", page.og.alt),
    meta("property", "og:locale", "id_ID"),
    meta("property", "og:locale:alternate", "en_US"),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", social.title),
    meta("name", "twitter:description", social.description),
    meta("name", "twitter:image", image),
    meta("name", "twitter:image:alt", page.og.alt),
    `<script type="application/ld+json">${JSON.stringify(jsonLd(page)).replace(/</g, "\\u003c")}</script>`,
  ].join("\n    ");
}

// ---------------------------------------------------------------------------------------------------------------
// Structured data (schema.org JSON-LD, one @graph per page)

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${SITE_URL}/#app`;

export function jsonLd(page: PublicPage): Record<string, unknown> {
  const pageUrl = url(page.path);
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: "JoyoDigitama",
      url: `${SITE_URL}/`,
      logo: { "@type": "ImageObject", url: url("/icon-512.png"), width: 512, height: 512 },
      email: CONTACT_EMAIL,
      sameAs: [REPO],
    },
    {
      "@type": "WebSite",
      "@id": SITE_ID,
      url: `${SITE_URL}/`,
      name: SITE_NAME,
      inLanguage: "id-ID",
      publisher: { "@id": ORG_ID },
    },
    {
      "@type": "WebPage",
      "@id": pageUrl,
      url: pageUrl,
      name: page.title,
      description: page.description,
      inLanguage: "id-ID",
      isPartOf: { "@id": SITE_ID },
      about: { "@id": APP_ID },
      primaryImageOfPage: { "@type": "ImageObject", url: url(ogPath(page.og)), width: OG_SIZE.width, height: OG_SIZE.height },
    },
  ];
  if (page.path === "/" || page.path === "/pricing") graph.push(softwareApplication());
  if (page.path === "/") {
    graph.push({
      "@type": "FAQPage",
      "@id": `${pageUrl}#faq`,
      inLanguage: "id-ID",
      isPartOf: { "@id": pageUrl },
      mainEntity: FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

function softwareApplication(): Record<string, unknown> {
  const pricing = url("/pricing");
  return {
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    description: SOFTWARE_DESCRIPTION,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web, Android",
    inLanguage: ["id-ID", "en-US"],
    image: url(ogPath(OG.home)),
    publisher: { "@id": ORG_ID },
    license: "https://www.gnu.org/licenses/agpl-3.0.html",
    isAccessibleForFree: true,
    // No ratings or reviews: none are published, and none are invented.
    offers: [
      { "@type": "Offer", name: "Free", price: "0", priceCurrency: "IDR", url: pricing },
      ...PRO_MONTHLY_IDR.map((price) => ({
        "@type": "Offer",
        name: `Joyo Pro · Rp ${price.toLocaleString("id-ID")}/bulan`,
        price: String(price),
        priceCurrency: "IDR",
        url: pricing,
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price,
          priceCurrency: "IDR",
          unitCode: "MON",
          referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
        },
      })),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Body for crawlers without JavaScript (and people with it turned off). Same words as the pages, kept short.

const nav = () =>
  `<header><p><a href="/"><strong>JoyoArto</strong></a></p><nav aria-label="Navigasi"><a href="/#fitur">Fitur</a> · <a href="/demo">Demo</a> · <a href="/pricing">Harga</a> · <a href="/claude">Claude</a> · <a href="/#faq">FAQ</a> · <a href="https://app.arto.joyorogo.com/login">Masuk</a></nav></header>`;
const footer = () =>
  `<footer><p>JoyoArto oleh JoyoDigitama · <a href="/privasi">Kebijakan privasi</a> · <a href="/syarat">Syarat layanan</a> · <a href="${REPO}">Kode sumber (AGPL)</a> · <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p></footer>`;
const wrap = (main: string) => `${nav()}<main>${main}</main>${footer()}`;

function homeBody(): string {
  const features: [string, string][] = [
    ["Baca statement Jago & GoPay, dicek tiap saldonya", "Setiap pocket Jago jadi rekening sendiri. Saldo berjalan dan total harus cocok dengan statement, jadi angkanya bisa dipercaya."],
    ["“Gopay - Generic” jadi nama merchant asli", "JoyoArto mencocokkan pembayaran GoPay dari Jago dengan e-statement GoPay, jadi kelihatan itu Kopi Kenangan atau Indomaret."],
    ["Satu buku untuk keluarga", "Undang pasangan ke rumah tangga yang sama. Rekening, kategori dan rencana dipakai bareng, tiap orang tetap login pakai akunnya sendiri."],
    ["Tanya Claude soal uangmu", "Konektor Claude (MCP) untuk claude.ai, Claude Desktop dan Claude Code: cari transaksi, rangkum pengeluaran, bantu kategorikan."],
    ["Rencana & simulasi", "Kuat nggak ambil mobil ini, padahal bayi mau lahir? Hitungan dari data asli: dana darurat, porsi cicilan, saldo bulan demi bulan."],
    ["Aplikasi Android & baca notifikasi", "Aplikasi Android (tahap uji di Google Play) mencatat dari notifikasi Jago & GoPay dan menerima PDF statement. iPhone: " + (IOS_TESTFLIGHT_URL ? "tahap uji lewat TestFlight." : "lewat TestFlight, link publiknya segera; sementara itu pakai web di Safari.")],
    ["Open source (AGPL)", "Kodenya terbuka. Mau host sendiri boleh; mau praktis, pakai Joyo Pro yang kami jalankan."],
  ];
  return wrap(
    `<h1>Mampu nggak beli mobil? Lihat dulu angkanya.</h1>` +
      `<p>Cicilan di brosur dealer selalu kelihatan ringan. JoyoArto baca e-statement Jago dan GoPay-mu, hitung berapa yang benar-benar masuk dan keluar tiap bulan, lalu uji cicilannya: dana darurat masih cukup 6 bulan atau nggak, total cicilan masih di bawah 30% penghasilan atau nggak.</p>` +
      `<p><a href="https://app.arto.joyorogo.com/login">Daftar gratis</a> · <a href="/demo">Coba demo, tanpa akun</a> · <a href="/#${ANDROID_SECTION_ID}">Coba di Android</a> · <a href="/#${IOS_SECTION_ID}">Coba di iPhone</a></p>` +
      `<p>Simulasinya hitungan dari transaksimu sendiri, bukan nasihat keuangan.</p>` +
      `<section id="kenapa"><h2>Nyatat pengeluaran itu membosankan kalau nggak ada tujuannya.</h2>` +
      `<p>Tujuannya biasanya datang sendiri: mau beli mobil, anak mau lahir, kontrak rumah mau habis. Saat itu kamu butuh rata-rata pengeluaran dari bulan-bulan yang sudah lewat, bukan perkiraan. JoyoArto mengumpulkannya dari statement, jadi kamu nggak perlu mengetik tiap transaksi.</p><ul>` +
      `<li>Cicilan mobil 4 juta sebulan, masih aman?</li><li>Anak pertama lahir tahun depan, tabungan masih jalan?</li>` +
      `<li>Pindah ke kontrakan yang lebih besar, sisa berapa tiap bulan?</li><li>Cicilan dan paylater sekarang sudah makan berapa persen gaji?</li></ul></section>` +
      `<section id="cara-kerja"><h2>Cara kerjanya: tiga langkah, sebulan sekali</h2><ol>` +
      `<li><strong>Upload statement.</strong> Download e-statement Bank Jago dan GoPay (PDF) dari aplikasinya, lalu taruh di JoyoArto. Bank lain bisa lewat CSV.</li>` +
      `<li><strong>Dicek sampai cocok.</strong> Setiap saldo berjalan dan total per pocket dihitung ulang. Upload ulang pun aman, nggak dobel.</li>` +
      `<li><strong>Tanya Claude, bikin rencana.</strong> Tanya pakai bahasa sehari-hari, atau simulasikan cicilan mobil, biaya bayi, pindah rumah.</li></ol></section>` +
      `<section id="fitur"><h2>Fitur</h2>${features.map(([t, b]) => `<h3>${esc(t)}</h3><p>${esc(b)}</p>`).join("")}</section>` +
      `<section id="privasi"><h2>Uang itu urusan pribadi. Kami anggap begitu juga.</h2><p>Kodenya terbuka, jadi siapa pun bisa periksa ke mana datamu pergi. Nggak dijual, nggak dipakai buat iklan.</p></section>` +
      `<section id="${ANDROID_SECTION_ID}"><h2>Jadi tester aplikasi Android JoyoArto</h2>` +
      `<p>Aplikasinya sudah di Google Play, masih tahap uji. Tiga langkah untuk mulai:</p><ol>` +
      `<li><strong>Gabung grup tester.</strong> Siapa pun bisa gabung di <a href="${ANDROID_TESTERS_GROUP_URL}">Google Groups: joyoarto-testers</a> (${esc(ANDROID_TESTERS_GROUP_EMAIL)}), pakai akun Google yang sama dengan di HP-mu.</li>` +
      `<li><strong>Daftar jadi tester, lalu pasang.</strong> Buka <a href="${ANDROID_TESTING_URL}">halaman uji JoyoArto di Google Play</a>, ketuk “Jadi penguji”, lalu pasang JoyoArto dari Play Store.</li>` +
      `<li><strong>Masuk pakai Google, rumah tanggamu langsung dibuat.</strong></li></ol></section>` +
      `<section id="${IOS_SECTION_ID}"><h2>Coba JoyoArto di iPhone</h2>` +
      `<p>Versi iPhone dibagikan lewat TestFlight, aplikasi resmi Apple buat versi uji. Tiga langkah untuk mulai:</p><ol>` +
      `<li><strong>Pasang TestFlight dari App Store.</strong> <a href="${TESTFLIGHT_APP_STORE_URL}">TestFlight di App Store</a>.</li>` +
      (IOS_TESTFLIGHT_URL
        ? `<li><strong>Buka undangan TestFlight JoyoArto.</strong> Buka <a href="${IOS_TESTFLIGHT_URL}">link undangannya</a> di iPhone, lalu ketuk Accept, kemudian Install.</li>`
        : `<li><strong>Buka undangan TestFlight JoyoArto.</strong> Link publiknya segera kami pasang di sini. Sementara itu, pakai <a href="https://app.arto.joyorogo.com/login">versi web</a> di Safari dengan akun yang sama.</li>`) +
      `<li><strong>Masuk pakai Apple atau Google.</strong></li></ol></section>` +
      `<section id="faq"><h2>Yang sering ditanyain</h2>${FAQ.map(({ q, a }) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}</section>`,
  );
}

function demoBody(): string {
  return wrap(
    `<h1>Demo JoyoArto: baca e-statement Bank Jago & GoPay tanpa akun</h1>` +
      `<p>Taruh e-statement Bank Jago (statement bulanan) atau GoPay (PDF). JoyoArto membaca dan menghitungnya di browser-mu sendiri: saldo dicek sampai cocok, pengeluaran per kategori, dan merchant asli di balik “Gopay - Generic”. Nggak ada yang diunggah atau disimpan.</p>` +
      `<p>Demo ini butuh JavaScript. <a href="/">Kembali ke beranda</a>.</p>`,
  );
}

function pricingBody(): string {
  return wrap(
    `<h1>Harga JoyoArto</h1>` +
      `<p>Gratis untuk mulai: catat manual, quick add, import CSV dan beberapa import statement sebulan. Joyo Pro, satu langganan per akun yang juga membuka Pro di JoyoRogo dan JoyoFit: import e-statement tanpa batas, konektor Claude yang bisa mencatat dan mengubah data (MCP), simulasi rencana yang disimpan, dan lebih banyak anggota. Dibeli di JoyoRogo, harga dalam rupiah.</p>` +
      `<p>Kodenya open source (AGPL), jadi kamu juga bisa host sendiri secara gratis. <a href="https://app.arto.joyorogo.com/login">Mulai gratis</a>.</p>`,
  );
}

function claudeBody(): string {
  const mcp = "https://app.arto.joyorogo.com/mcp";
  return wrap(
    `<h1>Sambungkan JoyoArto ke Claude</h1>` +
      `<p>Tanya Claude soal uangmu pakai bahasa sehari-hari. Claude membaca buku keuangan rumah tanggamu di JoyoArto lewat konektor MCP, hanya setelah kamu menyambungkan dan menyetujuinya. Alamat server MCP: <code>${mcp}</code>.</p>` +
      `<h2>Yang kamu perlukan</h2><ul><li>Akun JoyoArto. Di paket Free, Claude bisa membaca dan menjawab; mencatat dan mengubah data lewat Claude termasuk di Joyo Pro.</li><li>Akun Claude: claude.ai, Claude Desktop, aplikasi HP, atau Claude Code.</li></ul>` +
      `<h2>Cara menyambungkan</h2><ol><li>Di Claude, buka Customize → Connectors.</li><li>Cari JoyoArto di direktori, atau pilih Add custom connector dan isi <code>${mcp}</code>.</li><li>Klik Connect, masuk ke JoyoArto, baca izinnya, lalu Allow.</li></ol>` +
      `<p>Claude Code: <code>claude mcp add --transport http joyoarto ${mcp}</code>, lalu /mcp untuk masuk.</p>` +
      `<h2>Izin: baca dan tulis</h2><p>Baca (finance:read): rekening, transaksi, anggaran, ringkasan dan simulasi. Tulis (finance:write): mencatat, meng-import dan mengkategorikan transaksi, aturan, anggaran, skenario. Kamu bisa memilih akses hanya-baca. Alat yang mengubah atau menghapus data ditandai destruktif, jadi Claude bertanya dulu.</p>` +
      `<h2>Data apa yang dilihat Claude</h2><p>Hanya hasil alat yang dipanggil untuk permintaanmu, dari rumah tangga yang aktif. Foto struk tidak pernah dikirim. JoyoArto mencatat pemanggilan alat (bukan hasilnya) selama 90 hari dan tidak membaca percakapanmu dengan Claude. <a href="/privasi">Kebijakan privasi</a>.</p>` +
      `<h2>Cara memutuskan</h2><p>Di JoyoArto: Settings → Data &amp; privacy → Connected AI apps → Disconnect (langsung berlaku). Di Claude: Customize → Connectors → JoyoArto → Remove.</p>` +
      `<p>Bantuan: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`,
  );
}

function legalBody(title: string, intro: string): string {
  return wrap(`<h1>${esc(title)}</h1><p>${esc(intro)}</p><p>Halaman lengkapnya butuh JavaScript. Pertanyaan: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`);
}
