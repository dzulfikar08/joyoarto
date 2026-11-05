// "Request support" for a statement JoyoArto cannot read yet: shows exactly what would be sent (the masked skeleton the
// server builds from the text; packages/api/src/services/statement-formats.ts), and sends it only when the member
// presses Send.

import { Button } from "@baroka/ui/components/button";
import { Sheet } from "@baroka/ui/components/sheet";
import { CircleCheck, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { client, errorMessage } from "@/lib/orpc";

type Preview = Awaited<ReturnType<typeof client.statements.formatPreview>>;

type State =
  | { step: "loading" }
  | { step: "error"; message: string }
  | { step: "ready"; preview: Preview }
  | { step: "sending"; preview: Preview }
  | { step: "sent"; preview: Preview; already: boolean };

export function FormatRequestSheet({ open, onOpenChange, text, fileName }: { open: boolean; onOpenChange: (open: boolean) => void; text: string; fileName: string }) {
  const [state, setState] = useState<State>({ step: "loading" });

  useEffect(() => {
    if (!open) return;
    let live = true;
    setState({ step: "loading" });
    client.statements
      .formatPreview({ text })
      .then((preview) => live && setState({ step: "ready", preview }))
      .catch((e: unknown) => live && setState({ step: "error", message: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [open, text]);

  const send = async (preview: Preview) => {
    setState({ step: "sending", preview });
    try {
      const res = await client.statements.requestFormat({ text, source: "pdf", platform: "web" });
      setState({ step: "sent", preview, already: res.alreadyRequested });
    } catch (e) {
      setState({ step: "error", message: errorMessage(e) });
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Request support for this statement"
      description={`We can't read ${fileName} yet. Send its layout to the JoyoArto team so we can add this bank.`}
    >
      {state.step === "loading" && (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden className="size-4 animate-spin" /> Masking the statement…
        </p>
      )}
      {state.step === "error" && <p className="py-4 text-sm text-destructive">{state.message}</p>}
      {state.step === "sent" && (
        <div role="status" className="space-y-2 py-2">
          <p className="flex items-start gap-2 font-semibold">
            <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-positive" />
            {state.already ? "You asked for this format already." : "Thanks, request sent."}
          </p>
          <p className="text-sm text-muted-foreground">
            We'll let you know when JoyoArto reads {state.preview.bank ?? "this bank"}'s statements. Until then, use CSV import or ask Claude to read the PDF.
          </p>
          <Button className="w-full" variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      )}
      {(state.step === "ready" || state.step === "sending") && <Ready preview={state.preview} sending={state.step === "sending"} onSend={() => void send(state.preview)} />}
    </Sheet>
  );
}

function Ready({ preview, sending, onSend }: { preview: Preview; sending: boolean; onSend: () => void }) {
  const blocked = !preview.available || preview.alreadyRequested || preview.requestsLeftToday === 0;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5 rounded-2xl bg-muted/60 p-3 text-sm">
        <p className="flex items-center gap-1.5 font-semibold">
          <ShieldCheck aria-hidden className="size-4 text-positive" /> What is sent
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          <li>Only the masked text below: every digit is 9, and every name, merchant and note is replaced by XXXX or Xxxx.</li>
          <li>Column labels, dates' and amounts' shapes, and bank words (Saldo, Mutasi, DB/CR) stay, so we can write a reader.</li>
          <li>Not sent: the PDF, your name, email, accounts or household. An AI writes notes for us from this masked text only.</li>
        </ul>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">
          Exactly what is sent{preview.bank ? ` (looks like ${preview.bank})` : ""}, {preview.lines} lines{preview.pages ? `, ${preview.pages} pages` : ""}
        </p>
        <pre
          tabIndex={0}
          aria-label="Masked statement text"
          className="max-h-72 overflow-auto rounded-xl border border-border bg-background p-3 font-mono text-[11px] leading-snug whitespace-pre text-foreground"
        >
          {preview.skeleton}
        </pre>
      </div>
      {!preview.available && <p className="text-sm text-muted-foreground">Requests are not available on this server.</p>}
      {preview.available && preview.alreadyRequested && <p className="text-sm text-muted-foreground">You asked for this format already. We'll let you know when it's supported.</p>}
      {preview.available && !preview.alreadyRequested && preview.requestsLeftToday === 0 && (
        <p className="text-sm text-muted-foreground">That's all the requests for today. Try again tomorrow.</p>
      )}
      <Button className="w-full" disabled={blocked || sending} onClick={onSend}>
        {sending && <LoaderCircle aria-hidden className="animate-spin" />}
        Send request
      </Button>
    </div>
  );
}
