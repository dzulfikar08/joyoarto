// The add-transaction sheet behind the bottom nav's centre button: say it or type it, review the draft, save it as a
// pending transaction (transactions.quickAdd, the same as the quick-add box). Voice recording follows JoyoRogo's
// "Ceritakan" sheet (apps/web/src/components/cerita.tsx): MediaRecorder, at most 60 s, transcribed on the server.
// A receipt photo (camera or gallery, shrunk to ~1600 px JPEG here) is read on the server into the same draft; the photo
// is kept and attached on Save. Nothing is saved before the member taps Save on the review step.

import { parseAmountText } from "@baroka/api/lib/amount-text";
import type { CaptureDraft } from "@baroka/api/lib/capture-parse";
import { Button } from "@baroka/ui/components/button";
import { Combobox } from "@baroka/ui/components/combobox";
import { Input } from "@baroka/ui/components/input";
import { Sheet } from "@baroka/ui/components/sheet";
import { Textarea } from "@baroka/ui/components/textarea";
import { cn } from "@baroka/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Mic, ReceiptText, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Field } from "@/components/kit";
import { storedAccount, useSaveQuickAdd } from "@/components/quick-add";
import { setAddSheetOpen, useAddSheetOpen } from "@/lib/add-sheet";
import { formatMoney } from "@/lib/format";
import { accountOptions, categoryOptions } from "@/lib/options";
import { client, errorMessage, orpc } from "@/lib/orpc";
import { PhotoButtons, ReimburseSwitch } from "@/components/receipts";
import { askAiConsentOnce, ensureAiConsent } from "@/lib/ai-consent";

/** Whisper reads these as-is: Chrome/Firefox record webm/opus, Safari mp4/aac. */
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
const MAX_RECORD_MS = 60_000;

const EXAMPLES = ["kopi kenangan 25rb gopay", "gaji masuk 16 juta", "kemarin parkir 5rb cash"];

