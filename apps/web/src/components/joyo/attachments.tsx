// Picking files for a Joyo AI question: a paperclip button, drop and paste, and chips for what will be sent.

import { Button } from "@baroka/ui/components/button";
import { cn } from "@baroka/ui/lib/utils";
import { FileText, Image as ImageIcon, Loader2, Paperclip, Sheet as SheetIcon, TriangleAlert, X } from "lucide-react";
import { useRef, useState } from "react";

import { ACCEPT, MAX_ATTACHMENTS, attachmentKind, readAttachment } from "@/lib/joyo-attachments";
import type { ChatAttachmentIn } from "@/lib/joyo-attachments";

export type Picked = { id: string; name: string; kind: ReturnType<typeof attachmentKind>; state: "reading" | "ready" | "error"; error?: string; items?: ChatAttachmentIn[] };

export function useAttachments() {
  const [list, setList] = useState<Picked[]>([]);
  const listRef = useRef(list);
  listRef.current = list;
  const add = (files: Iterable<File>) => {
    const take = [...files].slice(0, Math.max(0, MAX_ATTACHMENTS - listRef.current.length));
    if (!take.length) return;
    const added: Picked[] = take.map((f) => ({ id: Math.random().toString(36).slice(2), name: f.name, kind: attachmentKind(f.name, f.type), state: "reading" }));
    listRef.current = [...listRef.current, ...added];
    setList((cur) => [...cur, ...added]);
    take.forEach((file, i) => {
      const id = added[i]!.id;
      readAttachment(file)
        .then((items) => setList((l) => l.map((p) => (p.id === id ? { ...p, state: "ready", items } : p))))
        .catch((e: unknown) => setList((l) => l.map((p) => (p.id === id ? { ...p, state: "error", error: e instanceof Error ? e.message : "Couldn't read this file." } : p))));
    });
  };
  const remove = (id: string) => setList((l) => l.filter((p) => p.id !== id));
  const clear = () => setList([]);
  const ready = list.filter((p) => p.state === "ready").flatMap((p) => p.items ?? []).slice(0, MAX_ATTACHMENTS);
  return { list, add, remove, clear, ready, busy: list.some((p) => p.state === "reading"), full: list.length >= MAX_ATTACHMENTS };
}

export function AttachButton({ onFiles, disabled, className }: { onFiles: (files: File[]) => void; disabled?: boolean; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles([...e.target.files]);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("shrink-0 text-muted-foreground", className)}
        aria-label="Attach a photo, PDF or table"
        title="Attach a photo, PDF or table"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Paperclip aria-hidden />
      </Button>
    </>
  );
}

const KIND_ICON = { image: ImageIcon, pdf: FileText, table: SheetIcon, excel: SheetIcon } as const;

export function AttachmentChips({ list, onRemove }: { list: Picked[]; onRemove: (id: string) => void }) {
  if (!list.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Attached files">
      {list.map((p) => {
        const Icon = p.state === "reading" ? Loader2 : p.state === "error" ? TriangleAlert : p.kind ? KIND_ICON[p.kind] : FileText;
        const scan = p.kind === "pdf" && p.items?.some((i) => i.kind === "image");
        return (
          <li
            key={p.id}
            title={p.error ?? (scan ? "Scanned PDF: its first pages are sent as images" : p.name)}
            className={cn(
              "flex max-w-full items-center gap-1.5 rounded-full py-1 pr-1 pl-2.5 text-xs font-medium",
              p.state === "error" ? "bg-destructive-soft text-destructive-ink" : "bg-card text-foreground ring-1 ring-border",
            )}
          >
            <Icon aria-hidden className={cn("size-3.5 shrink-0", p.state === "reading" && "animate-spin")} />
            <span className="min-w-0 truncate">{p.state === "error" ? `${p.name}: ${p.error}` : p.name}</span>
            {scan && <span className="text-muted-foreground">· scan</span>}
            <button type="button" aria-label={`Remove ${p.name}`} className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-muted" onClick={() => onRemove(p.id)}>
              <X aria-hidden className="size-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Files dropped onto or pasted into an element. */
export function filesFrom(data: DataTransfer | null): File[] {
  return data ? [...data.files] : [];
}
