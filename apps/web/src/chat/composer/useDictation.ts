import { useEffect, useRef, useState } from "react";
import { type Attached, listen, transcribe, upload } from "../../data/composer.ts";
import { notify } from "../../data/notices.ts";
import { t } from "../../i18n/index.ts";
import { startVoiceMeter } from "./voiceMeter.ts";

export type DictationState = "idle" | "starting" | "recording" | "transcribing" | "unsupported";

/** How often the words heard so far are read again while recording. */
const LISTEN_MS = 2000;
/** Past this much audio the live words stop updating; the full transcript still comes at the end. */
const LISTEN_MAX_BYTES = 8_000_000;

/**
 * Records a voice note and its words for review in the composer before sending. While it records, `heard` shows the
 * words so far (only with a transcription engine on this machine); the final transcript replaces them when it stops.
 */
export function useDictation(thread: string | undefined, onAudio: (audio: Attached, text?: string) => void) {
  const [state, setState] = useState<DictationState>(() =>
    typeof MediaRecorder === "undefined" || !navigator.mediaDevices ? "unsupported" : "idle",
  );
  const [meter, setMeter] = useState({ levels: Array<number>(16).fill(0), seconds: 0 });
  const [heard, setHeard] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const stopMeter = useRef<(() => void) | undefined>(undefined);
  const stopListening = useRef<(() => void) | undefined>(undefined);
  const alive = useRef(true);
  const starting = useRef(false);
  const deliver = useRef(onAudio);
  deliver.current = onAudio;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopMeter.current?.();
      stopListening.current?.();
      const r = rec.current;
      if (r && r.state !== "inactive") {
        r.ondataavailable = null;
        r.onstop = null;
        r.stop();
      }
      for (const tr of r?.stream.getTracks() ?? []) tr.stop();
    };
  }, []);

  /** Reads the recording so far every LISTEN_MS, one request at a time; a late answer after the stop is dropped. */
  const listenTo = (chunks: Blob[], mime: string) => {
    let on = true;
    let busy = false;
    let read = 0;
    const tick = () => {
      if (!on || busy || chunks.length === read) return;
      const audio = new Blob(chunks, { type: mime });
      if (audio.size > LISTEN_MAX_BYTES) return;
      busy = true;
      read = chunks.length;
      void listen(audio).then((r) => {
        busy = false;
        if (!on || !alive.current) return;
        if (r?.live === false) stop();
        else if (r?.text) setHeard(r.text);
      });
    };
    const timer = setInterval(tick, LISTEN_MS);
    const stop = () => {
      on = false;
      clearInterval(timer);
    };
    return stop;
  };

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
      if (alive.current) {
        setHeard("");
        setState("idle");
      }
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
        stopListening.current?.();
        for (const tr of r.stream.getTracks()) tr.stop();
        if (!alive.current) return;
        setState("transcribing");
        void finish(new Blob(chunks, { type: r.mimeType || "audio/webm" }));
      };
      // A chunk each second, so the words so far can be read while it records.
      r.start(1000);
      setHeard("");
      setMeter({ levels: Array<number>(16).fill(0), seconds: 0 });
      stopMeter.current = startVoiceMeter(stream, setMeter);
      stopListening.current = listenTo(chunks, r.mimeType || "audio/webm");
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
  return { state, toggle, heard, ...meter };
}
