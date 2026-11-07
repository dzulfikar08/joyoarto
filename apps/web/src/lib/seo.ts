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
  DISCORD_URL,
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
export const OG_VERSION = "20261106";
/** Absolute-path URL of a share card, versioned for scraper caches. */
export const ogPath = (c: Pick<OgCard, "file">) => `/${c.file}?v=${OG_VERSION}`;
export const OG = {
  home: card({
    file: "og/home.png",
    title: ["Keputusan uang besar,", "dengan angka yang pasti."],
    sub: "Mobil, rumah, anak pertama: dijawab dari semua rekening dan transaksimu sendiri.",
    alt: "JoyoArto: keputusan uang besar dengan angka yang pasti, dijawab dari semua rekening dan transaksimu sendiri.",
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
    title: ["Keputusan uang besar,", "dengan angka yang pasti."],
    sub: "Mobil, rumah, anak pertama: dijawab dari semua rekening dan transaksimu sendiri.",
    alt: "JoyoArto: keputusan uang besar dengan angka yang pasti.",
  }),
} satisfies Record<string, OgCard>;
export const OG_CARDS: OgCard[] = Object.values(OG);
export const OG_SIZE = { width: 1200, height: 630 } as const;

// ---------------------------------------------------------------------------------------------------------------
// FAQ (the landing page's FAQ in Indonesian, word for word; seo.test.ts fails when -landing.tsx changes it)