function recorderMime(): string | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
  if (!navigator.mediaDevices?.getUserMedia) return null;
  return AUDIO_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function todayWib(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** The draft's amount as the member would type it: "25.000". */
function amountTextOf(minor: number | null): string {
  if (minor === null) return "";
  return (minor / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

type Phase = "input" | "recording" | "listening" | "reading" | "scanning" | "review";

type Review = {
  amountText: string;
  direction: "in" | "out";
  description: string;
  merchant: string;
  note: string;
  category: string;
  accountId: string;
  date: string;
  via: "voice" | "manual" | "receipt";
  heard: string | null;
  source: CaptureDraft["source"] | "hand";
  /** The receipt photo, uploaded already (attached on Save), and a local preview of it. */
  photo: { id: string; preview: string } | null;
  /** Why the photo could not be read (no AI, today's cap, unreadable); the draft is then empty. */
  ocrNote: string | null;
  reimburse: { on: boolean; profileId: string };
};

function emptyReview(): Review {
  return {
    amountText: "",
    direction: "out",
    description: "",
    merchant: "",
    note: "",
    category: "",
    accountId: storedAccount(),
    date: todayWib(),
    via: "manual",
    heard: null,
    source: "hand",
    photo: null,
    ocrNote: null,
    reimburse: { on: false, profileId: "" },
  };
}

export function AddSheet() {
  const open = useAddSheetOpen();
  // A fresh sheet every time it opens: no draft lingers from last time.
  const [session, setSession] = useState(0);
  useEffect(() => {
    if (open) setSession((n) => n + 1);
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={setAddSheetOpen} title="Add transaction" description="Say it or type it. You check it before it's saved.">
      {open && <AddFlow key={session} onDone={() => setAddSheetOpen(false)} />}
    </Sheet>
  );
}

function AddFlow({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("input");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [review, setReview] = useState<Review>(emptyReview);
  const [mime] = useState(recorderMime);
  const status = useQuery(orpc.joyo.status.queryOptions());
  const voiceOn = mime !== null && status.data?.voice !== false;

  const recorderRef = useRef<MediaRecorder | null>(null);
  const discardRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      discardRef.current = true;
      recorderRef.current?.stop();
      abortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (phase !== "recording") return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_RECORD_MS) recorderRef.current?.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [phase]);

  const toReview = (draft: CaptureDraft, via: Review["via"], heard: string | null, extra: Partial<Review> = {}) => {
    setReview({
      ...emptyReview(),
      amountText: amountTextOf(draft.amount),
      direction: draft.direction,
      description: draft.description,
      merchant: draft.merchant ?? "",
      note: draft.note ?? "",
      category: draft.category ?? "",
      accountId: draft.accountId ?? storedAccount(),
      date: draft.date,
      via,
      heard,
      source: draft.source,
      ...extra,
    });
    setPhase("review");
  };

  const scanReceipt = async (file: File) => {
    // The photo goes to an AI to be read: only with the member's permission.
    if (!(await ensureAiConsent())) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setPhase("scanning");
    try {
      const res = await client.capture.receipt({ image: file }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      toReview(res.draft, "receipt", null, {
        photo: { id: res.attachment.id, preview: URL.createObjectURL(file) },
        ocrNote: res.ocr.status === "ok" ? null : res.ocr.message,
        accountId: res.draft.accountId ?? storedAccount(),
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(errorMessage(err));
      setPhase("input");
    }
  };

  const parse = async (input: string, via: Review["via"], heard: string | null) => {
    // Typed text: asked once per page load; without consent the server reads it with rules only (no AI).
    if (via === "manual") await askAiConsentOnce();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("reading");
    try {
      const res = await client.capture.parse({ text: input }, { signal: controller.signal });
      if (!controller.signal.aborted) toReview(res.draft, via, heard);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(errorMessage(err));
      setPhase("input");
    }
  };

  const submitText = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (t.length < 2) return;
    setError(null);
    void parse(t, "manual", null);
  };

  const transcribe = async (blob: Blob) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("listening");
    try {
      const ext = blob.type.includes("mp4") ? "m4a" : "webm";
      const { text: heard } = await client.capture.transcribe({ audio: new File([blob], `voice.${ext}`, { type: blob.type || "audio/webm" }) }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setText(heard);
      await parse(heard, "voice", heard);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(errorMessage(err));
      setPhase("input");
    }
  };

  const startRecording = async () => {
    if (mime === null) return;
    setError(null);
    // The recording goes to an AI to be transcribed: only with the member's permission.
    if (!(await ensureAiConsent())) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("JoyoArto can't use the microphone. Allow it in the browser's site settings, or type it instead.");
      return;
    }
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    discardRef.current = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      recorderRef.current = null;
      if (discardRef.current) {
        setPhase("input");
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
      if (blob.size < 1000) {
        setError("That was too short. Hold on a moment after tapping the mic, then speak.");
        setPhase("input");
        return;
      }
      void transcribe(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    setPhase("recording");
  };

  const stopRecording = (discard: boolean) => {
    discardRef.current = discard;
    recorderRef.current?.stop();
  };

  if (phase === "review") return <ReviewForm review={review} setReview={setReview} onBack={() => setPhase("input")} onDone={onDone} />;

  if (phase === "recording") {
    return (
      <div className="flex flex-col items-center gap-5 py-4 text-center" aria-live="polite">
        <div className="relative flex size-24 items-center justify-center">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-destructive/20 motion-reduce:animate-none" />
          <span className="relative flex size-20 items-center justify-center rounded-full bg-destructive text-white">
            <Mic className="size-8" aria-hidden />
          </span>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{fmtClock(elapsed)}</p>
          <p className="mt-1 text-sm text-muted-foreground">Listening… e.g. “beli kopi kenangan dua puluh lima ribu pakai gopay”. Stops at 1:00.</p>
        </div>
        <div className="flex w-full gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => stopRecording(true)}>
            <X aria-hidden /> Cancel
          </Button>
          <Button type="button" className="flex-1" onClick={() => stopRecording(false)}>
            <Square aria-hidden /> Done
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "listening" || phase === "reading" || phase === "scanning") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center" aria-live="polite">
        <Loader2 className="size-8 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
        <p className="text-sm font-semibold">{phase === "listening" ? "Turning your voice note into text…" : phase === "scanning" ? "Reading the receipt…" : "Reading it…"}</p>
        {phase === "reading" && text && <p className="max-w-sm text-sm text-muted-foreground">“{text}”</p>}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            abortRef.current?.abort();
            setPhase("input");
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submitText} className="space-y-4">
      {voiceOn && (
        <button
          type="button"
          onClick={() => void startRecording()}
          className="flex w-full items-center gap-4 rounded-3xl bg-primary-soft p-4 text-left text-primary-ink transition-colors outline-none hover:bg-primary-soft/80 focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-float">
            <Mic className="size-6" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block font-bold">Say it</span>
            <span className="block text-sm opacity-80">“Gaji masuk 16 juta”, “bayar parkir lima ribu cash”</span>
          </span>
        </button>
      )}
      <div className="flex flex-col gap-3 rounded-3xl bg-muted/60 p-4 sm:flex-row sm:items-center">
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <ReceiptText className="size-6 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">
            <span className="block font-bold">Foto struk · Photo receipt</span>
            <span className="block text-xs text-muted-foreground">Read by AI, kept as proof (for reimbursement claims too).</span>
          </span>
        </span>
        <PhotoButtons size="sm" takeLabel="Foto" chooseLabel="Galeri" onPick={(file) => void scanReceipt(file)} />
      </div>
      <div className="space-y-2">
        <label htmlFor="add-text" className="text-sm font-semibold">
          {voiceOn ? "Or type it" : "Type it"}
        </label>
        <Textarea
          id="add-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitText();
            }
          }}
          placeholder="kopi 25rb gopay"
          maxLength={500}
          className="min-h-20"
          enterKeyHint="go"
          autoComplete="off"
        />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
              {ex}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-2xl bg-destructive-soft px-4 py-3 text-sm text-destructive-ink">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setReview(emptyReview());
            setPhase("review");
          }}
        >
          Fill in by hand
        </Button>
        <Button type="submit" disabled={text.trim().length < 2}>
          Continue
        </Button>
      </div>
    </form>
  );
}

