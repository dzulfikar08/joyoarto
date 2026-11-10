// Asking before any of the member's data goes to an AI (App Review 5.1.1(i) / 5.1.2(i); server:
// packages/api/src/services/ai-consent.ts). Joyo AI chat, voice notes and receipt photos call `ensureAiConsent` first;
// the server refuses them without consent anyway (PRECONDITION_FAILED `{ aiConsent: true }`). Typed quick add falls back
// to the rules parser on the server until consent is given. Withdraw: More → Data & privacy.
// Web: apps/web/src/lib/ai-consent.tsx (same wording).

import { Alert, Linking } from "react-native";

import { client, orpc } from "./orpc";
import { queryClient } from "./query";

export const AI_CONSENT_TITLE = "Allow Joyo AI to use your data?";

/** What is sent, to whom, and what happens to it. Kept in one place so the sheet and Data & privacy agree. */
export const AI_CONSENT_LINES = [
  "Joyo AI chat sends your question and the household data needed to answer it (transactions, balances, accounts, categories, budgets and plans).",
  "Voice notes send the recording; receipt scans send the photo; quick add sends the text you typed.",
  "It goes to Anthropic (the maker of Claude) and Cloudflare Workers AI, which run the AI for JoyoArto. If you added your own AI key, Joyo AI chat goes to that provider instead.",
  "They process it only to answer you and do not use it to train their models. JoyoArto never sells your data.",
  "Nothing is sent until you allow it. You can withdraw this any time in More → Data & privacy.",
] as const;

export const PRIVACY_URL = "https://arto.joyorogo.com/privasi";

/** True when the error is the server's "allow AI first" refusal. */
export function isAiConsentError(e: unknown): boolean {
  const data = (e as { data?: { aiConsent?: unknown } } | null)?.data;
  return !!data && data.aiConsent === true;
}

async function allowed(): Promise<boolean> {
  const res = await queryClient.fetchQuery({ ...orpc.account.aiConsent.queryOptions(), staleTime: 60_000 });
  return res.allowed;
}

async function setConsent(allow: boolean): Promise<void> {
  const res = await client.account.setAiConsent({ allow });
  queryClient.setQueryData(orpc.account.aiConsent.queryKey(), res);
  void queryClient.invalidateQueries({ queryKey: orpc.joyo.status.key() });
}

/** Withdraws consent (Data & privacy). */
export function withdrawAiConsent(): Promise<void> {
  return setConsent(false);
}

/** Gives consent without the dialog (the Allow button in Data & privacy, which shows the same wording). */
export function giveAiConsent(): Promise<void> {
  return setConsent(true);
}

/**
 * Resolves true when the member has allowed AI (asking now if not yet), false when they chose "Not now" or the check
 * failed. A system alert, so it shows above sheets (the add sheet is a Modal).
 */
export async function ensureAiConsent(): Promise<boolean> {
  try {
    if (await allowed()) return true;
  } catch {
    // Can't tell: ask. The server checks again anyway.
  }
  return new Promise<boolean>((resolve) => {
    const ask = () =>
      Alert.alert(AI_CONSENT_TITLE, AI_CONSENT_LINES.join("\n\n"), [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Privacy policy",
          onPress: () => {
            void Linking.openURL(PRIVACY_URL);
            // Back from the browser: ask again rather than counting it as an answer.
            setTimeout(ask, 600);
          },
        },
        {
          text: "Allow",
          onPress: () => {
            setConsent(true).then(
              () => resolve(true),
              () => {
                Alert.alert("Couldn't save that", "Check your connection and try again.");
                resolve(false);
              },
            );
          },
        },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    ask();
  });
}

let askedThisRun = false;

/** Quick add (typed): asks at most once per app run and never blocks; the server falls back to rules without consent. */
export async function askAiConsentOnce(): Promise<void> {
  if (askedThisRun) return;
  askedThisRun = true;
  await ensureAiConsent();
}
