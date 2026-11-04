// No-account demo: Jago / GoPay statement PDFs are read (pdf.js) and analysed in the browser with the same parsers
// the server uses. Nothing is uploaded or stored; the only request this page can make is the optional waitlist form.

import { sampleGopayText, sampleJagoText } from "@baroka/api/lib/statements/sample";
import type { StatementSummary } from "@baroka/api/lib/statements/summary";
import { summarizeStatements } from "@baroka/api/lib/statements/summary";
import { Badge } from "@baroka/ui/components/badge";
import { Button } from "@baroka/ui/components/button";
import { Card, CardTitle } from "@baroka/ui/components/card";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { cn } from "@baroka/ui/lib/utils";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Check, FileUp, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { PublicFooter, PublicHeader, WaitlistForm } from "@/components/public";
import { formatMoney } from "@/lib/format";
import { categoryLabel, useLang } from "@/lib/lang";
import type { Lang } from "@/lib/lang";

export const Route = createFileRoute("/demo")({ component: Demo });

type State = { status: "idle" } | { status: "reading"; files: number } | { status: "done"; summary: StatementSummary; sample: boolean } | { status: "error"; message: string };

function Demo() {
  const lang = useLang();
  const en = lang === "en";
  const t = (id: ReactNode, eng: ReactNode) => (en ? eng : id);
  const [state, setState] = useState<State>({ status: "idle" });

  const read = async (list: FileList) => {
    const files = [...list];
    setState({ status: "reading", files: files.length });
    try {
      // pdf.js is loaded only now (lazy chunk), and runs on this device.
      const { pdfText } = await import("@/lib/pdf-text");
      const texts = await Promise.all(files.map(async (f) => ({ name: f.name, text: await pdfText(f) })));
      setState({ status: "done", summary: summarizeStatements(texts), sample: false });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };
  const sample = () =>
    setState({
      status: "done",
      sample: true,
      summary: summarizeStatements([
        { name: en ? "Sample Jago statement (October 2026)" : "Contoh statement Jago (Oktober 2026)", text: sampleJagoText() },
        { name: en ? "Sample GoPay e-statement" : "Contoh e-statement GoPay", text: sampleGopayText() },
      ]),
    });

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:py-12">
        <div className="max-w-2xl">
          <p className="text-sm font-bold text-primary">{t("Demo tanpa akun", "Demo, no account")}</p>
          <h1 className="mt-1.5 text-[2rem] leading-tight font-extrabold tracking-tight text-balance sm:text-4xl">{t("Lihat isi statement-mu dalam semenit.", "See what's in your statement in a minute.")}</h1>
          <p className="mt-3 text-muted-foreground">
            {t(
              "Pilih statement bulanan Bank Jago (PDF), plus e-statement GoPay bulan yang sama kalau ada. JoyoArto mengecek setiap saldo dan merangkum ke mana uangmu pergi.",
              "Pick a Bank Jago monthly statement (PDF), plus the GoPay e-statement for the same month if you have it. JoyoArto checks every balance and sums up where your money went.",
            )}
          </p>
        </div>

        <Card className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl bg-positive-soft p-3.5 text-sm text-positive-ink">
            <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>
              {t(
                "Semua diproses di browser ini. PDF-nya nggak diunggah dan nggak disimpan; tutup tab ini, hasilnya hilang.",
                "Everything happens in this browser. The PDF is not uploaded or stored; close this tab and the result is gone.",
              )}
            </p>
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-input px-4 py-10 text-center transition-colors hover:border-primary hover:bg-primary-soft/40 has-focus-visible:border-primary has-focus-visible:ring-[3px] has-focus-visible:ring-ring/30">
            <span className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary-ink">
              <FileUp className="size-6" aria-hidden="true" />
            </span>
            <span className="font-bold">{t("Pilih PDF statement", "Choose statement PDFs")}</span>
            <span className="text-sm text-muted-foreground">{t("Bank Jago (wajib) + GoPay (opsional). Bisa beberapa file sekaligus.", "Bank Jago (required) + GoPay (optional). Several files at once is fine.")}</span>
            <input type="file" accept="application/pdf,.pdf" multiple className="sr-only" onChange={(e) => e.target.files?.length && void read(e.target.files)} />
          </label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-foreground">{t("Nggak pakai Jago?", "Not on Jago?")}</span>
            <Button variant="link" className="h-auto px-0" onClick={sample}>
              {t("Coba pakai statement contoh", "Try a sample statement")}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {t(
              "Statement bulanan Jago bisa di-download sebagai PDF dari aplikasi Jago; e-statement GoPay dari aplikasi Gojek.",
              "Jago monthly statements can be downloaded as PDF from the Jago app; GoPay e-statements from the Gojek app.",
            )}
          </p>
        </Card>

        {state.status === "reading" && (
          <div aria-live="polite" className="space-y-3">
            <p className="text-sm text-muted-foreground">{t(`Membaca ${state.files} PDF…`, `Reading ${state.files} PDF(s)…`)}</p>
            <Skeleton className="h-20 rounded-3xl" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-24 rounded-3xl" />
              <Skeleton className="h-24 rounded-3xl" />
              <Skeleton className="h-24 rounded-3xl" />
            </div>
          </div>
        )}
        {state.status === "error" && (
          <p role="alert" className="rounded-2xl bg-destructive-soft p-3.5 text-sm text-destructive-ink">
            {t("PDF-nya nggak bisa dibaca:", "Could not read the PDF:")} {state.message}
          </p>
        )}
        {state.status === "done" && <Result s={state.summary} sample={state.sample} lang={lang} />}

        <div id="waitlist" className="grid gap-6 rounded-[2rem] bg-primary-soft p-6 sm:p-8 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl leading-tight font-extrabold tracking-tight text-balance">{t("Mau ini tiap bulan, otomatis rapi?", "Want this every month, kept tidy for you?")}</h2>
            <p className="mt-2 text-muted-foreground">
              {t(
                "Di JoyoArto Pro semua statement tersimpan jadi satu buku keluarga: kategori yang kamu atur sekali, tanya Claude, dan simulasi rencana besar. Gabung waitlist buat harga founder.",
                "With JoyoArto Pro every statement adds up to one family ledger: categories you set once, Claude to ask, and simulations for big plans. Join the waitlist for the founder price.",
              )}
            </p>
            <Link to="/" hash="fitur" className="mt-3 inline-block text-sm font-semibold text-primary-ink underline underline-offset-4">
              {t("Lihat semua fitur", "See all features")}
            </Link>
          </div>
          <WaitlistForm source="demo" initialBanks={["jago"]} />
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}

const rp = (minor: number) => formatMoney(minor);

function Result({ s, sample, lang }: { s: StatementSummary; sample: boolean; lang: Lang }) {
  const en = lang === "en";
  const t = (id: ReactNode, eng: ReactNode) => (en ? eng : id);
  const unknown = s.files.filter((f) => f.kind === "unknown");
  const hasJago = s.files.some((f) => f.kind === "jago");
  const rows = s.files.reduce((n, f) => n + f.rows, 0);
  const date = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(en ? "en-GB" : "id-ID", { day: "numeric", month: "short", year: "numeric" });

  return (
    <section aria-live="polite" className="space-y-4">
      {sample && <p className="text-sm text-muted-foreground">{t("Ini data contoh (orang dan angka rekaan).", "This is sample data (a made-up person and numbers).")}</p>}
      {unknown.length > 0 && (
        <p className="rounded-2xl bg-warning-soft p-3.5 text-sm text-warning-ink">
          {t("Belum dikenali:", "Not recognised:")} {unknown.map((f) => f.name).join(", ")}.{" "}
          {t(
            "Demo ini baru membaca statement Bank Jago dan e-statement GoPay. Bank lain: gabung waitlist dan centang bank-mu.",
            "This demo reads Bank Jago statements and GoPay e-statements only. Other banks: join the waitlist and tick yours.",
          )}
        </p>
      )}
      {rows > 0 &&
        (s.verified ? (
          <div className="flex items-start gap-3 rounded-3xl bg-positive-soft p-4 text-positive-ink sm:p-5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-positive text-card">
              <Check className="size-4" strokeWidth={3} aria-hidden="true" />
            </span>
            <div>
              <p className="font-bold">{t("Semua angka cocok dengan statement.", "Every number matches the statement.")}</p>
              <p className="text-sm">
                {t(
                  `${rows} transaksi dibaca. Setiap saldo berjalan dan total ${s.pockets.length} pocket dihitung ulang, hasilnya sama persis.`,
                  `${rows} transactions read. Every running balance and the totals of ${s.pockets.length} pocket(s) were recomputed and match exactly.`,
                )}
                {s.period && ` ${date(s.period.from)} – ${date(s.period.to)}.`}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl bg-warning-soft p-4 text-warning-ink sm:p-5">
            <p className="flex items-center gap-2 font-bold">
              <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />{t("Ada angka yang nggak cocok.", "Some numbers do not add up.")}</p>
            <p className="text-sm">
              {t(
                "Kemungkinan teks PDF-nya terbaca beda. Di JoyoArto, statement seperti ini ditolak supaya datamu nggak salah. Detail:",
                "The PDF text was probably extracted differently. JoyoArto refuses statements like this so your data stays right. Details:",
              )}
            </p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {s.problems.slice(0, 5).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ))}

      {hasJago && s.pockets.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={t("Uang masuk", "Money in")} value={rp(s.totals.moneyIn)} />
            <Stat label={t("Pengeluaran", "Spending")} value={rp(s.totals.moneyOut + walletSpend(s))} />
            <Stat label={t("Pindah ke rekening sendiri, top up & tarik tunai", "To your own accounts, top-ups & cash")} value={rp(s.totals.transfersOut)} muted />
          </div>
          <Card>
            <CardTitle>{t("Per pocket", "By pocket")}</CardTitle>
            <ul className="mt-2 divide-y divide-border text-sm">
              {s.pockets.map((p, i) => (
                <li key={`${p.name}-${i}`} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{p.name}</span>
                    <span className="shrink-0 font-bold tabular-nums">{rp(p.closing)}</span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
                    <span>
                      {t("Awal", "Opening")} {rp(p.previous)}
                    </span>
                    <span className="text-positive">+{rp(p.moneyIn)}</span>
                    <span>-{rp(p.moneyOut)}</span>
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Angka kanan: saldo akhir. Masuk/keluar per pocket termasuk pindahan antar-pocket.", "Right: closing balance. In/out per pocket includes moves between pockets.")}
            </p>
          </Card>
        </>
      )}

      {s.categories.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Bars
            title={t("Pengeluaran per kategori", "Spending by category")}
            rows={s.categories.slice(0, 8).map((c) => ({ label: categoryLabel(c.key, lang), amount: c.amount, count: c.count, dim: c.key === "uncategorized" }))}
            lang={lang}
            note={
              s.categories.some((c) => c.key === "uncategorized")
                ? t(
                    "“Belum dikategorikan” itu transfer ke orang dan QRIS yang nggak jelas dari statement. Di JoyoArto, kamu atur sekali (atau minta Claude), bulan depan otomatis.",
                    "“Not categorised yet” are transfers to people and QRIS payments the statement doesn't explain. In JoyoArto you set them once (or ask Claude) and next month is automatic.",
                  )
                : undefined
            }
          />
          <Bars title={t("Merchant & penerima teratas", "Top merchants & payees")} rows={s.merchants.slice(0, 8).map((m) => ({ label: m.key, amount: m.amount, count: m.count }))} lang={lang} />
        </div>
      )}

      {hasJago && (s.gopay.merged > 0 || s.gopay.unnamed > 0) && (
        <Card className="text-sm">
          <CardTitle className="flex items-center gap-2">
            GoPay {s.gopay.merged > 0 && <Badge tone="positive">{t(`${s.gopay.merged} dinamai`, `${s.gopay.merged} named`)}</Badge>}
          </CardTitle>
          {s.gopay.merged > 0 && (
            <p className="mt-1">
              {t(
                `${s.gopay.merged} pembayaran “Gopay - Generic” di Jago sekarang punya nama merchant aslinya, dicocokkan lewat ID transaksi GoPay.`,
                `${s.gopay.merged} Jago “Gopay - Generic” payment(s) now show the real merchant, matched on GoPay's transaction id.`,
              )}
            </p>
          )}
          {s.gopay.unnamed > 0 && (
            <p className="mt-1 text-muted-foreground">
              {t(
                `${s.gopay.unnamed} pembayaran masih tercatat “GoPay” saja. Tambahkan e-statement GoPay bulan yang sama untuk tahu itu bayar apa.`,
                `${s.gopay.unnamed} payment(s) still say just “GoPay”. Add the GoPay e-statement for the same month to see what they were.`,
              )}
            </p>
          )}
          {s.gopay.walletPayments > 0 && (
            <p className="mt-1 text-muted-foreground">
              {t(`${s.gopay.walletPayments} pembayaran dari saldo GoPay ikut dihitung.`, `${s.gopay.walletPayments} payment(s) from GoPay balance are included.`)}
            </p>
          )}
        </Card>
      )}
    </section>
  );
}

/** Payments from GoPay balance count as spending too (the Jago top-up that funded them is a transfer). */
function walletSpend(s: StatementSummary): number {
  return s.categories.reduce((n, c) => n + c.amount, 0) - s.totals.moneyOut;
}

function Stat({ label, value, muted }: { label: ReactNode; value: string; muted?: boolean }) {
  return (
    <Card>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-extrabold tracking-tight tabular-nums", muted && "text-muted-foreground")}>{value}</p>
    </Card>
  );
}

/** One series of horizontal bars: identity is the row label, magnitude the bar (series-1 token), values in text ink. */
function Bars({ title, rows, note, lang }: { title: ReactNode; rows: { label: string; amount: number; count: number; dim?: boolean }[]; note?: ReactNode; lang: Lang }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={r.label} title={`${r.label}: ${rp(r.amount)} · ${r.count} ${lang === "en" ? "transaction(s)" : "transaksi"}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className={cn("truncate", r.dim && "text-muted-foreground italic")}>{r.label}</span>
              <span className="shrink-0 tabular-nums">{rp(r.amount)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full" style={{ background: "var(--viz-series-1-track)" }}>
              <div
                className="h-2 rounded-full"
                style={{ width: `${Math.max(2, (r.amount / max) * 100)}%`, background: r.dim ? "var(--viz-previous)" : "var(--viz-series-1)" }}
              />
            </div>
          </li>
        ))}
      </ul>
      {note && <p className="mt-3 text-xs text-muted-foreground">{note}</p>}
    </Card>
  );
}