function ReviewForm({ review, setReview, onBack, onDone }: { review: Review; setReview: (r: Review) => void; onBack: () => void; onDone: () => void }) {
  const accounts = useQuery(orpc.accounts.list.queryOptions({ input: {} }));
  const categories = useQuery(orpc.categories.list.queryOptions());
  const clientRef = useRef(crypto.randomUUID());
  const save = useSaveQuickAdd(onDone);
  const list = accounts.data?.accounts ?? [];
  const accountItems = useMemo(() => accountOptions(list.filter((a) => !a.archived)), [list]);
  const catItems = useMemo(() => categoryOptions(categories.data?.categories ?? []), [categories.data]);
  const currency = list.find((a) => a.id === review.accountId)?.currency ?? "IDR";
  const set = (patch: Partial<Review>) => setReview({ ...review, ...patch });

  const parsed = useMemo(() => {
    if (!review.amountText.trim()) return null;
    try {
      return parseAmountText(review.amountText.replace(/^[+-]\s*/, ""), currency);
    } catch {
      return "invalid" as const;
    }
  }, [review.amountText, currency]);
  const ready = parsed && parsed !== "invalid" && review.description.trim() && !save.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed || parsed === "invalid") return;
    save.mutate({
      amount: (review.direction === "in" ? 1 : -1) * parsed.amount,
      description: review.description.trim(),
      ...(review.merchant.trim() ? { merchant: review.merchant.trim() } : {}),
      ...(review.note.trim() ? { note: review.note.trim() } : {}),
      ...(review.accountId ? { accountId: review.accountId } : {}),
      ...(review.category ? { category: review.category } : {}),
      occurredAt: review.date,
      capturedVia: review.via,
      clientRef: clientRef.current,
      ...(review.photo ? { attachmentIds: [review.photo.id] } : {}),
      ...(review.reimburse.on && review.direction === "out"
        ? { reimbursable: true, ...(review.reimburse.profileId ? { reimburseProfileId: review.reimburse.profileId } : {}) }
        : {}),
    });
  };

  if (accounts.isSuccess && !list.length) {
    return <p className="rounded-2xl bg-muted px-4 py-3 text-sm">Add an account first (More → Accounts), then come back.</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {review.photo && (
        <div className="flex items-start gap-3">
          <img src={review.photo.preview} alt="Receipt" className="h-24 w-18 shrink-0 rounded-xl bg-muted object-cover" />
          <p className="text-sm text-muted-foreground">
            {review.ocrNote ?? "Read from the photo. Check the total, date and merchant."} The photo is saved with the transaction.
          </p>
        </div>
      )}
      {review.heard && (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          Heard: <span className="text-foreground">“{review.heard}”</span>
        </p>
      )}
      {review.source === "rules" && !review.heard && !review.photo && <p className="text-xs text-muted-foreground">Read without AI. Check every field.</p>}
      <div className="flex items-center gap-2">
        <div className="inline-flex h-11 rounded-full bg-muted p-1 text-sm" role="group" aria-label="Direction">
          {(["out", "in"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={review.direction === d}
              className={cn(
                "rounded-full px-4 font-semibold transition-colors",
                review.direction === d ? (d === "in" ? "bg-positive-soft text-positive-ink shadow-sm" : "bg-segment text-foreground shadow-sm") : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => set({ direction: d })}
            >
              {d === "out" ? "Spent" : "Received"}
            </button>
          ))}
        </div>
        <Input
          className="h-11 min-w-0 flex-1 rounded-xl text-lg font-bold tabular-nums"
          inputMode="decimal"
          placeholder="25.000"
          value={review.amountText}
          onChange={(e) => set({ amountText: e.target.value })}
          aria-label="Amount"
          aria-invalid={parsed === "invalid" || undefined}
          autoComplete="off"
        />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground" aria-live="polite">
        {parsed === "invalid"
          ? "Can't read that amount. Try 25rb, 25.000 or 1,5jt."
          : parsed
            ? formatMoney((review.direction === "in" ? 1 : -1) * parsed.amount, currency)
            : "No amount yet: type it above."}
      </p>
      <Field label="What was it?" htmlFor="add-desc">
        <Input id="add-desc" value={review.description} maxLength={500} onChange={(e) => set({ description: e.target.value })} placeholder="Kopi Kenangan" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account">
          <Combobox value={review.accountId} onValueChange={(v) => set({ accountId: v })} aria-label="Account" none="Most used account" items={accountItems} searchPlaceholder="Search accounts" />
        </Field>
        <Field label="Category">
          <Combobox value={review.category} onValueChange={(v) => set({ category: v })} aria-label="Category" none="Rules decide" items={catItems} searchPlaceholder="Search categories" />
        </Field>
        <Field label="Date" htmlFor="add-date">
          <Input id="add-date" type="date" value={review.date} max={todayWib()} onChange={(e) => set({ date: e.target.value || todayWib() })} />
        </Field>
        <Field label="Merchant" htmlFor="add-merchant" hint="Optional">
          <Input id="add-merchant" value={review.merchant} maxLength={80} onChange={(e) => set({ merchant: e.target.value })} />
        </Field>
      </div>
      <Field label="Note" htmlFor="add-note" hint="Optional">
        <Input id="add-note" value={review.note} maxLength={500} onChange={(e) => set({ note: e.target.value })} />
      </Field>
      {review.direction === "out" && <ReimburseSwitch value={review.reimburse} onChange={(reimburse) => set({ reimburse })} />}
      <p className="text-xs text-muted-foreground">Saved as pending: the next statement import of that account confirms it.</p>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onBack}>
          <ArrowLeft aria-hidden /> Back
        </Button>
        <Button type="submit" className="flex-1" disabled={!ready}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
