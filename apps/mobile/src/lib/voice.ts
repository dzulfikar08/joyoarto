// Voice quick add on the device: expo-audio records up to 60 s (AAC in .m4a, mono, 64 kbps: about 0,5 MB a minute,
// well under the server's 3 MB), the REST client sends it as multipart `audio` to POST /api/capture/transcribe
// (Workers AI Whisper; nothing is stored), and the add sheet passes the text to capture.parse like typed input.
// The state machine is pure in ./voice-state.ts; this file is the React Native glue.

import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import { File } from "expo-file-system";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { getApi } from "./auth";
import { errorMessage } from "./errors";
import { storeSafe } from "./platform";
import { MAX_RECORD_MS, VOICE_IDLE, voiceReducer, voiceUpload, type VoiceEvent, type VoiceState } from "./voice-state";

export type { VoiceState };

const VOICE_RECORDING: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 64_000,
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
  web: { mimeType: "audio/webm", bitsPerSecond: 64_000 },
};

/** Deletes the recording on the phone: the note is only kept until it is sent. */
function discard(uri: string | null | undefined) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

/**
 * The add sheet's mic. `start()` asks for the microphone (the system prompt shows the app.json usage text on iOS),
 * records, and stops by itself at 60 s; `stop()` sends the note; `cancel()` throws it away. When the server has
 * the text, `onHeard` gets it once.
 */
export function useVoiceCapture(onHeard: (text: string) => void) {
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const [state, rawDispatch] = useReducer(voiceReducer, VOICE_IDLE);
  const stateRef = useRef<VoiceState>(state);
  const abortRef = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  const onHeardRef = useRef(onHeard);
  onHeardRef.current = onHeard;

  /** The latest state (TypeScript would narrow a plain ref read across the awaits above). */
  const current = (): VoiceState => stateRef.current;

  const dispatch = useCallback((e: VoiceEvent) => {
    stateRef.current = voiceReducer(stateRef.current, e);
    rawDispatch(e);
  }, []);

  const release = useCallback(() => {
    void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, []);

  const send = useCallback(
    async (uri: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const api = await getApi();
        if (!api) throw new Error("You were signed out. Sign in again.");
        const { text } = await api.transcribe(voiceUpload(uri), controller.signal);
        if (controller.signal.aborted) return;
        dispatch({ type: "transcribed", text });
        const s = current();
        if (s.phase === "heard") onHeardRef.current(s.text);
      } catch (e) {
        if (!controller.signal.aborted) dispatch({ type: "failed", message: errorMessage(e, { storeSafe }) });
      } finally {
        abortRef.current = null;
        discard(uri);
      }
    },
    [dispatch],
  );

  const finish = useCallback(async () => {
    if (stateRef.current.phase === "recording") dispatch({ type: "stop" });
    if (stateRef.current.phase !== "stopping") return;
    try {
      await recorder.stop();
    } catch {
      // stop() on a recorder that already ended; the uri still tells
    }
    release();
    const uri = recorder.uri;
    dispatch({ type: "recorded", durationMs: Date.now() - startedAt.current, uri });
    if (current().phase === "sending" && uri) void send(uri);
    else discard(uri);
  }, [dispatch, recorder, release, send]);

  const start = useCallback(async () => {
    const p = stateRef.current.phase;
    if (p !== "idle" && p !== "denied" && p !== "heard") return;
    dispatch({ type: "start" });
    try {
      const perm = await requestRecordingPermissionsAsync();
      dispatch({ type: "permission", granted: perm.granted, canAskAgain: perm.canAskAgain });
      if (!perm.granted) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: MAX_RECORD_MS / 1000 });
      startedAt.current = Date.now();
    } catch (e) {
      release();
      dispatch({ type: "failed", message: errorMessage(e) });
    }
  }, [dispatch, recorder, release]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    const wasRecording = stateRef.current.phase === "recording" || stateRef.current.phase === "stopping";
    dispatch({ type: "cancel" });
    if (wasRecording) {
      void recorder
        .stop()
        .catch(() => undefined)
        .finally(() => {
          release();
          discard(recorder.uri);
        });
    }
  }, [dispatch, recorder, release]);

  // The clock, and the 60 s ceiling (record({ forDuration }) also stops natively; this keeps the UI in step).
  useEffect(() => {
    if (state.phase !== "recording") return;
    const timer = setInterval(() => {
      dispatch({ type: "tick", elapsedMs: Date.now() - startedAt.current });
      if (stateRef.current.phase === "stopping") void finish();
    }, 250);
    return () => clearInterval(timer);
  }, [state.phase, dispatch, finish]);

  // Closing the sheet mid-recording throws the note away.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (stateRef.current.phase === "recording") {
        void recorder
          .stop()
          .catch(() => undefined)
          .finally(() => {
            discard(recorder.uri);
            void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
          });
      }
    },
    [recorder],
  );

  return { state, start: () => void start(), stop: () => void finish(), cancel, reset: () => dispatch({ type: "reset" }) };
}
