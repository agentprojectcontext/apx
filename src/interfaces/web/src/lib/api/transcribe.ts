import { getToken } from "../http";
import { apiUrl } from "../net";

/**
 * Words for a voice note.
 *
 * A model cannot listen to an audio file — the recording rides along as the
 * attachment (so the bubble plays it back) and this is the text half of the
 * same turn, exactly as it works when a voice note arrives over Telegram.
 * Runs on whatever STT provider the daemon is configured for.
 */
export async function transcribeAudio(file: File): Promise<string> {
  const token = getToken();
  const ext = (file.name.split(".").pop() || "webm").toLowerCase();
  // `.weba` is our own spelling for audio-only WebM; the transcriber wants the
  // container's real name, which ffmpeg knows as "webm".
  const format = ext === "weba" ? "webm" : ext;
  const res = await fetch(apiUrl("/api/transcribe/chunk"), {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-audio-format": format,
      "x-language": "auto",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
  if (!res.ok || out?.ok === false) throw new Error(out?.error || `transcribe ${res.status}`);
  return String(out?.text || "").trim();
}
