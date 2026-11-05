// Receipt photos are shrunk in the browser before upload: about 1600 px on the long side, JPEG at 0.7. A phone photo
// of 4–8 MB becomes ~300 KB, which is plenty to read a receipt and to print it in a claim report.

export const RECEIPT_MAX_SIDE = 1600;
export const RECEIPT_QUALITY = 0.7;

/** The target size for an image of w×h: never upscaled. */
export function fitWithin(w: number, h: number, max = RECEIPT_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** A JPEG File ready to upload. EXIF rotation is applied (createImageBitmap honours it), and the EXIF itself is dropped. */
export async function shrinkReceipt(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't prepare the photo.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", RECEIPT_QUALITY));
    if (!blob) throw new Error("This browser can't prepare the photo.");
    return new File([blob], "struk.jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
