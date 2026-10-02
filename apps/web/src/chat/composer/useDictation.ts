import { useEffect, useRef, useState } from "react";
import { transcribe } from "../../data/composer.ts";

export type DictationState = "idle" | "recording" | "transcribing" | "unsupported";

/** The mic: records until pressed again, then hands the words to `onText` (nothing is sent). */
export function useDictation(thread: string, onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>(() =>
    typeof MediaRecorder === "undefined" || !navigator.mediaDevices ? "unsupported" : "idle",
  );
  const rec = useRef<MediaRecorder | null>(null);
  // Cleared on unmount: a mic granted after leaving the chat is closed at once.
  const alive = useRef(true);
  const deliver = useRef(onText);
  deliver.current = onText;
  // Leaving the chat stops the mic (and its light) without transcribing.
  useEffect(
    () => () => {
      alive.current = false;
      const r = rec.current;
      if (r && r.state !== "inactive") {
        r.ondataavailable = null;
        r.onstop = null;
        r.stop();
      }
      for (const tr of r?.stream.getTracks() ?? []) tr.stop();
    },
    [],
  );

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("unsupported");
      return;
    }
    if (!alive.current) {
      for (const tr of stream.getTracks()) tr.stop();
      return;
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    r.ondataavailable = (e) => chunks.push(e.data);
    r.onstop = async () => {
      for (const tr of stream.getTracks()) tr.stop();
      setState("transcribing");
      const text = await transcribe(new Blob(chunks, { type: r.mimeType || "audio/webm" }), thread);
      if (!alive.current) return;
      setState("idle");
      if (text) deliver.current(text);
    };
    rec.current = r;
    r.start();
    setState("recording");
  };

  const toggle = () => {
    if (state === "recording") rec.current?.stop();
    else if (state === "idle") void start();
  };
  return { state, toggle };
}
