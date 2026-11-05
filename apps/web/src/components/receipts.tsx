// Receipt photos and the "Reimburse / Diganti kantor" switch, shared by the add sheet, the transactions list and the
// Reimburse page. Photos are only ever loaded from /api/attachments/{id} with the member's session: never a public URL.

import type { AppRouterClient } from "@baroka/api/routers/index";
import { Button } from "@baroka/ui/components/button";
import { Checkbox } from "@baroka/ui/components/checkbox";
import { Select } from "@baroka/ui/components/select";
import { cn } from "@baroka/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { shrinkReceipt } from "@/lib/receipt-image";
import { SERVER_URL, client, errorMessage, orpc } from "@/lib/orpc";

export type Tx = Awaited<ReturnType<AppRouterClient["transactions"]["search"]>>["transactions"][number];
type ReimburseStatus = NonNullable<Tx["reimburse"]>["status"];

export function attachmentUrl(id: string): string {
  return `${SERVER_URL}/api/attachments/${id}`;
}

/** A receipt photo; opens full size in a new tab (same session). */
export function ReceiptThumb({ id, alt, className }: { id: string; alt: string; className?: string }) {
  return (
    <a href={attachmentUrl(id)} target="_blank" rel="noreferrer" className={cn("block shrink-0 overflow-hidden rounded-xl bg-muted", className ?? "size-16")}>
      <img src={attachmentUrl(id)} alt={alt} loading="lazy" className="size-full object-cover" />
    </a>
  );
}

/**
 * "Take photo" (the camera on phones: capture=environment) and "Choose photo" (gallery or files). The picked image is
 * shrunk to ~1600 px JPEG before it is handed over.
 */
export function PhotoButtons({ onPick, busy, takeLabel = "Foto struk", chooseLabel = "Pilih foto", size = "default" }: { onPick: (file: File) => void; busy?: boolean; takeLabel?: string; chooseLabel?: string; size?: "default" | "sm" }) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const pick = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      onPick(await shrinkReceipt(file));
    } catch (error) {
      toast.error("Couldn't open that photo", { description: errorMessage(error) });
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void pick(e.currentTarget)} />
      <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*" className="hidden" onChange={(e) => void pick(e.currentTarget)} />
      <Button type="button" size={size} variant="secondary" disabled={busy} onClick={() => camera.current?.click()}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Camera aria-hidden />} {takeLabel}
      </Button>
      <Button type="button" size={size} variant="ghost" disabled={busy} onClick={() => gallery.current?.click()}>
        <ImagePlus aria-hidden /> {chooseLabel}
      </Button>
    </div>
  );
}

export const REIMBURSE_LABEL: Record<ReimburseStatus, string> = {
  draft: "Diganti kantor",
  submitted: "Diajukan",
  paid: "Sudah diganti",
  rejected: "Ditolak",
  payment: "Pembayaran klaim",
};

/** Reimbursement profiles, the most recently used first (the default). */
export function useReimburseProfiles() {
  return useQuery(orpc.reimburse.profiles.list.queryOptions({ input: {} }));
}

/**
 * The switch and the company picker. `value.on` with `profileId` "" means the default (last used) profile. Without a
 * profile it links to Settings.
 */
