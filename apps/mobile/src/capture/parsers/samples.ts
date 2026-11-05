// Sample notifications for the parser tests. Bank Jago and GoPay do not publish their templates, so these follow
// the wording their apps and help pages use (amount style "Rp25.000", "Kamu menerima", "Pembayaran ke X berhasil").
// Names and amounts are made up. When a real notification parses badly, add it here (anonymised) with what it
// should give.

export type Sample = {
  name: string;
  packageName: string;
  title: string;
  text: string;
  expect:
    | { ignored: string }
    | { direction: "in" | "out"; amountMinor: number; counterparty: string | null; kind?: string; confidence?: "high" | "low" };
};

export const JAGO = "com.jago.digitalBanking";
export const GOJEK = "com.gojek.app";
export const GOPAY = "com.gojek.gopay";

export const SAMPLES: Sample[] = [
  // Bank Jago
  {
    name: "jago payment",
    packageName: JAGO,
    title: "Pembayaran berhasil",
    text: "Pembayaran ke KOPI KENANGAN sebesar Rp25.000 dari Kantong Utama berhasil.",
    expect: { direction: "out", amountMinor: 2_500_000, counterparty: "KOPI KENANGAN", kind: "payment", confidence: "high" },
  },
  {
    name: "jago incoming transfer",
    packageName: JAGO,
    title: "Uang masuk",
    text: "Kamu menerima Rp1.500.000 dari BUDI SANTOSO ke Kantong Utama.",
    expect: { direction: "in", amountMinor: 150_000_000, counterparty: "BUDI SANTOSO", kind: "incoming", confidence: "high" },
  },
  {
    name: "jago transfer out",
    packageName: JAGO,
    title: "Transfer berhasil",
    text: "Transfer Rp200.000 ke SITI AMINAH (BCA) berhasil.",
    expect: { direction: "out", amountMinor: 20_000_000, counterparty: "SITI AMINAH", kind: "transfer", confidence: "high" },
  },
  {
    name: "jago QRIS",
    packageName: JAGO,
    title: "Transaksi QRIS berhasil",
    text: "Pembayaran QRIS Rp45.500 di WARUNG BU TINI berhasil.",
    expect: { direction: "out", amountMinor: 4_550_000, counterparty: "WARUNG BU TINI", confidence: "high" },
  },
  {
    name: "jago pays gopay",
    packageName: JAGO,
    title: "Pembayaran GoPay berhasil",
    text: "Rp32.000 telah dibayarkan ke Gojek dari Kantong Utama.",
    expect: { direction: "out", amountMinor: 3_200_000, counterparty: "Gojek", confidence: "high" },
  },
  {
    name: "jago debit card with decimals and time",
    packageName: JAGO,
    title: "Transaksi kartu",
    text: "Transaksi kartu debit Rp150.000,00 di TOKOPEDIA pada 04/11/2026 10:21 WIB.",
    expect: { direction: "out", amountMinor: 15_000_000, counterparty: "TOKOPEDIA", confidence: "high" },
  },
  {
    name: "jago autodebit",
    packageName: JAGO,
    title: "Autodebit berhasil",
    text: "Autodebit Rp186.000 untuk NETFLIX berhasil dari Kantong Langganan.",
    expect: { direction: "out", amountMinor: 18_600_000, counterparty: "NETFLIX", confidence: "high" },
  },
  {
    name: "jago pocket move",
    packageName: JAGO,
    title: "Pindah uang berhasil",
    text: "Rp500.000 dipindahkan dari Kantong Utama ke Kantong Tabungan.",
    expect: { ignored: "between own pockets" },
  },
  {
    name: "jago OTP",
    packageName: JAGO,
    title: "Jago",
    text: "Kode OTP kamu 482913. Jangan berikan kode ini ke siapa pun, termasuk pihak Jago.",
    expect: { ignored: "verification code" },
  },
  {
    name: "jago promo",
    packageName: JAGO,
    title: "Ada cashback buat kamu!",
    text: "Bayar pakai Jago di GoFood, dapat cashback hingga Rp20.000.",
    expect: { ignored: "cashback" },
  },
  {
    name: "jago failed",
    packageName: JAGO,
    title: "Transfer gagal",
    text: "Transfer Rp200.000 ke SITI AMINAH gagal. Saldo kamu tidak terpotong.",
    expect: { ignored: "failed or cancelled" },
  },

  // GoPay / Gojek
  {
    name: "gopay payment (amount last)",
    packageName: GOJEK,
    title: "GoPay",
    text: "Pembayaran ke Sate Khas Senayan berhasil Rp25.000",
    expect: { direction: "out", amountMinor: 2_500_000, counterparty: "Sate Khas Senayan", kind: "payment", confidence: "high" },
  },
  {
    name: "gopay received",
    packageName: GOPAY,
    title: "Kamu menerima uang",
    text: "Kamu menerima Rp50.000 dari Andi Wijaya via GoPay.",
    expect: { direction: "in", amountMinor: 5_000_000, counterparty: "Andi Wijaya", kind: "incoming", confidence: "high" },
  },
  {
    name: "gopay sent",
    packageName: GOPAY,
    title: "Transfer ke Budi berhasil",
    text: "Rp100.000 udah dikirim ke Budi.",
    expect: { direction: "out", amountMinor: 10_000_000, counterparty: "Budi", kind: "transfer", confidence: "high" },
  },
  {
    name: "gopay top up",
    packageName: GOPAY,
    title: "Top up GoPay berhasil",
    text: "Saldo GoPay kamu bertambah Rp200.000 dari Bank Jago.",
    expect: { direction: "in", amountMinor: 20_000_000, counterparty: "Bank Jago", kind: "topup", confidence: "high" },
  },
  {
    name: "gojek ride",
    packageName: GOJEK,
    title: "Pembayaran GoRide",
    text: "Pembayaran GoRide Rp18.000 pakai GoPay berhasil.",
    expect: { direction: "out", amountMinor: 1_800_000, counterparty: "GoRide", confidence: "high" },
  },
  {
    name: "gopay shorthand amount",
    packageName: GOPAY,
    title: "Pembayaran berhasil",
    text: "Bayar Rp15rb ke Indomaret Kemang pakai GoPay berhasil.",
    expect: { direction: "out", amountMinor: 1_500_000, counterparty: "Indomaret Kemang", confidence: "high" },
  },
  {
    name: "gopay refund",
    packageName: GOJEK,
    title: "Refund berhasil",
    text: "Refund Rp25.000 dari GoFood udah masuk ke GoPay kamu.",
    expect: { direction: "in", amountMinor: 2_500_000, counterparty: "GoFood", kind: "refund", confidence: "high" },
  },
  {
    name: "gojek order status",
    packageName: GOJEK,
    title: "Pesanan diterima",
    text: "Pesananmu sudah diterima restoran dan sedang disiapkan.",
    expect: { ignored: "order status" },
  },
  {
    name: "gojek promo",
    packageName: GOJEK,
    title: "Diskon 50% GoFood",
    text: "Makan siang hemat, diskon s.d. Rp25.000 pakai GoPay. Yuk pesan!",
    expect: { ignored: "promotion" },
  },
  {
    name: "gopay coins",
    packageName: GOPAY,
    title: "GoPay Coins masuk",
    text: "Kamu dapat 250 GoPay Coins dari transaksi Rp25.000.",
    expect: { ignored: "GoPay Coins" },
  },

  // Finished transactions that also mention a reward, and free-text notes: still captured
  {
    name: "gopay payment with cashback",
    packageName: GOJEK,
    title: "GoPay",
    text: "Pembayaran ke KOPI KENANGAN berhasil Rp25.000. Kamu dapat cashback Rp2.500!",
    expect: { direction: "out", amountMinor: 2_500_000, counterparty: "KOPI KENANGAN", kind: "payment", confidence: "high" },
  },
  {
    name: "gopay payment with coins",
    packageName: GOJEK,
    title: "Pembayaran berhasil",
    text: "Pembayaran Rp18.000 ke Warung Bu Sri berhasil. Dapat 180 GoPay Coins",
    expect: { direction: "out", amountMinor: 1_800_000, counterparty: "Warung Bu Sri", confidence: "high" },
  },
  {
    name: "gopay received with a note",
    packageName: GOPAY,
    title: "Kamu menerima uang",
    text: "Kamu menerima Rp50.000 dari Andi. Pesan: makan siang hemat",
    expect: { direction: "in", amountMinor: 5_000_000, counterparty: "Andi", kind: "incoming", confidence: "high" },
  },
  {
    name: "jago transfer in with a note that says gagal",
    packageName: JAGO,
    title: "Uang masuk",
    text: "Kamu menerima Rp75.000 dari BUDI SANTOSO. Berita: ganti OTP gagal kemarin",
    expect: { direction: "in", amountMinor: 7_500_000, counterparty: "BUDI SANTOSO", kind: "incoming", confidence: "high" },
  },
  {
    name: "gopay cashback credited (reward only)",
    packageName: GOPAY,
    title: "Cashback masuk",
    text: "Cashback Rp2.500 udah masuk ke GoPay kamu.",
    expect: { ignored: "cashback" },
  },

  // Low confidence: an amount and a direction but unfamiliar wording
  {
    name: "jago unfamiliar wording",
    packageName: JAGO,
    title: "Info transaksi",
    text: "Ada transaksi Rp75.000 di rekening kamu.",
    expect: { direction: "out", amountMinor: 7_500_000, counterparty: null, confidence: "low" },
  },
];
