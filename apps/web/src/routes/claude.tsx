// Public: how to connect JoyoArto to Claude (the MCP connector), what Claude can see and do, and how to disconnect.
// This is the documentation page of the Claude connectors directory listing (docs/claude-directory.md); keep the tool
// groups in step with packages/api/src/tools.ts.

import { Badge } from "@baroka/ui/components/badge";
import { buttonVariants } from "@baroka/ui/components/button";
import { Card, CardTitle } from "@baroka/ui/components/card";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Eye, PencilLine, ShieldCheck, Unplug } from "lucide-react";
import type { ReactNode } from "react";

import { PublicFooter, PublicHeader } from "@/components/public";
import { APP_ORIGIN, CONTACT_EMAIL } from "@/lib/brand";
import { useLang } from "@/lib/lang";

export const Route = createFileRoute("/claude")({ component: ClaudeConnector });

const MCP_URL = `${APP_ORIGIN}/mcp`;

type T = <V>(id: V, en: V) => V;

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-muted px-1.5 py-0.5 text-[0.8125rem] break-all">{children}</code>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-ink">{i + 1}</span>
          <span className="min-w-0 pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function ClaudeConnector() {
  const en = useLang() === "en";
  const t: T = (id, eng) => (en ? eng : id);

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-3xl space-y-10 px-4 py-8 sm:py-12">
        <header className="space-y-3">
          <p className="text-sm font-bold text-primary">{t("Konektor Claude", "Claude connector")}</p>
          <h1 className="text-[2rem] leading-tight font-extrabold tracking-tight text-balance sm:text-4xl">
            {t("Sambungkan JoyoArto ke Claude", "Connect JoyoArto to Claude")}
          </h1>
          <p className="text-muted-foreground">
            {t(
              "Tanya Claude soal uangmu pakai bahasa sehari-hari: pengeluaran bulan ini, anggaran, cicilan mobil yang masih aman. Claude membaca buku keuangan rumah tanggamu di JoyoArto (rekening, kartu dan e-wallet di Indonesia) lewat konektor MCP, hanya setelah kamu sendiri menyambungkan dan menyetujuinya.",
              "Ask Claude about your money in plain words: this month's spending, budgets, whether a car loan still fits. Claude reads your household's ledger in JoyoArto (Indonesian bank accounts, cards and e-wallets) through an MCP connector, only after you connect it and approve it yourself.",
            )}
          </p>
          <p className="text-sm">
            {t("Alamat server MCP:", "MCP server URL:")} <Code>{MCP_URL}</Code>
          </p>
        </header>

        <Section id="syarat" title={t("Yang kamu perlukan", "What you need")}>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              {t("Akun JoyoArto (masuk pakai Google atau Apple). ", "A JoyoArto account (sign in with Google or Apple). ")}
              <Link to="/login" className="font-semibold text-primary underline underline-offset-4">
                {t("Daftar gratis", "Sign up free")}
              </Link>
            </li>
            <li>
              {t("Paket Free: Claude bisa membaca dan menjawab pertanyaan soal uangmu. Mencatat, import dan mengubah data lewat Claude termasuk di Joyo Pro. ", "Free plan: Claude can read your data and answer questions about it. Adding, importing and changing data from Claude is part of Joyo Pro. ")}
              <Link to="/pricing" className="font-semibold text-primary underline underline-offset-4">
                {t("Lihat harga", "See pricing")}
              </Link>
            </li>
            <li>{t("Akun Claude (claude.ai, Claude Desktop, aplikasi Claude di HP, atau Claude Code).", "A Claude account (claude.ai, Claude Desktop, the Claude mobile app, or Claude Code).")}</li>
            <li>{t("Transaksi di JoyoArto: import statement Bank Jago atau GoPay, CSV, atau minta Claude membaca statement bank lain.", "Transactions in JoyoArto: import Bank Jago or GoPay statements, a CSV, or ask Claude to read another bank's statement.")}</li>
          </ul>
        </Section>

        <Section id="sambungkan" title={t("Cara menyambungkan", "How to connect")}>
          <Card className="space-y-3">
            <CardTitle>claude.ai, Claude Desktop, {t("aplikasi HP", "mobile")}</CardTitle>
            <Steps
              items={[
                <>
                  {t("Di Claude, buka ", "In Claude, open ")}
                  <b>Customize → Connectors</b>.
                </>,
                <>
                  {t("Cari JoyoArto di direktori konektor, atau pilih ", "Find JoyoArto in the connectors directory, or choose ")}
                  <b>Add custom connector</b> {t("dan isi URL", "and enter the URL")} <Code>{MCP_URL}</Code>.
                </>,
                <>
                  {t("Klik ", "Click ")}
                  <b>Connect</b>. {t("Claude membuka halaman JoyoArto: masuk, lalu baca izinnya dan pilih ", "Claude opens a JoyoArto page: sign in, read the permissions and choose ")}
                  <b>{t("Allow", "Allow")}</b>.
                </>,
                t("Kembali ke Claude dan mulai bertanya. Kamu bisa menyalakan atau mematikan JoyoArto per percakapan lewat tombol + → Connectors.", "Back in Claude, start asking. You can turn JoyoArto on or off per conversation with the + button → Connectors."),
              ]}
            />
          </Card>
          <Card className="space-y-3">
            <CardTitle>Claude Code</CardTitle>
            <p className="text-sm">{t("Tambahkan servernya, lalu jalankan /mcp di Claude Code untuk masuk dan menyetujui:", "Add the server, then run /mcp in Claude Code to sign in and approve:")}</p>
            <pre className="overflow-x-auto rounded-xl bg-muted p-3 text-xs">{`claude mcp add --transport http joyoarto ${MCP_URL}`}</pre>
            <p className="text-sm text-muted-foreground">
              {t(
                "Untuk skrip atau server tanpa browser: buat token API di JoyoArto (Settings → API tokens) dan tambahkan --header \"Authorization: Bearer brk_…\".",
                "For scripts or headless machines: create an API token in JoyoArto (Settings → API tokens) and add --header \"Authorization: Bearer brk_…\".",
              )}
            </p>
          </Card>
        </Section>

        <Section id="izin" title={t("Izin: baca dan tulis", "Permissions: read and write")}>
          <p>
            {t(
              "Di halaman persetujuan JoyoArto kamu melihat apa yang diminta Claude. Ada dua izin:",
              "JoyoArto's approval page shows what Claude asks for. There are two permissions:",
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="space-y-2">
              <div className="flex items-center gap-2">
                <Eye className="size-5 text-primary" aria-hidden />
                <CardTitle>{t("Baca", "Read")}</CardTitle>
                <Badge>finance:read</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {t(
                  "Rekening dan saldo, transaksi, kategori, anggaran, ringkasan pengeluaran dan arus kas, aturan kategori, riwayat import, reimburse, dan simulasi rencana (yang cuma menghitung, tidak menyimpan).",
                  "Accounts and balances, transactions, categories, budgets, spending and cashflow summaries, category rules, import history, reimbursements, and plan simulations (which only compute and save nothing).",
                )}
              </p>
            </Card>
            <Card className="space-y-2">
              <div className="flex items-center gap-2">
                <PencilLine className="size-5 text-primary" aria-hidden />
                <CardTitle>{t("Tulis", "Write")}</CardTitle>
                <Badge>finance:write</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {t(
                  "Mencatat dan meng-import transaksi, mengubah kategori, merchant atau catatan, membuat aturan, anggaran, rekening dan kategori, menandai reimburse, menyimpan skenario, dan membatalkan import.",
                  "Recording and importing transactions, changing a category, merchant or note, creating rules, budgets, accounts and categories, marking reimbursements, saving scenarios, and undoing an import.",
                )}
              </p>
            </Card>
          </div>
          <p>
            {t(
              "Mau Claude cuma melihat? Pilih akses hanya-baca di halaman persetujuan; alat tulis lalu menolak setiap panggilan. Kamu bisa menyambungkan ulang kapan saja untuk mengubah pilihan.",
              "Want Claude to look only? Choose read-only access on the approval page; write tools then refuse every call. Reconnect any time to change your choice.",
            )}
          </p>
          <p>
            {t(
              "Setiap alat diberi label untuk Claude: alat baca bisa jalan tanpa ditanya, alat tulis butuh persetujuanmu sesuai pengaturan Claude, dan alat yang mengubah atau menghapus data yang sudah ada (edit transaksi, kategorikan massal, anggaran, hapus skenario, batalkan import) selalu ditandai destruktif sehingga Claude bertanya dulu. Di Claude kamu juga bisa memblokir alat tertentu (Customize → Connectors → JoyoArto).",
              "Every tool is labelled for Claude: read tools can run without asking, write tools need your approval as your Claude settings say, and tools that change or delete existing data (editing transactions, bulk categorising, budgets, deleting scenarios, undoing imports) are marked destructive so Claude always asks first. In Claude you can also block single tools (Customize → Connectors → JoyoArto).",
            )}
          </p>
        </Section>

        <Section id="data" title={t("Data apa yang dilihat Claude", "What data Claude sees")}>
          <div className="flex items-start gap-3 rounded-2xl bg-positive-soft p-3.5 text-sm text-positive-ink">
            <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>
              {t(
                "JoyoArto nggak pernah minta login bank. Claude hanya menerima hasil alat yang dipanggil untuk permintaanmu, dan hanya dari rumah tangga yang sedang aktif.",
                "JoyoArto never asks for bank logins. Claude only receives the results of the tools it calls for your request, and only from your active household.",
              )}
            </p>
          </div>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              {t(
                "Saat kamu bertanya, Claude memanggil alat seperti search_transactions atau spending_summary dan menerima jawabannya: misalnya daftar transaksi yang kamu tanyakan, bukan seluruh database.",
                "When you ask, Claude calls a tool such as search_transactions or spending_summary and gets its answer: for example the transactions you asked about, not the whole database.",
              )}
            </li>
            <li>
              {t(
                "Data yang dilihat: rekening (nama, bank, 4 digit terakhir, saldo terhitung), transaksi (tanggal, jumlah, deskripsi bank, merchant, kategori, catatan), anggaran, aturan, skenario rencana, anggota rumah tangga (nama dan email) dan profil reimburse. Foto struk tidak pernah dikirim ke Claude.",
                "What it can see: accounts (name, bank, last 4 digits, computed balance), transactions (date, amount, bank description, merchant, category, note), budgets, rules, plan scenarios, household members (name and email) and reimbursement profiles. Receipt photos are never sent to Claude.",
              )}
            </li>
            <li>
              {t(
                "Apa yang diterima Claude diproses Anthropic menurut perjanjian dan kebijakan privasi antara kamu dan Anthropic.",
                "What Claude receives is processed by Anthropic under the agreement and privacy policy between you and Anthropic.",
              )}
            </li>
            <li>
              {t(
                "JoyoArto mencatat setiap pemanggilan alat (nama alat, argumennya, berhasil atau tidak, durasi; bukan hasilnya) selama 90 hari, supaya kamu bisa melihat apa yang dilakukan Claude atas namamu. JoyoArto tidak membaca percakapanmu dengan Claude.",
                "JoyoArto logs each tool call (tool name, its arguments, outcome, duration; never the result) for 90 days, so you can see what Claude did on your behalf. JoyoArto never reads your conversations with Claude.",
              )}
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            {t("Detailnya ada di ", "Details are in the ")}
            <Link to="/privasi" className="font-semibold text-primary underline underline-offset-4">
              {t("kebijakan privasi", "privacy policy")}
            </Link>
            .
          </p>
        </Section>

        <Section id="contoh" title={t("Contoh pertanyaan", "Example prompts")}>
          <ul className="space-y-2">
            {[
              t("“Berapa pengeluaran makan bulan ini dibanding bulan lalu? Merchant mana yang paling banyak?”", "“How much did we spend on food this month compared with last month? Which merchants were the biggest?”"),
              t("“Anggaran mana yang sudah lewat batas atau hampir habis?”", "“Which budgets are over or nearly used up?”"),
              t("“Kuat nggak ambil mobil 250 juta, DP 30%, tenor 4 tahun, bunga flat 3,5%? Kami juga mau punya bayi tahun depan.”", "“Can we afford a Rp 250 million car with 30% down, 4 years, 3.5% flat? We're also expecting a baby next year.”"),
              t("“Ini statement BCA bulan lalu (PDF). Import ke rekening BCA-ku, lalu kategorikan yang belum.”", "“Here's last month's BCA statement (PDF). Import it into my BCA account, then categorise what's left.”"),
              t("“Tadi beli kopi 25rb pakai GoPay.”", "“Just bought a 25k coffee with GoPay.”"),
            ].map((q) => (
              <li key={q} className="rounded-2xl bg-muted px-4 py-3 text-sm">
                {q}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="putuskan" title={t("Cara memutuskan", "How to disconnect")}>
          <Card className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Unplug className="size-5 text-primary" aria-hidden />
              <CardTitle>{t("Dua cara, keduanya langsung berlaku", "Two ways, both take effect at once")}</CardTitle>
            </div>
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              <li>
                {t("Di JoyoArto: ", "In JoyoArto: ")}
                <b>Settings → Data &amp; privacy → Connected AI apps → Disconnect</b>.{" "}
                {t("Claude kehilangan akses pada permintaan berikutnya.", "Claude loses access on its very next request.")}
              </li>
              <li>
                {t("Di Claude: ", "In Claude: ")}
                <b>Customize → Connectors → JoyoArto → Remove</b>.
              </li>
              <li>
                Claude Code: <Code>claude mcp remove joyoarto</Code>
                {t(", dan cabut tokennya di Settings → API tokens kalau kamu memakai token.", ", and revoke the token in Settings → API tokens if you used one.")}
              </li>
            </ul>
          </Card>
        </Section>

        <Section id="masalah" title={t("Kalau ada masalah", "Troubleshooting")}>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <b>{t("Claude bilang tidak bisa mengubah apa pun", "Claude says it can't change anything")}</b>:{" "}
              {t("koneksinya read-only, atau rumah tangga ini di paket Free (di Free, Claude hanya membaca). Pilih “Baca dan ubah” saat menyambungkan lagi, atau upgrade di Settings → Billing.", "the connection is read-only, or this household is on the Free plan (on Free, Claude only reads). Choose “Read and make changes” when you connect again, or upgrade in Settings → Billing.")}
            </li>
            <li>
              <b>“This connection was removed”</b>: {t("koneksinya diputus dari JoyoArto. Sambungkan lagi dari Claude.", "the connection was removed in JoyoArto. Connect again from Claude.")}
            </li>
            <li>
              <b>“This connection lacks the &quot;finance:write&quot; permission”</b>:{" "}
              {t("kamu memberi akses hanya-baca. Sambungkan ulang dan izinkan menulis kalau mau Claude mencatat.", "you gave read-only access. Reconnect and allow writing if you want Claude to record things.")}
            </li>
            <li>
              <b>“Too many requests”</b>: {t("tunggu sebentar; ada batas jumlah panggilan per menit.", "wait a moment; there is a per-minute limit on calls.")}
            </li>
            <li>
              {t(
                "Data yang terlihat bukan rumah tangga yang kamu maksud: pilih rumah tangga aktif di Settings; Claude selalu memakai yang aktif.",
                "Seeing the wrong household: pick the active household in Settings; Claude always uses the active one.",
              )}
            </li>
          </ul>
          <p>
            {t("Masih bermasalah atau ada pertanyaan soal keamanan? Email ", "Still stuck, or a security concern? Email ")}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-primary underline underline-offset-4">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>

        <div className="flex flex-col gap-4 rounded-[2rem] bg-primary-soft p-6 sm:flex-row sm:items-center sm:p-8">
          <p className="flex-1 font-bold text-balance">
            {t("Simulasi dan jawaban Claude dihitung dari transaksimu sendiri, bukan nasihat keuangan.", "Simulations and Claude's answers are computed from your own transactions; they are not financial advice.")}
          </p>
          <Link to="/login" className={buttonVariants({ className: "self-start sm:self-center" })}>
            {t("Mulai gratis", "Start free")}
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
