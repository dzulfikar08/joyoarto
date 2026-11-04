// Voice quick add as a state machine: ask for the microphone, record up to 60 s, send the note to the server's
// capture.transcribe (Workers AI Whisper; the audio is not stored), then hand the text to the add sheet's
// parse → review → save flow. Pure, unit-tested; the expo-audio glue is src/lib/voice.ts.

/** Same ceiling as the web's add sheet and the server's MAX_AUDIO_BYTES (about 60 s of AAC). */
export const MAX_RECORD_MS = 60_000;
/** Shorter than this is a mis-tap, not a voice note (the web says the same). */
export const MIN_RECORD_MS = 700;

export type VoiceState =
  | { phase: "idle"; error: string | null }
  /** The system permission prompt is up. */
  | { phase: "asking" }
  /** The member said no. `canAskAgain` false: only the system settings can turn it on now. */
  | { phase: "denied"; canAskAgain: boolean }
  | { phase: "recording"; elapsedMs: number }
  /** Recording finished, waiting for the file. */
  | { phase: "stopping"; elapsedMs: number }
  /** Uploaded, waiting for the transcript. */
  | { phase: "sending" }
  /** Done: the add sheet parses this text. */
  | { phase: "heard"; text: string };

export type VoiceEvent =
  | { type: "start" }
  | { type: "permission"; granted: boolean; canAskAgain: boolean }
  | { type: "tick"; elapsedMs: number }
  | { type: "stop" }
  | { type: "recorded"; durationMs: number; uri: string | null }
  | { type: "transcribed"; text: string }
  | { type: "failed"; message: string }
  | { type: "cancel" }
  | { type: "reset" };

export const VOICE_IDLE: VoiceState = { phase: "idle", error: null };

export const VOICE_MESSAGES = {
  tooShort: "That was too short. Hold on a moment after tapping the mic, then speak.",
  nothingHeard: "Couldn't hear anything. Try again closer to the mic, or type it.",
  recordFailed: "The recording didn't work. Try again, or type it.",
  /** Shown in the app before and after the system prompt (Android has no usage text of its own). */
  why: "JoyoArto uses the microphone only while you record a voice note for a transaction. / JoyoArto memakai mikrofon hanya saat kamu merekam catatan suara untuk transaksi.",
  denied: "Microphone access is off. Allow it to say a transaction, or type it instead. / Akses mikrofon mati. Izinkan untuk mencatat lewat suara, atau ketik saja.",
  deniedSettings:
    "Microphone access is off for JoyoArto. Turn it on in the phone's Settings to say a transaction, or type it instead. / Akses mikrofon untuk JoyoArto mati. Nyalakan di Pengaturan HP, atau ketik saja.",
} as const;

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  if (event.type === "reset") return VOICE_IDLE;
  if (event.type === "cancel") return state.phase === "heard" ? state : VOICE_IDLE;
  if (event.type === "failed") return state.phase === "idle" || state.phase === "heard" ? state : { phase: "idle", error: event.message };
  switch (state.phase) {
    case "idle":
    case "denied":
      return event.type === "start" ? { phase: "asking" } : state;
    case "asking":
      if (event.type !== "permission") return state;
      return event.granted ? { phase: "recording", elapsedMs: 0 } : { phase: "denied", canAskAgain: event.canAskAgain };
    case "recording":
      if (event.type === "tick") {
        const elapsedMs = Math.max(state.elapsedMs, event.elapsedMs);
        return elapsedMs >= MAX_RECORD_MS ? { phase: "stopping", elapsedMs: MAX_RECORD_MS } : { phase: "recording", elapsedMs };
      }
      if (event.type === "stop") return { phase: "stopping", elapsedMs: state.elapsedMs };
      // The recorder can end on its own (a call comes in): treat it like a stop.
      if (event.type === "recorded") return voiceReducer({ phase: "stopping", elapsedMs: state.elapsedMs }, event);
      return state;
    case "stopping":
      if (event.type !== "recorded") return state;
      if (!event.uri) return { phase: "idle", error: VOICE_MESSAGES.recordFailed };
      if (Math.max(event.durationMs, state.elapsedMs) < MIN_RECORD_MS) return { phase: "idle", error: VOICE_MESSAGES.tooShort };
      return { phase: "sending" };
    case "sending": {
      if (event.type !== "transcribed") return state;
      const text = event.text.trim();
      return text.length < 2 ? { phase: "idle", error: VOICE_MESSAGES.nothingHeard } : { phase: "heard", text };
    }
    case "heard":
      // Another note after this one was read (or failed to parse).
      return event.type === "start" ? { phase: "asking" } : state;
  }
}

/** True when the recorder should stop now (the 60 s ceiling). */
export const shouldAutoStop = (s: VoiceState) => s.phase === "stopping" && s.elapsedMs >= MAX_RECORD_MS;

/** "0:07 / 1:00" for the recording screen. */
export function clockLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function remainingMs(s: VoiceState): number {
  return s.phase === "recording" ? Math.max(0, MAX_RECORD_MS - s.elapsedMs) : 0;
}

/** The multipart part for capture.transcribe. expo-audio writes AAC in an MPEG-4 container on both platforms. */
export function voiceUpload(uri: string): { uri: string; name: string; type: string } {
  const ext = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(uri)?.[1]?.toLowerCase() ?? "m4a";
  const type = ext === "wav" ? "audio/wav" : ext === "mp3" ? "audio/mpeg" : ext === "webm" ? "audio/webm" : ext === "3gp" ? "audio/3gpp" : "audio/mp4";
  return { uri, name: `voice.${ext}`, type };
}

/** What the add sheet shows under the mic for the current state (null = nothing). */
export function voiceNotice(s: VoiceState): string | null {
  if (s.phase === "idle") return s.error;
  if (s.phase === "denied") return s.canAskAgain ? VOICE_MESSAGES.denied : VOICE_MESSAGES.deniedSettings;
  return null;
}
