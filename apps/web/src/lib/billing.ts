// Joyo Pro in the web app: recognising the server's upgrade errors, the shared upgrade prompt, prices and copy.
// The server is the judge (packages/api/src/services/billing.ts); this only explains and offers the way up.

import { ORPCError } from "@orpc/client";
import { useSyncExternalStore } from "react";

export type UpgradeFeature = "statementImports" | "bulkImport" | "emailImport" | "joyoAi" | "members" | "savedScenarios" | "mcpConnector";

/** A Free limit: FORBIDDEN with `data.upgrade` (Joyo AI's cap too). */
export function isUpgradeError(error: unknown): error is ORPCError<string, { upgrade: true; feature: UpgradeFeature; limit?: number }> {
  return error instanceof ORPCError && (error.data as { upgrade?: unknown } | undefined)?.upgrade === true;
}

// One prompt for the whole app: any call that hits a limit opens it (lib/orpc.ts), wherever the call came from.
let current: UpgradeFeature | null = null;
const listeners = new Set<() => void>();

export function openUpgrade(feature: UpgradeFeature) {
  current = feature;
  for (const l of listeners) l();
}

export function closeUpgrade() {
  current = null;
  for (const l of listeners) l();
}

export function useUpgradePrompt(): UpgradeFeature | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}

type T = <V>(id: V, en: V) => V;

/** Title and one line per feature, in Bahasa Indonesia and English. */
export function upgradeCopy(feature: UpgradeFeature, t: T): { title: string; body: string } {
  switch (feature) {
    case "statementImports":
      return {
        title: t("Kuota import statement bulan ini habis", "This month's statement imports are used up"),
        body: t(
          "Paket Free bisa import 2 statement sebulan. Pro: tanpa batas, termasuk banyak file sekaligus, kirim lewat email dan share dari HP. CSV dan catat manual tetap gratis.",
          "Free includes 2 statement imports a month. Pro is unlimited, including several files at once, email-in and share-to-app. CSV and manual entries stay free.",
        ),
      };
    case "bulkImport":
      return {
        title: t("Import banyak statement sekaligus itu fitur Pro", "Importing many statements at once is Pro"),
        body: t("Di Free, import satu per satu (2 statement sebulan). Pro: semua sekaligus, tanpa batas.", "On Free, import one at a time (2 statements a month). Pro: all at once, unlimited."),
      };
    case "emailImport":
      return {
        title: t("Import lewat email itu fitur Pro", "Importing by email is Pro"),
        body: t("Forward statement ke alamat pribadi rumah tanggamu, langsung masuk dan kamu dapat ringkasannya.", "Forward statements to your household's private address; they are imported right away and you get a summary."),
      };
    case "joyoAi":
      return {
        title: t("Pertanyaan Joyo AI hari ini habis", "That's today's Joyo AI questions"),
        body: t(
          "Free dapat 5 pertanyaan sehari. Pro dapat jauh lebih banyak. Atau pakai API key sendiri di pengaturan Joyo AI.",
          "Free includes 5 questions a day. Pro gets many more. Or use your own API key in Joyo AI settings.",
        ),
      };
    case "members":
      return {
        title: t("Dengan Free, rumah tangga maksimal 2 orang", "On Free a household has up to 2 people"),
        body: t(
          "Dengan Joyo Pro, yang mengundang bisa menambah sampai 6 anggota, misalnya orang tua atau pengasuh. Undangan yang belum diterima ikut dihitung.",
          "With Joyo Pro the person inviting can bring up to 6 members, say parents or a nanny. Pending invites count too.",
        ),
      };
    case "savedScenarios":
      return {
        title: t("Simpan skenario itu fitur Pro", "Saving scenarios is Pro"),
        body: t(
          "Simulasi tetap jalan dan draft-mu tersimpan di perangkat ini. Dengan Joyo Pro, kamu bisa menyimpan skenario untuk seluruh rumah tangga.",
          "Simulations still work and your draft stays on this device. With Joyo Pro you can save scenarios for the whole household.",
        ),
      };
    case "mcpConnector":
      return {
        title: t("Konektor Claude itu fitur Pro", "The Claude connector is Pro"),
        body: t("Tanya Claude soal uangmu dari claude.ai, Claude Desktop atau Claude Code.", "Ask Claude about your money from claude.ai, Claude Desktop or Claude Code."),
      };
  }
}

/** "Rp 29.000" from whole rupiah. */
export function rupiah(whole: number): string {
  return `Rp ${whole.toLocaleString("id-ID")}`;
}

/** "$9.99" from cents. */
export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/** "4 Desember 2026" / "December 4, 2026". */
export function longDate(value: Date | string | number, en: boolean): string {
  return new Date(value).toLocaleDateString(en ? "en-US" : "id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
}
