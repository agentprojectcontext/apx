import { useEffect, useRef, useState } from "react";
import { type Attached, transcribe, upload } from "../../data/composer.ts";
import { notify } from "../../data/notices.ts";
import { t } from "../../i18n/index.ts";
import { startVoiceMeter } from "./voiceMeter.ts";

export type DictationState = "idle" | "starting" | "recording" | "transcribing" | "unsupported";

/** Records a voice note and its words for review in the composer before sending. */
export function useDictation(thread: string, onAudio: (audio: Attached, text?: string) => void) {
  const [state, setState] = useState<DictationState>(() =>
    typeof MediaRecorder === "undefined" || !navigator.mediaDevices ? "unsupported" : "idle",
  );
  const [meter, setMeter] = useState({ levels: Array<number>(16).fill(0), seconds: 0 });
  const rec = useRef<MediaRecorder | null>(null);
  const stopMeter = useRef<(() => void) | undefined>(undefined);
  const alive = useRef(true);
  const starting = useRef(false);
  const deliver = useRef(onAudio);
  deliver.current = onAudio;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopMeter.current?.();
      const r = rec.current;
      if (r && r.state !== "inactive") {
        r.ondataavailable = null;
        r.onstop = null;
        r.stop();
      }
      for (const tr of r?.stream.getTracks() ?? []) tr.stop();
    };
  }, []);

  const finish = async (audio: Blob) => {
    try {
      const ext = audio.type.startsWith("audio/mp4") ? "m4a" : audio.type.startsWith("audio/ogg") ? "ogg" : "webm";
      const media = await upload(new File([audio], `${t("composer.voiceNote")}.${ext}`, { type: audio.type }), thread);
      const words = await transcribe(media.id, thread);
      if (alive.current) deliver.current(media, words);
    } catch (error) {
      if (alive.current)
        notify(t("composer.dictationFailed", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      if (alive.current) setState("idle");
    }
  };

  const start = async () => {
    if (starting.current) return;
    starting.current = true;
    setState("starting");
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) {
        for (const tr of stream.getTracks()) tr.stop();
        return;
      }
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      rec.current = r;
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        stopMeter.current?.();
        for (const tr of r.stream.getTracks()) tr.stop();
        if (!alive.current) return;
        setState("transcribing");
        void finish(new Blob(chunks, { type: r.mimeType || "audio/webm" }));
      };
      r.start();
      setMeter({ levels: Array<number>(16).fill(0), seconds: 0 });
      stopMeter.current = startVoiceMeter(stream, setMeter);
      setState("recording");
    } catch (error) {
      for (const tr of stream?.getTracks() ?? []) tr.stop();
      if (alive.current) {
        setState("idle");
        notify(t("composer.dictationFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      starting.current = false;
    }
  };

  const toggle = () => {
    if (state === "recording" && rec.current?.state === "recording") {
      setState("transcribing");
      rec.current.stop();
    } else if (state === "idle") void start();
  };
  return { state, toggle, ...meter };
}
