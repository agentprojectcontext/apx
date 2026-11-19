import type { Services } from "../services/registry.ts";

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_BASE64 = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;

/** Only the private engine can request these operations; endpoints and keys remain in the core registry. */
export function createCallServices(deps: {
  services: Pick<Services, "callSpeech" | "callTranscribe">;
  speech?: string | undefined;
  transcription?: string | undefined;
  send: (frame: object) => void;
  failed: (operation: "speak" | "transcribe") => void;
}) {
  const pending = new Map<number, AbortController>();
  let closed = false;
  async function run(id: number, operation: "speak" | "transcribe", data: string) {
    const controller = new AbortController();
    pending.set(id, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]);
    try {
      const pcm =
        operation === "speak" ? await deps.services.callSpeech(data, deps.speech, signal) : Buffer.from(data, "base64");
      if (!pcm.length || pcm.length % 2 || pcm.length > MAX_AUDIO_BYTES) throw new Error("invalid call audio");
      const result =
        operation === "speak"
          ? { audio: pcm.toString("base64") }
          : { text: await deps.services.callTranscribe(pcm, deps.transcription, signal) };
      signal.throwIfAborted();
      if (!closed) deps.send({ type: "service_result", id, ...result });
    } catch {
      if (!closed && !controller.signal.aborted) {
        deps.send({ type: "service_result", id, error: true });
        deps.failed(operation);
      }
    } finally {
      pending.delete(id);
    }
  }
  return {
    receive(frame: { type?: string; [key: string]: unknown }): boolean {
      if (frame.type !== "service" && frame.type !== "service_cancel") return false;
      const id = frame.id;
      if (closed || typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) return true;
      if (frame.type === "service_cancel") {
        pending.get(id)?.abort();
        return true;
      }
      const operation = frame.operation;
      const data = operation === "speak" ? frame.text : frame.audio;
      const valid =
        operation === "speak"
          ? typeof data === "string" && data.length > 0 && data.length <= 4000
          : operation === "transcribe" &&
            typeof data === "string" &&
            data.length > 0 &&
            data.length <= MAX_AUDIO_BASE64 &&
            /^[A-Za-z0-9+/]+={0,2}$/.test(data);
      if (!valid || pending.has(id) || pending.size >= 4) {
        deps.send({ type: "service_result", id, error: true });
        return true;
      }
      void run(id, operation as "speak" | "transcribe", data as string);
      return true;
    },
    close() {
      closed = true;
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    },
  };
}