export function ReimburseSwitch({
  value,
  onChange,
  disabled,
  locked,
}: {
  value: { on: boolean; profileId: string };
  onChange: (v: { on: boolean; profileId: string }) => void;
  disabled?: boolean;
  /** Shown instead of the switch when the item is already in a claim. */
  locked?: string | null;
}) {
  const profiles = useReimburseProfiles();
  const list = (profiles.data?.profiles ?? []).filter((p) => !p.archived);
  const none = profiles.isSuccess && !list.length;
  if (locked) return <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">{locked}</p>;
  return (
    <div className="space-y-2 rounded-2xl bg-muted/60 p-3">
      <label className="flex items-start gap-3 text-sm">
        <Checkbox checked={value.on} disabled={disabled || none} onCheckedChange={(on) => onChange({ ...value, on: !!on })} className="mt-0.5" />
        <span>
          <span className="block font-semibold">Reimburse · Diganti kantor</span>
          <span className="block text-xs text-muted-foreground">Paid for work; the company pays it back. Not counted as household spending.</span>
        </span>
      </label>
      {none && (
        <p className="text-xs text-muted-foreground">
          Add the company that pays you back first:{" "}
          <Link to="/settings" hash="reimburse" className="font-semibold text-primary underline">
            Settings → Reimbursement
          </Link>
          .
        </p>
      )}
      {value.on && list.length > 1 && (
        <Select
          size="sm"
          aria-label="Company"
          value={value.profileId || list[0]!.id}
          onValueChange={(v) => onChange({ ...value, profileId: v })}
          items={list.map((p) => ({ value: p.id, label: p.companyName }))}
        />
      )}
      {value.on && list.length === 1 && <p className="text-xs text-muted-foreground">For {list[0]!.companyName}</p>}
    </div>
  );
}

/** Invalidate everything a photo or reimbursement change shows up in. */
export function useLedgerRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["transactions"] });
    void qc.invalidateQueries({ queryKey: orpc.reports.key() });
    void qc.invalidateQueries({ queryKey: orpc.accounts.key() });
    void qc.invalidateQueries({ queryKey: orpc.reimburse.key() });
  };
}

/** Photos and reimbursement of one transaction: attach, replace or remove a photo; mark it reimbursable. */
export function TransactionExtras({ t }: { t: Tx }) {
  const refresh = useLedgerRefresh();
  const [replace, setReplace] = useState(true);
  const upload = useMutation({
    mutationFn: (v: { file: File; replace: boolean }) => client.attachments.upload({ file: v.file, transactionId: t.id, replace: v.replace }),
    onSuccess: () => {
      toast.success("Photo saved");
      refresh();
    },
    onError: (e) => toast.error("Couldn't save the photo", { description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.attachments.delete({ id }),
    onSuccess: () => refresh(),
    onError: (e) => toast.error("Couldn't remove the photo", { description: errorMessage(e) }),
  });
  const mark = useMutation({
    mutationFn: (v: { on: boolean; profileId: string }) => client.reimburse.mark({ ids: [t.id], reimbursable: v.on, ...(v.profileId ? { profileId: v.profileId } : {}) }),
    onSuccess: (_r, v) => {
      toast.success(v.on ? "Marked reimbursable" : "Back to household spending");
      refresh();
    },
    onError: (e) => toast.error("Couldn't change it", { description: errorMessage(e) }),
  });
  const status = t.reimburse?.status;
  const locked =
    status === "submitted" || status === "paid"
      ? `${REIMBURSE_LABEL[status]}: in a claim report. Change it on the Reimburse page.`
      : null;
  return (
    <div className="col-span-2 w-full space-y-3 pb-1 sm:order-5">
      <div className="flex flex-wrap items-center gap-3">
        {t.attachments.map((a) => (
          <div key={a.id} className="relative">
            <ReceiptThumb id={a.id} alt={`Receipt for ${t.merchant ?? t.description}`} />
            <button
              type="button"
              aria-label="Remove photo"
              className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-card text-destructive shadow-sm"
              disabled={remove.isPending}
              onClick={() => confirm("Remove this photo?") && remove.mutate(a.id)}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
        <PhotoButtons size="sm" busy={upload.isPending} takeLabel="Take photo" chooseLabel="Choose photo" onPick={(file) => upload.mutate({ file, replace: replace && t.attachments.length > 0 })} />
        {t.attachments.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={replace} onCheckedChange={(v) => setReplace(!!v)} /> Replace the current photo
          </label>
        )}
      </div>
      {t.amount < 0 && (
        <ReimburseSwitch
          value={{ on: status === "draft", profileId: t.reimburse?.profileId ?? "" }}
          onChange={(v) => mark.mutate(v)}
          disabled={mark.isPending}
          locked={locked}
        />
      )}
      {status === "payment" && <p className="text-xs text-muted-foreground">This is an employer's payment for a claim, so it is not counted as income.</p>}
    </div>
  );
}
