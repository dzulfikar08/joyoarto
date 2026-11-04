import { receiveEmail } from "@baroka/api/services/inbound";

import { env } from "./env";
import { getDb } from "./services";

/** Cloudflare Email Routing allows 25 MB per message; statements are far smaller. */
const MAX_EMAIL_BYTES = 25 * 1024 * 1024;

/**
 * Email Routing hands mail for `import+<token>@<IMPORT_EMAIL_DOMAIN>` to this handler (a route or catch-all with the
 * action "Send to a Worker": baroka). Unknown addresses bounce; the rest is logged in inbound_email, and a member's
 * statement PDFs are imported and answered with a summary (packages/api/src/services/inbound.ts).
 */
export async function handleEmail(message: ForwardableEmailMessage): Promise<void> {
  const domain = env.IMPORT_EMAIL_DOMAIN?.trim().toLowerCase() || null;
  if (message.rawSize > MAX_EMAIL_BYTES) {
    message.setReject("Message too large");
    return;
  }
  let outcome: Awaited<ReturnType<typeof receiveEmail>>;
  try {
    outcome = await receiveEmail(getDb(), { from: message.from, to: message.to, raw: message.raw }, { domain, appUrl: env.APP_URL ?? null });
  } catch (error) {
    console.error("email import failed", error);
    message.setReject("JoyoArto could not process this email. Upload the PDF in the app instead.");
    return;
  }
  if (outcome.action === "reject") {
    message.setReject(outcome.reason);
    return;
  }
  if (outcome.action === "reply") {
    try {
      // From the import address itself (the address this mail was sent to); Cloudflare sets In-Reply-To/References.
      await message.reply({ from: { name: "JoyoArto", email: message.to }, subject: outcome.subject, text: outcome.text, headers: { "Auto-Submitted": "auto-replied" } });
    } catch (error) {
      // The import already happened and is in the log; a failed reply (e.g. the sender's DMARC) must not undo that.
      console.error("email import reply failed", error);
    }
  }
}