export const FAQ: { q: string; a: string }[] = [
  {
    q: "Bank apa aja yang bisa dibaca?",
    a: "Bank Jago dan GoPay dibaca dan diverifikasi otomatis. Bank lain bisa lewat CSV atau minta Claude membaca PDF-nya. BCA, BRI, Mandiri dan lainnya menyusul.",
  },
  {
    q: "Apakah JoyoArto nyambung langsung ke rekening bank?",
    a: "Nggak. JoyoArto nggak pernah minta login bank. Kamu download statement dari aplikasi bank lalu upload, jadi lebih aman dan angkanya bisa dicek.",
  },
  {
    q: "Berapa harganya?",
    a: "Paket Free gratis selamanya. Joyo Pro adalah satu langganan per akun yang juga membuka Pro di JoyoRogo dan JoyoFit, bulanan atau tahunan. Kodenya open source, jadi kamu juga bisa host sendiri.",
  },
  {
    q: "Harus pakai Claude?",
    a: "Nggak wajib. Semua fitur ada di web dan aplikasi, termasuk Joyo AI. Claude itu bonus kalau kamu sudah memakainya.",
  },
  {
    q: "Gimana cara pasang aplikasi Android-nya?",
    a: "Gabung grup Google joyoarto-testers (groups.google.com/g/joyoarto-testers), buka play.google.com/apps/testing/com.joyodigitama.joyoarto dan ketuk “Jadi penguji”, lalu pasang JoyoArto dari Play Store dan masuk pakai Google. Ada bug atau pertanyaan? Gabung Discord kami di discord.gg/vtud8UYekp.",
  },
  {
    q: "Data saya dipakai buat apa?",
    a: "Cuma buat nampilin keuanganmu ke kamu dan anggota rumah tangga yang kamu undang. Nggak dijual, nggak dipakai buat iklan.",
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
  "Aplikasi keuangan pribadi dan keluarga open source untuk Indonesia: semua rekening, arus kas, anggaran dan simulasi rencana besar dalam satu tempat, dihitung dari e-statement asli, dengan asisten AI.";

export const PAGES: PublicPage[] = [
  {
    path: "/",
    file: "index.html",
    sources: ["src/routes/-landing.tsx", "src/routes/index.tsx"],
    title: "JoyoArto: Aplikasi Keuangan Pribadi & Keluarga",
    description:
      "Keputusan uang besar dengan angka yang pasti. Semua rekening, arus kas, anggaran dan simulasi rencana dalam satu aplikasi. Gratis untuk mulai.",
    social: {
      title: "Keputusan uang besar, dengan angka yang pasti.",
      description: "Rekening, anggaran, arus kas dan rencana besar, dihitung dari transaksi asli. Tanpa login bank. Coba demonya tanpa akun.",
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
  `<footer><p>JoyoArto oleh JoyoDigitama · <a href="/privasi">Kebijakan privasi</a> · <a href="/syarat">Syarat layanan</a> · <a href="${REPO}">Kode sumber (AGPL)</a> · <a href="${DISCORD_URL}">Discord</a> · <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p></footer>`;
const wrap = (main: string) => `${nav()}<main>${main}</main>${footer()}`;

function homeBody(): string {
  const features: [string, string][] = [
    ["Semua rekening", "Bank, kartu kredit dan e-wallet dalam satu saldo."],
    ["Arus kas", "Uang masuk dan keluar tiap bulan, per kategori."],
    ["Anggaran", "Pasang batas per kategori dan pantau sisanya."],
    ["Rencana & simulasi", "Uji cicilan mobil atau biaya bayi sebelum memutuskan."],
    ["Asisten AI", "Tanya Joyo AI atau Claude pakai bahasa sehari-hari."],
    ["Untuk keluarga", "Satu buku bareng pasangan, akun masing-masing."],
  ];
  return wrap(
    `<h1>Keputusan uang besar, dengan angka yang pasti.</h1>` +
      `<p>Mobil, rumah, anak pertama. JoyoArto merangkum semua rekeningmu dan menjawab dari data aslimu.</p>` +
      `<p><a href="https://app.arto.joyorogo.com/login">Mulai gratis</a> · <a href="/demo">Coba demo, tanpa akun</a> · <a href="/#${ANDROID_SECTION_ID}">Android</a> · <a href="/#${IOS_SECTION_ID}">iPhone</a></p>` +
      `<section id="fitur"><h2>Lebih dari catatan pengeluaran.</h2>${features.map(([t, b]) => `<h3>${esc(t)}</h3><p>${esc(b)}</p>`).join("")}</section>` +
      `<section><h2>Putuskan hal besar dengan angka.</h2><p>Mobil baru, anak pertama, pindah rumah. Simulasikan dari rata-rata bulananmu sendiri, bulan demi bulan: dana darurat tetap aman, cicilan di bawah 30% penghasilan.</p></section>` +
      `<section><h2>Angka yang bisa dipercaya.</h2><p>Upload e-statement, JoyoArto cek setiap saldo sampai cocok. Bank Jago & GoPay dibaca otomatis, bank lain lewat CSV.</p></section>` +
      `<section id="privasi"><h2>Uang itu urusan pribadi.</h2><p>Tanpa login bank. Datamu nggak dijual dan nggak dipakai buat iklan. Kodenya terbuka (AGPL).</p></section>` +
      `<section id="aplikasi"><h2>Di web, Android dan iPhone</h2>` +
      `<h3 id="${ANDROID_SECTION_ID}">Android (Google Play, tahap uji)</h3><ol>` +
      `<li>Gabung grup tester di <a href="${ANDROID_TESTERS_GROUP_URL}">Google Groups: joyoarto-testers</a> (${esc(ANDROID_TESTERS_GROUP_EMAIL)}).</li>` +
      `<li>Buka <a href="${ANDROID_TESTING_URL}">halaman uji JoyoArto di Google Play</a>, ketuk “Jadi penguji”, lalu pasang dari Play Store.</li>` +
      `<li>Masuk pakai Google.</li></ol>` +
      `<p><a href="${DISCORD_URL}">Gabung Discord untuk lapor bug dan diskusi</a>.</p>` +
      `<h3 id="${IOS_SECTION_ID}">iPhone (TestFlight, tahap uji)</h3><ol>` +
      `<li>Pasang <a href="${TESTFLIGHT_APP_STORE_URL}">TestFlight dari App Store</a>.</li>` +
      (IOS_TESTFLIGHT_URL
        ? `<li>Buka <a href="${IOS_TESTFLIGHT_URL}">undangan JoyoArto</a> di iPhone, ketuk Accept lalu Install.</li>`
        : `<li>Undangan TestFlight segera; sementara pakai <a href="https://app.arto.joyorogo.com/login">versi web</a> di Safari.</li>`) +
      `<li>Masuk pakai Apple atau Google.</li></ol></section>` +
      `<section id="faq"><h2>Pertanyaan umum</h2>${FAQ.map(({ q, a }) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}</section>`,
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
