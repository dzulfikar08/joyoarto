// Voice quick add: the hook the add sheet already calls. Not built yet (follow-up): record with expo-audio (needs the
// microphone permission text in app.json and docs/ios-release.md's App Privacy update), send the file as multipart
// `audio` to POST /api/capture/transcribe (oRPC capture.transcribe; the REST client handles multipart like the
// statement PDFs), then pass the text to capture.parse exactly like typed input (components/add/add-sheet.tsx `parse`).

export type VoiceNote = { uri: string; mimeType: string; durationMs: number };

/** False until voice capture ships; the add sheet hides "Say it" while it is. */
export function voiceCaptureAvailable(): boolean {
  return false;
}

/** Records up to 60 s and returns the transcript. */
export async function transcribeVoiceNote(): Promise<string> {
  throw new Error("Voice capture is not available in this version yet. Type it instead.");
}
