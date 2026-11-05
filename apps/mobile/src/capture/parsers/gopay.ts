import { parseWith } from "./common";
import type { SourceParser } from "./types";

/** GoPay inside Gojek (com.gojek.app) and the GoPay app (com.gojek.gopay). Samples in gopay.test.ts. */
const KNOWN = [
  /\bpembayaran (?:ke|di) .+ berhasil/i,
  /\bpembayaran (?:Rp|IDR)\s?[\d.,]+ (?:ke|di) .+ berhasil/i,
  /\bpembayaran (?:Go[A-Z][a-z]+|ke)\b.*(?:Rp|IDR)/i,
  /\bbayar (?:Rp|IDR)\s?[\d.,]+\s?(?:rb|k)? (?:ke|di) /i,
  /\b(?:kamu|anda) menerima (?:Rp|IDR)/i,
  /\b(?:Rp|IDR)\s?[\d.,]+ (?:udah|sudah|telah) (?:dikirim|terkirim) ke\b/i,
  /\btransfer (?:ke .+ )?berhasil\b/i,
  /\btop ?up\b.*\b(?:berhasil|bertambah)\b/i,
  /\bsaldo gopay(?: kamu)? bertambah\b/i,
  /\brefund\b.*\b(?:masuk|dikembalikan)\b/i,
];

/** Gojek services paid with GoPay: "Pembayaran GoRide Rp18.000" names the service, not a merchant. */
const SERVICE = /\b(GoRide|GoCar|GoFood|GoSend|GoMart|GoBox|GoTix|GoPulsa|GoTagihan|GoBills)\b/;

export const parseGopay: SourceParser = (n) => {
  const result = parseWith(n, "gopay", {
    known: KNOWN,
    ignore: [
      [/\bpesanan(?:mu)? (?:sudah|udah|sedang)\b(?!.*(?:Rp|IDR))/i, "order status"],
      [/\bdriver\b(?!.*(?:Rp|IDR))/i, "trip status"],
    ],
  });
  if (result.ok && !result.capture.counterparty) {
    const service = SERVICE.exec(`${n.title} ${n.text}`)?.[1];
    if (service) {
      result.capture.counterparty = service;
      result.capture.doubts = result.capture.doubts.filter((d) => d !== "no merchant or name");
      result.capture.confidence = result.capture.doubts.length ? "low" : "high";
    }
  }
  return result;
};
