import { parseWith } from "./common";
import type { SourceParser } from "./types";

/**
 * Bank Jago (com.jago.digitalBanking; Jago and Jago Syariah share the app). Formats it uses for finished
 * transactions; see jago.test.ts for the sample strings. Add a pattern to KNOWN when a new wording shows up.
 */
const KNOWN = [
  /\bpembayaran(?: qris)? (?:ke|di) .+ (?:berhasil|sukses)/i,
  /\bpembayaran(?: qris)? (?:Rp|IDR)/i,
  /\b(?:Rp|IDR)\s?[\d.,]+ (?:telah |sudah )?dibayarkan ke\b/i,
  /\btransfer (?:(?:Rp|IDR)\s?[\d.,]+ )?ke .+ berhasil/i,
  /\b(?:kamu|anda) menerima (?:Rp|IDR)/i,
  /\buang masuk\b.*(?:Rp|IDR)/i,
  /\btransaksi kartu (?:debit )?(?:Rp|IDR)/i,
  /\bauto ?debit (?:Rp|IDR)/i,
  /\btarik tunai (?:Rp|IDR)/i,
];

export const parseJago: SourceParser = (n) =>
  parseWith(n, "jago", {
    known: KNOWN,
    ignore: [
      // Moving money between the user's own pockets: not spending, and the statement shows both legs.
      [/\b(?:dipindahkan|pindah uang|pindahkan uang)\b.*\bkantong\b|\bdari kantong .+ ke kantong\b/i, "between own pockets"],
      [/\bbunga\b.*\b(?:diterima|masuk)\b/i, "interest (the statement has it)"],
    ],
  });
