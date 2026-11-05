// Receipt photos on the phone, the pure part: the size a photo is shrunk to before upload (~1600 px on the long side,
// JPEG at 0.7, like the web), the multipart part, reimbursement labels, and where an authenticated file lives. The
// camera, gallery and resize glue is src/lib/receipt-photo.ts.

import type { UploadFile } from "./api";

export const RECEIPT_MAX_SIDE = 1600;
export const RECEIPT_QUALITY = 0.7;

/** The resize for an image of w×h: only the long side is given (the other follows), never upscaled; null = keep. */
export function resizeFor(width: number, height: number, max = RECEIPT_MAX_SIDE): { width: number } | { height: number } | null {
  if (!width || !height || Math.max(width, height) <= max) return null;
  return width >= height ? { width: max } : { height: max };
}

export function receiptUpload(uri: string): UploadFile {
  return { uri, name: "struk.jpg", type: "image/jpeg" };
}

export type ReimburseStatus = "draft" | "submitted" | "paid" | "rejected" | "payment";

export const REIMBURSE_LABEL: Record<ReimburseStatus, string> = {
  draft: "Diganti kantor",
  submitted: "Diajukan",
  paid: "Sudah diganti",
  rejected: "Ditolak",
  payment: "Pembayaran klaim",
};

export const REIMBURSE_TONE: Record<ReimburseStatus, "primary" | "positive" | "destructive"> = {
  draft: "primary",
  submitted: "primary",
  paid: "positive",
  rejected: "destructive",
  payment: "positive",
};

/** Whether the switch can change it here: items in a claim are changed on the Reimburse screen. */
export function reimburseLocked(status: ReimburseStatus | null | undefined): string | null {
  if (status === "submitted" || status === "paid") return `${REIMBURSE_LABEL[status]}: in a claim report. Change it on the Reimburse screen.`;
  if (status === "payment") return "This is a company's payment for a claim, so it is not counted as income.";
  return null;
}

/** "RB-2026-0001.pdf" → a safe file name in the cache directory. */
export function claimFileName(number: string, kind: "pdf" | "csv"): string {
  return `${number.replace(/[^A-Za-z0-9-]/g, "_") || "klaim"}.${kind}`;
}
