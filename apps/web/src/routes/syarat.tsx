// Short terms of service for the hosted service. Plain language; keep claims in line with what the service does.

import { Link, createFileRoute } from "@tanstack/react-router";

import { A, LegalPage, P, UL } from "@/components/legal";
import type { Section } from "@/components/legal";
import { CONTACT_EMAIL, CONTROLLER, PRODUCT_NAME, SITE_URL } from "@/lib/brand";

export const Route = createFileRoute("/syarat")({ component: Terms });

const N = PRODUCT_NAME;
const mail = <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A>;
const privacy = (label: string) => (
  <Link to="/privasi" className="text-emerald-700 underline dark:text-emerald-400">
    {label}
  </Link>
);

const sections: Section[] = [
  {
    id: "layanan",
    title: { id: "Layanannya", en: "The service" },
    body: {
      id: (
        <P>
          {N} di {SITE_URL} adalah catatan keuangan pribadi dan keluarga, dijalankan oleh {CONTROLLER.name} ({CONTROLLER.trade}). Ada paket Free dan paket Pro
          berbayar (lihat <Link to="/pricing" className="underline">harga</Link>); layanannya masih tahap awal dan fitur bisa berubah. Kode {N} open source (AGPL):
          kamu boleh menjalankannya sendiri secara gratis.
        </P>
      ),
      en: (
        <P>
          {N} at {SITE_URL} is a personal and family finance ledger run by {CONTROLLER.name} ({CONTROLLER.trade}). There is a Free plan and a paid Pro plan (see{" "}
          <Link to="/pricing" className="underline">
            pricing
          </Link>
          ); the service is still early and features may change. {N}'s code is open source (AGPL): you may run it yourself for free.
        </P>
      ),
    },
  },
  {
    id: "akun",
    title: { id: "Akun dan rumah tangga", en: "Accounts and households" },
    body: {
      id: (
        <UL>
          <li>Kamu masuk dengan akun Google-mu dan bertanggung jawab menjaganya, termasuk token API yang kamu buat.</li>
          <li>Anggota yang kamu undang ke rumah tangga bisa melihat dan mengubah datanya. Undang hanya orang yang kamu percaya.</li>
          <li>Pastikan kamu berhak memasukkan data yang kamu import, termasuk data anggota keluarga lain.</li>
        </UL>
      ),
      en: (
        <UL>
          <li>You sign in with your Google account and are responsible for keeping it safe, including the API tokens you create.</li>
          <li>Members you invite to a household can see and change its data. Invite only people you trust.</li>
          <li>Make sure you are entitled to the data you import, including data about other family members.</li>
        </UL>
      ),
    },
  },
  {
    id: "pro",
    title: { id: "Joyo Pro, pembayaran dan pengembalian dana", en: "Joyo Pro, payments and refunds" },
    body: {
      id: (
        <UL>
          <li>
            Ada paket Free dan <b>Joyo Pro</b>. Joyo Pro adalah satu langganan per akun yang membuka Pro di JoyoArto, JoyoRogo dan JoyoFit. Pro berlaku untuk
            akunmu, bukan untuk seluruh rumah tangga: tiap anggota punya paketnya sendiri, dan batas anggota mengikuti paket orang yang mengundang. Isi dan batas
            tiap paket ada di halaman harga dan bisa berubah; perubahan yang merugikan berlaku mulai periode berikutnya, tidak di tengah periode yang sudah dibayar.
          </li>
          <li>
            <b>{N} tidak menjual apa pun dan tidak menerima pembayaran.</b> Joyo Pro dibeli, diperpanjang dan dibatalkan di JoyoRogo (juga dijalankan Joyo
            Digitama), dengan akun Google yang sama. Harga, cara bayar, perpanjangan otomatis atau tidak, dan pengembalian dana mengikuti syarat dan kebijakan
            pengembalian dana JoyoRogo yang tampil saat kamu membeli. Pembelian lewat Google Play atau App Store mengikuti syarat toko tersebut.
          </li>
          <li>
            {N} memeriksa status Joyo Pro-mu ke JoyoRogo dan menyimpan jawabannya sebentar. Kalau JoyoRogo sedang tidak bisa dihubungi, Pro yang sudah aktif tetap
            berlaku paling lama 24 jam setelah tanggal berakhir terakhir yang kami ketahui.
          </li>
          <li>
            Akun baru dapat masa coba Pro di {N}, dan akun yang dibuat sebelum Pro diluncurkan dapat Pro gratis sampai tanggal yang tampil di Pengaturan →
            Langganan. Keduanya gratis dan berakhir sendiri.
          </li>
          <li>
            Kalau Pro berakhir, akunmu kembali ke Free. Tidak ada data yang dihapus: semua transaksi dan skenario tersimpan tetap bisa dilihat, hanya fitur Pro
            berhenti dan batas Free berlaku lagi.
          </li>
          <li>Pertanyaan soal tagihan: hubungi JoyoRogo lewat kontak di halaman Pro-nya, atau {mail}.</li>
        </UL>
      ),
      en: (
        <UL>
          <li>
            There is a Free plan and <b>Joyo Pro</b>. Joyo Pro is one subscription per account that unlocks Pro in JoyoArto, JoyoRogo and JoyoFit. Pro belongs to your
            account, not to the whole household: each member has their own plan, and the member limit follows the plan of whoever invites. What each plan includes
            and its limits are on the pricing page and may change; changes for the worse apply from the next period, never in the middle of one you paid for.
          </li>
          <li>
            <b>{N} sells nothing and takes no payments.</b> Joyo Pro is bought, renewed and cancelled in JoyoRogo (also run by Joyo Digitama) with the same Google
            account. Prices, payment methods, whether it renews automatically, and refunds follow JoyoRogo's terms and refund policy shown when you buy. Purchases
            through Google Play or the App Store follow that store's terms.
          </li>
          <li>
            {N} checks your Joyo Pro status with JoyoRogo and keeps the answer for a short while. If JoyoRogo cannot be reached, Pro that was active stays on for at
            most 24 hours past the last end date we know.
          </li>
          <li>
            New accounts get a Pro trial in {N}, and accounts created before Pro launched get free Pro until the date shown in Settings → Billing. Both are free and
            end by themselves.
          </li>
          <li>
            When Pro ends, your account goes back to Free. Nothing is deleted: every transaction and saved scenario stays readable; only the Pro features stop and
            the Free limits apply again.
          </li>
          <li>Billing questions: contact JoyoRogo through its Pro page, or {mail}.</li>
        </UL>
      ),
    },
  },
  {
    id: "ai",
    title: { id: "Joyo AI, Claude dan aplikasi AI lain", en: "Joyo AI, Claude and other AI apps" },
    body: {
      id: (
        <P>
          Menyambungkan Claude atau aplikasi AI lain itu pilihanmu. Aplikasi itu bertindak atas namamu dengan izin yang kamu setujui, dan pemakaiannya tunduk pada
          syarat penyedianya (misalnya Anthropic). Joyo AI di dalam {PRODUCT_NAME} memakai Claude dari Anthropic (atau API key milikmu sendiri), dengan batas harian
          yang bisa berubah. Jawaban AI bisa salah: periksa sebelum mengandalkannya, terutama sebelum menyetujui perubahan data.
        </P>
      ),
      en: (
        <P>
          Connecting Claude or another AI app is your choice. It acts on your behalf with the permissions you approved, and its use is governed by its provider's
          terms (Anthropic, for example). Joyo AI inside {PRODUCT_NAME} uses Anthropic's Claude (or your own API key), with a daily limit that may change. AI
          answers can be wrong: check them before relying on them, especially before approving changes to your data.
        </P>
      ),
    },
  },
  {
    id: "bukan-nasihat",
    title: { id: "Bukan nasihat keuangan", en: "Not financial advice" },
    body: {
      id: (
        <P>
          Ringkasan, anggaran dan simulasi di {N} (misalnya "mampu beli mobil?") adalah hitungan dari data yang kamu masukkan dan asumsi yang terlihat. Itu bukan
          nasihat keuangan, investasi, pajak atau hukum. Keputusan tetap di tanganmu.
        </P>
      ),
      en: (
        <P>
          Summaries, budgets and simulations in {N} ("can we afford a car?") are arithmetic on the data you entered and the assumptions shown. They are not financial,
          investment, tax or legal advice. Decisions remain yours.
        </P>
      ),
    },
  },
  {
    id: "pemakaian",
    title: { id: "Pemakaian yang wajar", en: "Fair use" },
    body: {
      id: (
        <P>
          Jangan memakai {N} untuk melanggar hukum, mengakses data orang lain tanpa hak, membebani atau menyerang layanan, atau mengakali pembatasannya. Kami bisa
          menangguhkan akses yang melakukan itu, dan memberi tahu alasannya bila memungkinkan.
        </P>
      ),
      en: (
        <P>
          Do not use {N} to break the law, reach other people's data without the right to, overload or attack the service, or get around its limits. We may suspend
          access that does, and tell you why where we can.
        </P>
      ),
    },
  },
  {
    id: "data",
    title: { id: "Datamu", en: "Your data" },
    body: {
      id: (
        <P>
          Datamu tetap milikmu. Kamu bisa mengunduh dan menghapusnya kapan saja dari Pengaturan → Data & privasi. Cara kami memprosesnya ada di{" "}
          {privacy("Kebijakan Privasi")}.
        </P>
      ),
      en: <P>Your data stays yours. You can download and delete it at any time in Settings → Data & privacy. How we process it is in the {privacy("Privacy Policy")}.</P>,
    },
  },
  {
    id: "tanggung-jawab",
    title: { id: "Ketersediaan dan tanggung jawab", en: "Availability and liability" },
    body: {
      id: (
        <P>
          Kami berusaha menjaga layanan tetap jalan dan datamu benar, tapi layanan diberikan apa adanya, tanpa jaminan selalu tersedia atau bebas kesalahan. Sejauh
          diizinkan hukum, kami tidak bertanggung jawab atas kerugian tidak langsung dari pemakaian {N}. Simpan salinan data penting (fitur unduh ada untuk itu).
        </P>
      ),
      en: (
        <P>
          We try to keep the service running and your data correct, but it is provided as is, without a promise that it is always available or free of errors. As
          far as the law allows, we are not liable for indirect losses from using {N}. Keep copies of important data (the download feature is there for that).
        </P>
      ),
    },
  },
  {
    id: "berhenti",
    title: { id: "Berhenti dan perubahan", en: "Leaving and changes" },
    body: {
      id: (
        <P>
          Kamu bisa berhenti kapan saja dengan menghapus akunmu. Kalau syarat ini berubah secara berarti, kami beri tahu sebelumnya. Syarat ini tunduk pada hukum
          Republik Indonesia. Pertanyaan: {mail}.
        </P>
      ),
      en: (
        <P>
          You can leave at any time by deleting your account. If these terms change in a meaningful way, we will tell you beforehand. These terms are governed by
          the laws of the Republic of Indonesia. Questions: {mail}.
        </P>
      ),
    },
  },
];

function Terms() {
  return (
    <LegalPage
      title={{ id: "Syarat Layanan", en: "Terms of Service" }}
      intro={{
        id: <P>Dengan memakai {N}, kamu setuju dengan syarat singkat ini.</P>,
        en: <P>By using {N} you agree to these short terms.</P>,
      }}
      sections={sections}
    />
  );
}
