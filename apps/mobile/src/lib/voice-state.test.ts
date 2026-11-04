import { describe, expect, test } from "bun:test";

import {
  clockLabel,
  MAX_RECORD_MS,
  remainingMs,
  shouldAutoStop,
  VOICE_IDLE,
  VOICE_MESSAGES,
  voiceNotice,
  voiceReducer,
  voiceUpload,
  type VoiceEvent,
  type VoiceState,
} from "./voice-state";

const run = (events: VoiceEvent[], from: VoiceState = VOICE_IDLE) => events.reduce(voiceReducer, from);

describe("voice quick add state machine", () => {
  test("happy path: ask, record, stop, send, heard", () => {
    const s = run([
      { type: "start" },
      { type: "permission", granted: true, canAskAgain: true },
      { type: "tick", elapsedMs: 1200 },
      { type: "tick", elapsedMs: 2400 },
      { type: "stop" },
    ]);
    expect(s).toEqual({ phase: "stopping", elapsedMs: 2400 });
    const sent = voiceReducer(s, { type: "recorded", durationMs: 2500, uri: "file:///cache/rec.m4a" });
    expect(sent).toEqual({ phase: "sending" });
    expect(voiceReducer(sent, { type: "transcribed", text: "  kopi dua puluh lima ribu gopay " })).toEqual({ phase: "heard", text: "kopi dua puluh lima ribu gopay" });
  });

  test("denied permission, then asking again", () => {
    const denied = run([{ type: "start" }, { type: "permission", granted: false, canAskAgain: true }]);
    expect(denied).toEqual({ phase: "denied", canAskAgain: true });
    expect(voiceNotice(denied)).toBe(VOICE_MESSAGES.denied);
    expect(voiceNotice({ phase: "denied", canAskAgain: false })).toBe(VOICE_MESSAGES.deniedSettings);
    expect(voiceReducer(denied, { type: "start" })).toEqual({ phase: "asking" });
  });

  test("stops by itself at 60 seconds", () => {
    const s = run([{ type: "start" }, { type: "permission", granted: true, canAskAgain: true }, { type: "tick", elapsedMs: MAX_RECORD_MS + 300 }]);
    expect(s).toEqual({ phase: "stopping", elapsedMs: MAX_RECORD_MS });
    expect(shouldAutoStop(s)).toBe(true);
    expect(shouldAutoStop({ phase: "stopping", elapsedMs: 5000 })).toBe(false);
  });

  test("ticks never go backwards", () => {
    const s = run([{ type: "tick", elapsedMs: 500 }], { phase: "recording", elapsedMs: 3000 });
    expect(s).toEqual({ phase: "recording", elapsedMs: 3000 });
    expect(remainingMs(s)).toBe(57_000);
  });

  test("too short, no file, nothing heard", () => {
    expect(voiceReducer({ phase: "stopping", elapsedMs: 300 }, { type: "recorded", durationMs: 300, uri: "file:///a.m4a" })).toEqual({ phase: "idle", error: VOICE_MESSAGES.tooShort });
    expect(voiceReducer({ phase: "stopping", elapsedMs: 3000 }, { type: "recorded", durationMs: 3000, uri: null })).toEqual({ phase: "idle", error: VOICE_MESSAGES.recordFailed });
    expect(voiceReducer({ phase: "sending" }, { type: "transcribed", text: " ." })).toEqual({ phase: "idle", error: VOICE_MESSAGES.nothingHeard });
  });

  test("the recorder ending on its own counts as a stop", () => {
    expect(voiceReducer({ phase: "recording", elapsedMs: 4000 }, { type: "recorded", durationMs: 4100, uri: "file:///a.m4a" })).toEqual({ phase: "sending" });
  });

  test("server errors and cancel go back to idle; heard stays heard", () => {
    expect(voiceReducer({ phase: "sending" }, { type: "failed", message: "That's all the voice notes for today. Type it instead." })).toEqual({
      phase: "idle",
      error: "That's all the voice notes for today. Type it instead.",
    });
    expect(voiceReducer({ phase: "recording", elapsedMs: 9000 }, { type: "cancel" })).toEqual(VOICE_IDLE);
    expect(voiceReducer({ phase: "heard", text: "gaji" }, { type: "cancel" })).toEqual({ phase: "heard", text: "gaji" });
    expect(voiceReducer({ phase: "heard", text: "gaji" }, { type: "reset" })).toEqual(VOICE_IDLE);
    expect(voiceReducer({ phase: "heard", text: "gaji" }, { type: "start" })).toEqual({ phase: "asking" });
  });

  test("events that don't fit the phase are ignored", () => {
    expect(voiceReducer(VOICE_IDLE, { type: "stop" })).toBe(VOICE_IDLE);
    expect(voiceReducer({ phase: "asking" }, { type: "tick", elapsedMs: 100 })).toEqual({ phase: "asking" });
    expect(voiceReducer({ phase: "sending" }, { type: "start" })).toEqual({ phase: "sending" });
  });
});

test("clock and upload part", () => {
  expect(clockLabel(0)).toBe("0:00");
  expect(clockLabel(7_900)).toBe("0:07");
  expect(clockLabel(60_000)).toBe("1:00");
  expect(voiceUpload("file:///data/cache/ExpoAudio/recording-1.m4a")).toEqual({ uri: "file:///data/cache/ExpoAudio/recording-1.m4a", name: "voice.m4a", type: "audio/mp4" });
  expect(voiceUpload("file:///x/rec.wav").type).toBe("audio/wav");
  expect(voiceUpload("file:///x/rec").name).toBe("voice.m4a");
});
