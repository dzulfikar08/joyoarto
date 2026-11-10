// Help & support: the Support URL in App Store Connect and Google Play (App Review 1.5). Public, no sign-in; prerendered
// with the contact details (lib/seo.ts) so it works without JavaScript too.

import { Link, createFileRoute } from "@tanstack/react-router";

import { A, LegalPage, P, UL } from "@/components/legal";
import type { Section } from "@/components/legal";
import { DISCORD_URL } from "@/lib/app-links";
import { CONTACT_EMAIL, CONTROLLER, PRODUCT_NAME } from "@/lib/brand";

export const Route = createFileRoute("/support")({ component: Support });

const N = PRODUCT_NAME;
const mail = <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A>;
const discord = <A href={DISCORD_URL}>Discord</A>;
const link = (to: "/privasi" | "/syarat", label: string) => (
  <Link to={to} className="text-primary underline">
    {label}
  </Link>
);

const sections: Section[] = [
  {
    id: "kontak",
    title: { id: "Hubungi kami", en: "Contact us" },
    body: {
      id: (
        <>
          <P>
            Ada pertanyaan, masalah, atau ide? Email kami di {mail}. Sebutkan email akunmu, aplikasi yang dipakai (iPhone, Android atau web) dan apa yang terjadi;
            tangkapan layar sangat membantu. Kamu juga bisa bertanya di {discord} kami.
          </P>
          <P>
            {N} dijalankan oleh {CONTROLLER.name} ({CONTROLLER.trade}), {CONTROLLER.country}.
          </P>
        </>
      ),
      en: (
        <>
          <P>
            Questions, problems or ideas? Email us at {mail}. Include your account's email, the app you use (iPhone, Android or web) and what happened;
            screenshots help a lot. You can also ask on our {discord}.
          </P>
          <P>
            {N} is run by {CONTROLLER.name} ({CONTROLLER.trade}), {CONTROLLER.country}.
          </P>
        </>
      ),
    },
  },
  {
    id: "mulai",
    title: { id: "Memulai", en: "Getting started" },
    body: {
      id: (
        <UL>
          <li>Masuk dengan Apple atau Google. Rumah tangga pertamamu dibuat otomatis.</li>
          <li>Import statement: unduh PDF dari aplikasi Bank Jago atau GoPay, lalu buka More → Import statements dan pilih file-nya.</li>
          <li>Catat cepat: ketuk tombol + lalu ketik "kopi 25rb gopay", rekam suara, atau foto struk. Catatan menunggu sampai statement berikutnya mengonfirmasinya.</li>
          <li>Ajak pasanganmu lewat More → Rumah tangga, supaya kalian melihat buku yang sama.</li>
        </UL>
      ),
      en: (
        <UL>
          <li>Sign in with Apple or Google. Your first household is created for you.</li>
          <li>Import a statement: download the PDF from the Bank Jago or GoPay app, then open More → Import statements and pick the file.</li>
          <li>Quick add: tap + and type "kopi 25rb gopay", record a voice note, or snap a receipt. It stays pending until the next statement confirms it.</li>
          <li>Invite your partner from More → Household, so you both see the same ledger.</li>
        </UL>
      ),
    },
  },
  {
    id: "ai",
    title: { id: "Joyo AI dan datamu", en: "Joyo AI and your data" },
    body: {
      id: (
        <P>
          Joyo AI, catatan suara dan foto struk mengirim data ke penyedia AI (Anthropic dan Cloudflare Workers AI) hanya setelah kamu mengizinkannya. Kamu bisa mencabut
          izinnya kapan saja di Settings → Data & privacy. Detailnya ada di {link("/privasi", "kebijakan privasi")}.
        </P>
      ),
      en: (
        <P>
          Joyo AI, voice notes and receipt scans send data to the AI providers (Anthropic and Cloudflare Workers AI) only after you allow it. You can withdraw that
          any time in Settings → Data & privacy. Details are in the {link("/privasi", "privacy policy")}.
        </P>
      ),
    },
  },
  {
    id: "langganan",
    title: { id: "Langganan", en: "Subscriptions" },
    body: {
      id: (
        <UL>
          <li>Dibeli di iPhone atau iPad: kelola atau batalkan di Pengaturan iPhone → [namamu] → Langganan. Pengembalian dana diurus Apple (reportaproblem.apple.com).</li>
          <li>Dibeli di Android: kelola atau batalkan di Google Play → Profil → Pembayaran & langganan.</li>
          <li>Dibeli di web: email kami di {mail}.</li>
          <li>Menghapus aplikasi atau akun tidak membatalkan langganan dari App Store atau Google Play; batalkan di sana.</li>
        </UL>
      ),
      en: (
        <UL>
          <li>Bought on iPhone or iPad: manage or cancel it in the iPhone's Settings → [your name] → Subscriptions. Apple handles refunds (reportaproblem.apple.com).</li>
          <li>Bought on Android: manage or cancel it in Google Play → Profile → Payments & subscriptions.</li>
          <li>Bought on the web: email us at {mail}.</li>
          <li>Deleting the app or your account does not cancel an App Store or Google Play subscription; cancel it there.</li>
        </UL>
      ),
    },
  },
  {
    id: "hapus-akun",
    title: { id: "Download atau hapus datamu", en: "Download or delete your data" },
    body: {
      id: (
        <UL>
          <li>Download: Settings → Data & privacy → Download your data (JSON atau CSV).</li>
          <li>
            Hapus akun: di aplikasi, More → Delete account (atau Settings → Data & privacy → Delete my account), ketik email-mu untuk konfirmasi. Akun dan
            rumah tangga yang hanya berisi kamu langsung terhapus. Tidak bisa masuk? Email {mail} dari alamat akunmu dan kami hapuskan.
          </li>
        </UL>
      ),
      en: (
        <UL>
          <li>Download: Settings → Data & privacy → Download your data (JSON or CSV).</li>
          <li>
            Delete your account: in the app, More → Delete account (or Settings → Data & privacy → Delete my account), then type your email to confirm. The account
            and any household where you are the only member are deleted right away. Can't sign in? Email {mail} from your account's address and we will delete it.
          </li>
        </UL>
      ),
    },
  },
  {
    id: "dokumen",
    title: { id: "Privasi dan syarat", en: "Privacy and terms" },
    body: {
      id: (
        <P>
          Baca {link("/privasi", "kebijakan privasi")} dan {link("/syarat", "syarat layanan")}.
        </P>
      ),
      en: (
        <P>
          Read the {link("/privasi", "privacy policy")} and the {link("/syarat", "terms of service")}.
        </P>
      ),
    },
  },
];

function Support() {
  return (
    <LegalPage
      title={{ id: "Bantuan & dukungan", en: "Help & support" }}
      intro={{
        id: <P>Cara menghubungi kami dan jawaban untuk pertanyaan yang paling sering soal {N}.</P>,
        en: <P>How to reach us, and answers to the most common questions about {N}.</P>,
      }}
      sections={sections}
      dated={false}
    />
  );
}
