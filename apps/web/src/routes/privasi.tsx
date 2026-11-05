// Privacy policy (Kebijakan Privasi) for the hosted service, written for UU PDP (Law 27/2022). Plain language; every
// statement here must stay true of the code: if you change what is collected, stored or shared, change this page.

import { Link, createFileRoute } from "@tanstack/react-router";

import { A, LegalPage, P, UL } from "@/components/legal";
import type { Section } from "@/components/legal";
import { CONTACT_EMAIL, CONTROLLER, PRODUCT_NAME, SITE_URL } from "@/lib/brand";

export const Route = createFileRoute("/privasi")({ component: Privacy });

const N = PRODUCT_NAME;
const mail = <A href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</A>;
const settings = (label: string) => (
  <Link to="/settings" className="text-primary underline">
    {label}
  </Link>
);

const sections: Section[] = [
  {
    id: "pengendali",
    title: { id: "Siapa yang mengelola datamu", en: "Who is responsible for your data" },
    body: {
      id: (
        <>
          <P>
            {N} di {SITE_URL} dijalankan oleh {CONTROLLER.name} ({CONTROLLER.trade}), perorangan di {CONTROLLER.country}. Untuk layanan ini, dialah
            pengendali data pribadi menurut UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP). Kontak: {mail}.
          </P>
          <P>
            Kalau kamu menjalankan {N} di server-mu sendiri, kamulah pengendali data di sana; kebijakan ini hanya untuk layanan di {SITE_URL}.
          </P>
        </>
      ),
      en: (
        <>
          <P>
            {N} at {SITE_URL} is run by {CONTROLLER.name} ({CONTROLLER.trade}), an individual in {CONTROLLER.country}. For this service he is the
            personal data controller under Indonesia's Personal Data Protection Law (Law No. 27 of 2022, "UU PDP"). Contact: {mail}.
          </P>
          <P>If you run {N} on your own server, you are the controller there; this policy covers only the service at {SITE_URL}.</P>
        </>
      ),
    },
  },
  {
    id: "data",
    title: { id: "Data yang kami simpan", en: "What we store" },
    body: {
      id: (
        <>
          <UL>
            <li>
              <b>Akun:</b> nama, email, foto profil dan ID akun Google-mu (dari Google saat kamu masuk), serta sesi masuk (waktu, alamat IP, jenis browser).
            </li>
            <li>
              <b>Data keuangan:</b> rekening, kartu dan e-wallet (nama, bank, 4 digit terakhir, saldo awal), transaksi (tanggal, jumlah, keterangan asli dari bank,
              merchant, saldo, nomor referensi, catatan), kategori, aturan, anggaran, tag, riwayat import, format kolom CSV, dan detail pembayaran dari e-statement
              GoPay. Data keuangan termasuk data pribadi yang bersifat spesifik menurut UU PDP, jadi kami perlakukan dengan hati-hati.
            </li>
            <li>
              <b>Rumah tangga:</b> siapa saja anggotanya dan perannya, serta undangan (email yang diundang dan siapa yang mengundang).
            </li>
            <li>
              <b>Akses aplikasi:</b> token API (nama, awalan dan hash-nya, bukan token-nya), aplikasi AI yang kamu sambungkan (nama aplikasi, izin, tanggal), dan
              log pemanggilan alat MCP (alat apa, argumennya, berhasil atau tidak, durasi; bukan hasilnya).
            </li>
            <li>
              <b>Import lewat email</b> (kalau kamu nyalakan): alamat import rumah tangga, dan untuk tiap email yang masuk ke alamat itu: alamat pengirim, subjek,
              dan hasilnya (100 email terakhir). Isi email dan lampirannya tidak disimpan.
            </li>
            <li>
              <b>Joyo AI</b> (kalau kamu pakai): percakapanmu dengan Joyo (pertanyaanmu, jawaban Joyo, nama alat yang dibaca Joyo beserta argumennya, dan perubahan
              yang diusulkan serta statusnya). Percakapan hanya terlihat olehmu, tidak oleh anggota rumah tangga lain, dan tersimpan sampai kamu menghapusnya.
            </li>
            <li>
              <b>Foto struk</b> (kalau kamu memotret atau memilih foto struk): gambarnya (diperkecil di perangkatmu, sekitar 1600 piksel) beserta jenis, ukuran dan
              transaksi yang memakainya. Disimpan di Cloudflare R2, hanya bisa dibuka anggota rumah tanggamu lewat aplikasi (tidak ada tautan publik), dan
              dipakai sebagai bukti di laporan klaim reimburse yang kamu buat sendiri.
            </li>
            <li>
              <b>Reimburse (diganti kantor)</b>, kalau kamu pakai: nama perusahaan, nama pemohon, NIK/ID karyawan dan departemen (opsional), nama dan email
              penyetuju (opsional), status tiap pengeluaran, dan laporan klaim yang kamu buat (nomor, periode, isi yang dicetak). {N} tidak pernah mengirim apa pun
              ke perusahaanmu; laporannya kamu unduh dan kirim sendiri.
            </li>
            <li>
              <b>Pemakaian AI:</b> untuk tiap panggilan AI (Joyo AI, catatan suara, membaca catatan teks atau foto struk): jenis, model, waktu, jumlah token dan
              berhasil atau tidak. Bukan isi pertanyaan, jawaban, catatan atau fotomu. Dipakai untuk batas harian dan biaya.
            </li>
            <li>
              <b>Waitlist</b> (kalau dulu kamu sempat daftar): email, nama panggilan, bank yang kamu centang, sumber dan bahasa, serta hash alamat IP (bukan IP-nya). Waitlist-nya sudah ditutup karena pendaftaran sekarang terbuka; data yang sudah ada kami simpan supaya pemilik {N} bisa menghubungimu.
            </li>
            <li>
              <b>Joyo Pro</b> (per akun): jawaban terakhir JoyoRogo soal Joyo Pro-mu (Pro atau tidak, sampai kapan, jenis paket, dari mana dibeli) dan kapan
              diperiksa; serta hitungan import statement-mu per bulan untuk batas paket Free. {N} tidak menerima pembayaran, jadi <b>tidak pernah menerima atau
              menyimpan nomor kartu, data rekening, PIN e-wallet atau riwayat pembayaranmu</b>; itu ada di JoyoRogo dan penyedia pembayarannya.
            </li>
          </UL>
          <P>
            <b>Yang tidak kami simpan:</b> PIN atau password bank ({N} tidak pernah login ke bank-mu), file PDF statement, teks statement, rekaman catatan
            suara dan transkripnya, serta API key milikmu sendiri untuk Joyo AI (tersimpan hanya di browser-mu). Saat import (termasuk PDF yang diunggah
            atau dikirim lewat email), PDF dan teksnya diproses di server lalu dibuang; yang disimpan hanya transaksi hasilnya. Di halaman <Link to="/demo" className="underline">demo</Link>, PDF
            dibaca di browser-mu dan tidak dikirim ke mana pun. Kami tidak memakai cookie iklan atau analitik; cookie yang ada hanya untuk menjaga kamu tetap masuk.
          </P>
        </>
      ),
      en: (
        <>
          <UL>
            <li>
              <b>Account:</b> your name, email, profile picture and Google account ID (from Google when you sign in), and your sign-in sessions (time, IP address,
              browser).
            </li>
            <li>
              <b>Finance data:</b> bank accounts, cards and e-wallets (name, bank, last four digits, opening balance), transactions (date, amount, the bank's
              original description, merchant, balance, reference numbers, notes), categories, rules, budgets, tags, import history, CSV column layouts, and payment
              details from GoPay e-statements. Financial data is "specific personal data" under UU PDP, and we treat it that way.
            </li>
            <li>
              <b>Household:</b> who its members are and their roles, and invites (the invited email and who sent it).
            </li>
            <li>
              <b>App access:</b> API tokens (name, prefix and a hash, never the token), the AI apps you connect (app name, permissions, dates), and a log of MCP
              tool calls (which tool, its arguments, whether it worked, how long it took; never the results).
            </li>
            <li>
              <b>Import by email</b> (if you turn it on): the household's import address, and for each email sent to it: the sender's address, the subject and
              what came of it (the last 100 emails). Email bodies and attachments are not kept.
            </li>
            <li>
              <b>Joyo AI</b> (if you use it): your conversations with Joyo (your questions, Joyo's answers, the names and arguments of the tools Joyo read, and the
              changes it proposed with their status). Only you see them, not other household members, and they are kept until you delete them.
            </li>
            <li>
              <b>Receipt photos</b> (if you take or pick one): the image (shrunk on your device to about 1600 pixels) with its type, size and the transaction it
              belongs to. Stored in Cloudflare R2, opened only by members of your household through the app (there are no public links), and used as proof in the
              reimbursement claim reports you make yourself.
            </li>
            <li>
              <b>Reimbursement (paid back by your employer)</b>, if you use it: the company's name, the claimant's name, employee ID and department (optional), the
              approver's name and email (optional), each expense's status, and the claim reports you make (number, period, what was printed). {N} never sends
              anything to your company; you download the report and send it yourself.
            </li>
            <li>
              <b>AI usage:</b> for each AI call (Joyo AI, voice notes, reading a typed note or a receipt photo): its kind, model, time, token counts and whether it
              worked. Never what you asked, said, wrote or photographed. Used for the daily limits and costs.
            </li>
            <li>
              <b>Waitlist</b> (if you joined it earlier): email, nickname, the banks you ticked, source and language, and a hash of your IP address (never the IP itself). The waitlist is closed now that sign-up is open; existing entries are kept so the owner of {N} can contact you.
            </li>
            <li>
              <b>Joyo Pro</b> (per account): JoyoRogo's last answer about your Joyo Pro (Pro or not, until when, the kind of plan, where it was bought) and when it
              was checked; and a monthly count of your statement imports for the Free plan's limit. {N} takes no payments, so <b>we never receive or store your card
              number, bank account details, e-wallet PIN or payment history</b>; those stay with JoyoRogo and its payment providers.
            </li>
          </UL>
          <P>
            <b>What we do not store:</b> bank PINs or passwords ({N} never logs in to your bank), statement PDF files, statement text, voice-note recordings or
            their transcripts, or your own API key for Joyo AI (it stays in your browser). During an import (including PDFs
            uploaded or sent by email) the PDF and its text are processed on the server and then discarded; only the resulting transactions are kept. On the{" "}
            <Link to="/demo" className="underline">
              demo
            </Link>{" "}
            page the PDF is read in your browser and sent nowhere. We use no advertising or analytics cookies; the only cookies keep you signed in.
          </P>
        </>
      ),
    },
  },
  {
    id: "tujuan",
    title: { id: "Untuk apa dan atas dasar apa", en: "Why we use it, and on what basis" },
    body: {
      id: (
        <>
          <UL>
            <li>
              <b>Menjalankan layanan</b> yang kamu minta saat mendaftar: menyimpan, mengolah dan menampilkan catatan keuanganmu, termasuk ke anggota rumah tangga
              yang kamu undang. Dasarnya: pemenuhan perjanjian (Syarat Layanan) dengan kamu.
            </li>
            <li>
              <b>Menyambungkan AI</b> seperti Claude: hanya kalau kamu sendiri yang menyambungkan dan menyetujuinya. Dasarnya: persetujuanmu, yang bisa kamu cabut
              kapan saja.
            </li>
            <li>
              <b>Joyo AI, catatan suara/teks dan foto struk</b> di tombol Tambah: hanya saat kamu memakainya. Dasarnya: pemenuhan perjanjian (fitur yang kamu minta). Joyo
              hanya mengusulkan perubahan; tidak ada yang disimpan sebelum kamu menekan Konfirmasi atau Simpan.
            </li>
            <li>
              <b>Keamanan:</b> sesi masuk, pembatasan jumlah permintaan, dan log MCP supaya kamu bisa melihat apa yang dilakukan aplikasi AI atas namamu dan supaya
              penyalahgunaan bisa dilacak. Dasarnya: perjanjian dan kepentingan yang sah untuk menjaga layanan tetap aman.
            </li>
            <li>
              <b>Waitlist:</b> menghubungi orang yang sudah ada di daftar, misalnya untuk mengabari bahwa {N} sudah bisa dipakai. Dasarnya: persetujuanmu saat dulu mendaftar.
            </li>
            <li>
              <b>Joyo Pro:</b> memeriksa ke JoyoRogo apakah akunmu punya Joyo Pro, supaya fitur dan batas yang benar berlaku. Dasarnya: pemenuhan perjanjian.
            </li>
          </UL>
          <P>
            Data tidak dijual, tidak dipakai untuk iklan, dan tidak kami pakai untuk melatih model AI. Kami tidak membuat keputusan otomatis yang berakibat hukum
            bagimu; simulasi di halaman Plan hanya hitungan, bukan nasihat keuangan.
          </P>
        </>
      ),
      en: (
        <>
          <UL>
            <li>
              <b>Running the service</b> you asked for when you signed up: storing, processing and showing your finance records, including to household members you
              invite. Basis: performing our agreement (the Terms) with you.
            </li>
            <li>
              <b>Connecting AI</b> such as Claude: only when you connect it and approve it yourself. Basis: your consent, which you can withdraw at any time.
            </li>
            <li>
              <b>Joyo AI, voice/typed notes and receipt photos</b> in the Add button: only when you use them. Basis: performing our agreement (a feature you asked for). Joyo only
              proposes changes; nothing is saved until you tap Confirm or Save.
            </li>
            <li>
              <b>Security:</b> sign-in sessions, rate limits, and the MCP log so you can see what AI apps did on your behalf and abuse can be traced. Basis: the
              agreement and our legitimate interest in keeping the service safe.
            </li>
            <li>
              <b>Waitlist:</b> contacting the people already on the list, for example to tell them {N} is open. Basis: the consent you gave when you joined.
            </li>
            <li>
              <b>Joyo Pro:</b> checking with JoyoRogo whether your account has Joyo Pro, so the right features and limits apply. Basis: performing our agreement.
            </li>
          </UL>
          <P>
            Your data is not sold, not used for advertising, and not used by us to train AI models. We make no automated decisions with legal effect on you; the
            simulations on the Plan page are arithmetic, not financial advice.
          </P>
        </>
      ),
    },
  },
  {
    id: "lokasi",
    title: { id: "Di mana data disimpan", en: "Where it is stored" },
    body: {
      id: (
        <>
          <P>
            {N} berjalan di Cloudflare (Workers dan database D1). Lokasi database dipilih oleh Cloudflare dan <b>tidak dijamin berada di Indonesia</b>; data juga
            bisa melewati pusat data Cloudflare di negara lain. Artinya data pribadimu dapat ditransfer ke luar wilayah Indonesia.
          </P>
          <P>
            Pelindungan yang kami pakai untuk transfer itu: perjanjian pemrosesan data (Data Processing Addendum) Cloudflare yang mengikat Cloudflare untuk
            memproses data hanya atas instruksi kami dan menjaganya, koneksi terenkripsi (HTTPS) di setiap jalur, dan enkripsi saat disimpan dari Cloudflare. Dengan
            mendaftar, kamu juga menyetujui transfer ini. Kalau suatu saat ada pilihan penyimpanan di Indonesia yang layak, kami akan mempertimbangkannya.
          </P>
        </>
      ),
      en: (
        <>
          <P>
            {N} runs on Cloudflare (Workers and the D1 database). Cloudflare chooses where the database lives and it is <b>not guaranteed to be in Indonesia</b>;
            data may also pass through Cloudflare data centres in other countries. This means your personal data may be transferred outside Indonesia.
          </P>
          <P>
            Safeguards we rely on for that transfer: Cloudflare's Data Processing Addendum, which binds Cloudflare to process data only on our instructions and to
            protect it; encrypted connections (HTTPS) everywhere; and Cloudflare's encryption at rest. By signing up you also consent to this transfer. If a suitable
            option to store data in Indonesia becomes available, we will consider it.
          </P>
        </>
      ),
    },
  },
  {
    id: "pihak-lain",
    title: { id: "Pihak lain yang ikut memproses", en: "Who else processes it" },
    body: {
      id: (
        <UL>
          <li>
            <b>Cloudflare, Inc.</b>: hosting, database, jaringan dan pembatasan permintaan, sebagai pemroses data atas nama kami.
          </li>
          <li>
            <b>Google</b>: untuk masuk dengan akun Google. Google memberi kami nama, email dan foto profilmu; pemakaian Google-mu sendiri tunduk pada kebijakan
            privasi Google.
          </li>
          <li>
            <b>Anthropic (Claude) untuk Joyo AI dan membaca catatan</b>, sebagai pemroses atas nama kami, <b>hanya saat kamu memakainya</b>. Yang dikirim:
            pertanyaanmu dan potongan percakapan sebelumnya, nama depanmu, nama rumah tangga, tanggal hari ini, dan data buku besar yang dibaca Joyo untuk menjawab
            (misalnya saldo, transaksi, ringkasan pengeluaran, baseline rencana). Untuk catatan di tombol Tambah: teks catatan, serta nama rekening dan kategori
            rumah tanggamu. Untuk foto struk: gambarnya, nama rekening dan kategori rumah tanggamu, hanya untuk membaca isinya (foto tetap disimpan di {N},
            bukan di Anthropic). Anthropic tidak memakai data API untuk melatih modelnya dan menyimpannya sementara menurut kebijakan retensinya (umumnya 30 hari) untuk
            keamanan. Bisa lewat Cloudflare AI Gateway.
          </li>
          <li>
            <b>Cloudflare Workers AI</b>: mengubah catatan suara menjadi teks (Whisper). Rekamannya diproses lalu dibuang. Kalau Claude sedang tidak tersedia,
            Joyo AI dan pembacaan foto struk bisa memakai model di Workers AI dengan data yang sama seperti di atas. <b>Cloudflare R2</b> menyimpan foto struk.
          </li>
          <li>
            <b>Penyedia AI pilihanmu</b> (Anthropic, OpenRouter atau OpenAI), <b>hanya kalau kamu memasukkan API key sendiri</b> di Joyo AI: data yang sama seperti
            di atas dikirim ke penyedia itu dengan key-mu dan diproses menurut perjanjianmu dengan mereka. Key-mu dipakai untuk panggilan itu saja dan tidak
            disimpan di server kami.
          </li>
          <li>
            <b>Anthropic (Claude)</b>, <b>hanya kalau kamu menyambungkannya</b>: saat kamu meminta Claude melakukan sesuatu, Claude menerima data yang diperlukan
            untuk permintaan itu (misalnya daftar transaksi yang kamu tanyakan). Data itu kemudian diproses Anthropic menurut perjanjian dan kebijakan privasi antara
            kamu dan Anthropic. Hal yang sama berlaku untuk aplikasi AI lain yang kamu sambungkan.
          </li>
          <li>
            <b>JoyoRogo</b> (juga dijalankan Joyo Digitama), yang menjual dan memproses pembayaran <b>Joyo Pro</b>: untuk memeriksa apakah kamu punya Joyo Pro, {N}
            mengirim ID akun Google-mu dan alamat email yang sudah terverifikasi, paling sering sekali tiap beberapa menit selama kamu memakai {N}. JoyoRogo
            menjawab hanya status Pro, tanggal berakhir, jenis paket dan dari mana dibeli. Data keuanganmu tidak pernah dikirim ke JoyoRogo. Kalau kamu membeli Joyo
            Pro, pembayarannya diproses JoyoRogo dan penyedia pembayarannya menurut kebijakan privasi JoyoRogo.
          </li>
          <li>
            <b>Anggota rumah tangga</b> yang kamu undang bisa melihat dan mengubah data keuangan rumah tangga itu. Status Joyo Pro-mu hanya terlihat olehmu.
          </li>
        </UL>
      ),
      en: (
        <UL>
          <li>
            <b>Cloudflare, Inc.</b>: hosting, database, network and rate limiting, as a processor on our behalf.
          </li>
          <li>
            <b>Google</b>: for signing in with your Google account. Google gives us your name, email and profile picture; your use of Google is covered by Google's
            own privacy policy.
          </li>
          <li>
            <b>Anthropic (Claude) for Joyo AI and reading notes</b>, as a processor on our behalf, <b>only when you use them</b>. What is sent: your question and
            recent turns of the conversation, your first name, the household's name, today's date, and the ledger data Joyo reads to answer (for example balances,
            transactions, spending summaries, the plan baseline). For a note in the Add button: the note's text and your household's account and category names.
            For a receipt photo: the image and your household's account and category names, only to read it (the photo itself is stored by {N}, not by
            Anthropic). Anthropic does not train its models on API data and keeps it briefly under its retention policy (typically 30 days) for safety. It may pass through
            Cloudflare AI Gateway.
          </li>
          <li>
            <b>Cloudflare Workers AI</b>: turns voice notes into text (Whisper). The recording is processed and discarded. When Claude is unavailable, Joyo AI and
            reading receipt photos may use a Workers AI model with the same data as above. <b>Cloudflare R2</b> stores receipt photos.
          </li>
          <li>
            <b>The AI provider you choose</b> (Anthropic, OpenRouter or OpenAI), <b>only if you enter your own API key</b> in Joyo AI: the same data as above goes
            to that provider with your key and is processed under your agreement with them. Your key is used for that call only and never stored on our server.
          </li>
          <li>
            <b>Anthropic (Claude)</b>, <b>only if you connect it</b>: when you ask Claude to do something, Claude receives the data that request needs (for example
            the transactions you asked about). Anthropic then processes it under the agreement and privacy policy between you and Anthropic. The same applies to any
            other AI app you connect.
          </li>
          <li>
            <b>JoyoRogo</b> (also run by Joyo Digitama), which sells and processes payments for <b>Joyo Pro</b>: to check whether you have Joyo Pro, {N} sends your
            Google account id and your verified email address, at most once every few minutes while you use {N}. JoyoRogo answers only the Pro status, end date,
            kind of plan and where it was bought. Your finance data is never sent to JoyoRogo. If you buy Joyo Pro, the payment is processed by JoyoRogo and its
            payment providers under JoyoRogo's privacy policy.
          </li>
          <li>
            <b>Household members</b> you invite can see and change that household's finance data. Your Joyo Pro status is visible only to you.
          </li>
        </UL>
      ),
    },
  },
  {
    id: "retensi",
    title: { id: "Berapa lama disimpan", en: "How long we keep it" },
    body: {
      id: (
        <UL>
          <li>Akun dan data keuangan: selama akunmu aktif, sampai kamu menghapus rumah tangga atau akunmu.</li>
          <li>Saat kamu menghapus: data langsung hilang dari database. Cadangan otomatis Cloudflare (fitur pemulihan D1) bisa menyimpannya paling lama 30 hari lagi, lalu terhapus.</li>
          <li>Log MCP: 90 hari, lalu dihapus otomatis.</li>
          <li>Percakapan Joyo AI: sampai kamu menghapusnya (paling banyak 50 percakapan terbaru per rumah tangga; yang lebih lama terhapus otomatis), atau bersama akun/rumah tangga.</li>
          <li>
            Foto struk: selama transaksinya ada. Ikut terhapus saat transaksinya dihapus (atau import-nya dibatalkan), saat rumah tangga atau akunmu dihapus, atau
            saat kamu menghapus fotonya. Foto yang diunggah tapi tidak jadi disimpan dihapus otomatis setelah sehari.
          </li>
          <li>Catatan pemakaian AI: selama akunmu aktif.</li>
          <li>Sesi masuk: sampai kedaluwarsa atau kamu keluar.</li>
          <li>
            Jawaban JoyoRogo soal Joyo Pro dan hitungan import-mu: sampai akunmu dihapus. {N} tidak menyimpan catatan pembayaran; JoyoRogo yang menyimpannya.
          </li>
          <li>Token API yang sudah dicabut: datanya (bukan token-nya) tetap tercatat sampai akunmu dihapus, supaya kamu bisa melihat riwayatnya.</li>
          <li>Waitlist: data yang sudah ada disimpan sampai pemiliknya selesai menghubungi orang di daftar, atau lebih cepat kalau kamu minta dihapus (atau saat akunmu dengan email yang sama dihapus).</li>
        </UL>
      ),
      en: (
        <UL>
          <li>Account and finance data: while your account is active, until you delete the household or your account.</li>
          <li>When you delete: data is removed from the database at once. Cloudflare's automatic backups (D1 point-in-time recovery) may hold it for up to 30 more days, then it is gone.</li>
          <li>MCP log: 90 days, then deleted automatically.</li>
          <li>Joyo AI conversations: until you delete them (at most the 50 newest per household; older ones are deleted automatically), or with your account or household.</li>
          <li>
            Receipt photos: as long as their transaction exists. They go when the transaction is deleted (or its import undone), when the household or your
            account is deleted, or when you remove the photo. Photos uploaded but never saved are deleted automatically after a day.
          </li>
          <li>AI usage records: while your account is active.</li>
          <li>Sign-in sessions: until they expire or you sign out.</li>
          <li>
            JoyoRogo's Joyo Pro answer and your import counts: until your account is deleted. {N} keeps no payment records; JoyoRogo does.
          </li>
          <li>Revoked API tokens: their details (never the token) stay until your account is deleted, so you can see the history.</li>
          <li>Waitlist: existing entries are kept until the owner has contacted the people on the list, or sooner if you ask (or when your account with the same email is deleted).</li>
        </UL>
      ),
    },
  },
  {
    id: "hak",
    title: { id: "Hak kamu dan cara memakainya", en: "Your rights and how to use them" },
    body: {
      id: (
        <>
          <P>Sebagian besar bisa langsung kamu lakukan sendiri di {settings("Pengaturan → Data & privasi")}:</P>
          <UL>
            <li>
              <b>Akses dan portabilitas:</b> unduh semua datamu (JSON) dan transaksi (CSV).
            </li>
            <li>
              <b>Pembetulan:</b> ubah transaksi, kategori, rekening dan nama rumah tangga langsung di aplikasi. Nama dan email akun mengikuti akun Google-mu.
            </li>
            <li>
              <b>Penghapusan:</b> hapus rumah tangga (pemilik), keluar dari rumah tangga, atau hapus akunmu.
            </li>
            <li>
              <b>Menarik persetujuan:</b> putuskan aplikasi AI, cabut token API, atau keluar dari rumah tangga, kapan saja.
            </li>
          </UL>
          <P>
            Untuk hak lain (misalnya menunda atau membatasi pemrosesan, keberatan, atau pertanyaan apa pun), kirim email ke {mail} dari alamat akunmu. Kami jawab
            paling lambat 3 × 24 jam. Kamu juga berhak mengadu ke lembaga pelindungan data pribadi yang dibentuk menurut UU PDP.
          </P>
        </>
      ),
      en: (
        <>
          <P>Most of these you can do yourself in {settings("Settings → Data & privacy")}:</P>
          <UL>
            <li>
              <b>Access and portability:</b> download all your data (JSON) and your transactions (CSV).
            </li>
            <li>
              <b>Correction:</b> edit transactions, categories, accounts and the household name in the app. Your account name and email follow your Google account.
            </li>
            <li>
              <b>Deletion:</b> delete a household (owners), leave a household, or delete your account.
            </li>
            <li>
              <b>Withdrawing consent:</b> disconnect AI apps, revoke API tokens, or leave a household, at any time.
            </li>
          </UL>
          <P>
            For anything else (for example pausing or restricting processing, objecting, or any question), email {mail} from your account's address. We reply
            within 3 × 24 hours. You may also complain to the personal data protection authority set up under UU PDP.
          </P>
        </>
      ),
    },
  },
  {
    id: "keamanan",
    title: { id: "Keamanan dan kebocoran data", en: "Security and data breaches" },
    body: {
      id: (
        <>
          <P>
            Semua koneksi memakai HTTPS. Token API dan link undangan disimpan sebagai hash. Data dipisah per rumah tangga dan setiap permintaan diperiksa
            keanggotaannya. Aplikasi AI hanya bisa mengakses setelah kamu menyetujuinya, dan langsung terputus saat kamu mencabutnya. Hanya pengelola layanan yang
            punya akses ke database, dan hanya untuk menjalankan layanan atau memenuhi permintaanmu. Tidak ada sistem yang sepenuhnya aman, dan kami tidak
            mengklaim sertifikasi keamanan apa pun.
          </P>
          <P>
            Kalau terjadi kegagalan pelindungan data pribadimu, kami memberi tahu kamu dan lembaga pelindungan data pribadi secara tertulis paling lambat 3 × 24 jam
            sejak kami mengetahuinya: data apa yang terdampak, kapan dan bagaimana terjadi, dan apa yang kami lakukan untuk menangani dan memulihkannya.
          </P>
        </>
      ),
      en: (
        <>
          <P>
            Every connection uses HTTPS. API tokens and invite links are stored as hashes. Data is separated per household and every request is checked against
            membership. AI apps get access only after you approve them, and lose it as soon as you disconnect them. Only the operator has access to the database, and
            only to run the service or handle your requests. No system is perfectly secure, and we do not claim any security certification.
          </P>
          <P>
            If a failure to protect your personal data happens, we will notify you and the personal data protection authority in writing within 3 × 24 hours of
            becoming aware of it: which data was affected, when and how it happened, and what we are doing to handle and recover from it.
          </P>
        </>
      ),
    },
  },
  {
    id: "anak",
    title: { id: "Anak", en: "Children" },
    body: {
      id: (
        <P>
          Akun {N} untuk orang dewasa (18 tahun ke atas). Catatan keuangan keluarga bisa menyebut anak (misalnya biaya sekolah); data itu dimasukkan dan dikelola
          oleh orang tuanya.
        </P>
      ),
      en: <P>{N} accounts are for adults (18 and over). A family's records may mention children (school fees, say); their parents enter and manage that data.</P>,
    },
  },
  {
    id: "perubahan",
    title: { id: "Perubahan kebijakan dan kontak", en: "Changes and contact" },
    body: {
      id: (
        <P>
          Kalau kebijakan ini berubah secara berarti, kami beri tahu lewat aplikasi atau email sebelum berlaku, dan tanggal di atas ikut diperbarui. Pertanyaan apa pun
          tentang datamu: {mail}. Lihat juga{" "}
          <Link to="/syarat" className="underline">
            Syarat Layanan
          </Link>
          .
        </P>
      ),
      en: (
        <P>
          If this policy changes in a meaningful way, we will tell you in the app or by email before it takes effect, and update the date above. Any question about
          your data: {mail}. See also the{" "}
          <Link to="/syarat" className="underline">
            Terms of Service
          </Link>
          .
        </P>
      ),
    },
  },
];

function Privacy() {
  return (
    <LegalPage
      title={{ id: "Kebijakan Privasi", en: "Privacy Policy" }}
      intro={{
        id: (
          <P>
            Singkatnya: {N} menyimpan catatan keuanganmu supaya bisa kamu (dan keluargamu) lihat, tidak menjualnya, dan kamu bisa mengunduh atau menghapus semuanya
            sendiri kapan saja. Detailnya di bawah.
          </P>
        ),
        en: (
          <P>
            In short: {N} stores your finance records so you (and your family) can see them, never sells them, and you can download or delete all of it yourself at
            any time. The details are below.
          </P>
        ),
      }}
      sections={sections}
    />
  );
}
