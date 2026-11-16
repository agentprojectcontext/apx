import { useEffect, useRef, useState } from "react";
import { type Attached, listen, transcribe, transcribePiece, upload } from "../../data/composer.ts";
import { notify } from "../../data/notices.ts";
import { t } from "../../i18n/index.ts";
import { loadVoiceMeter } from "../../lazy.ts";
import type { VoiceTap } from "./voiceCuts.ts";

export type DictationState = "idle" | "starting" | "recording" | "transcribing" | "unsupported";

/** How often the words heard so far are read again while recording. */
const LISTEN_MS = 2000;
/** Past this much audio the live words stop updating; the full transcript still comes at the end. */
const LISTEN_MAX_BYTES = 8_000_000;

/** One recording: its audio, and the words of each piece cut from it as they come back. */
type Take = {
  chunks: Blob[];
  mime: string;
  /** Absent where the browser cannot cut the audio: then all of it is transcribed when it stops. */
  tap?: VoiceTap | undefined;
  /** Per piece, in order: null while it is transcribed, undefined when that failed. */
  words: (string | null | undefined)[];
  /** One piece is transcribed at a time, in order. */
  queue: Promise<void>;
  /** The live words, and the first piece they start at. */
  live: { from: number; text: string };
};

/** How many pieces from the start have their final words. */
const settled = (take: Take) => {
  const i = take.words.indexOf(null);
  return i < 0 ? take.words.length : i;
};

const said = (words: (string | null | undefined)[]) => words.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

/**
 * Dictation: what the microphone hears becomes words in the composer, for review before sending; the recording itself
 * is not attached, unless it could not be turned into words: then it is, so what the person said is not lost.
 * The recording is cut at pauses as it goes and each piece is transcribed while the person keeps talking, so stopping
 * leaves only the last seconds to do. While it records, `heard` shows the final words of the pieces done and, after
 * them, the live words of the rest (only with a transcription engine on this machine).
 */
export function useDictation(
  thread: string | undefined,
  onWords: (text: string) => void,
  onKept: (audio: Attached) => void,
) {
  const [state, setState] = useState<DictationState>(() =>
    typeof MediaRecorder === "undefined" || !navigator.mediaDevices ? "unsupported" : "idle",
  );
  const [meter, setMeter] = useState({ levels: Array<number>(16).fill(0), seconds: 0 });
  const [heard, setHeard] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const current = useRef<Take | undefined>(undefined);
  const stopMeter = useRef<(() => void) | undefined>(undefined);
  const listening = useRef<{ stop(): void; poke(): void } | undefined>(undefined);
  const alive = useRef(true);
  const starting = useRef(false);
  const deliver = useRef(onWords);
  deliver.current = onWords;
  const keep = useRef(onKept);
  keep.current = onKept;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopMeter.current?.();
      listening.current?.stop();
      current.current?.tap?.end();
      const r = rec.current;
      if (r && r.state !== "inactive") {
        r.ondataavailable = null;
        r.onstop = null;
        r.stop();
      }
      for (const tr of r?.stream.getTracks() ?? []) tr.stop();
    };
  }, []);

  const show = (take: Take) => {
    if (!alive.current || current.current !== take) return;
    const done = settled(take);
    setHeard(said([...take.words.slice(0, done), take.live.from === done ? take.live.text : ""]));
  };

  /** A piece cut from the recording: queued for its final words (a silent one has none). */
  const piece = (take: Take, index: number, audio: Blob | undefined) => {
    take.words[index] = audio ? null : "";
    if (!audio) return;
    take.queue = take.queue.then(async () => {
      take.words[index] = await transcribePiece(audio, thread);
      show(take);
      listening.current?.poke();
    });
  };

  /** Reads what has no final words yet every LISTEN_MS, one request at a time; a late answer after the stop is dropped. */
  const listenTo = (take: Take) => {
    let on = true;
    let busy = false;
    let read = 0;
    const next = () => {
      if (take.tap) {
        const from = settled(take);
        const audio = take.tap.since(from);
        return audio ? { audio, from } : undefined;
      }
      if (take.chunks.length === read) return undefined;
      const audio = new Blob(take.chunks, { type: take.mime });
      if (audio.size > LISTEN_MAX_BYTES) return undefined;
      read = take.chunks.length;
      return { audio, from: 0 };
    };
    const tick = () => {
      if (!on || busy) return;
      const got = next();
      if (!got) return;
      busy = true;
      void listen(got.audio).then((r) => {
        busy = false;
        if (!on || !alive.current) return;
        if (r?.live === false) stop();
        else if (r) {
          take.live = { from: got.from, text: r.text };
          show(take);
        }
      });
    };
    const timer = setInterval(tick, LISTEN_MS);
    const stop = () => {
      on = false;
      clearInterval(timer);
    };
    return { stop, poke: tick };
  };

  const finish = async (take: Take) => {
    const audio = new Blob(take.chunks, { type: take.mime });
    try {
      await take.queue;
      if (!alive.current) return;
      // Every piece came back with words: those are the words. Otherwise (a piece failed, or a recording too short
      // to count as speech) the whole recording goes again, as one.
      const pieces = take.tap && !take.words.includes(undefined) ? said(take.words) : "";
      if (pieces) {
        deliver.current(pieces);
        return;
      }
      const words = await transcribe(audio, thread);
      if (!alive.current) return;
      if (words) deliver.current(words);
      else if (words === undefined) {
        const ext = audio.type.startsWith("audio/mp4") ? "m4a" : audio.type.startsWith("audio/ogg") ? "ogg" : "webm";
        const file = new File([audio], `${t("composer.voiceNote")}.${ext}`, { type: audio.type });
        keep.current(await upload(file, thread));
      }
    } catch (error) {
      if (alive.current)
        notify(t("composer.dictationFailed", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      if (current.current === take) current.current = undefined;
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
      // The level meter loads while the browser asks for the microphone.
      const meter = loadVoiceMeter();
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { startVoiceMeter, startVoiceTap } = await meter;
      if (!alive.current) {
        for (const tr of stream.getTracks()) tr.stop();
        return;
      }
      const r = new MediaRecorder(stream);
      const take: Take = {
        chunks: [],
        mime: r.mimeType || "audio/webm",
        words: [],
        queue: Promise.resolve(),
        live: { from: 0, text: "" },
      };
      try {
        take.tap = startVoiceTap(stream, (index, audio) => piece(take, index, audio));
      } catch {
        take.tap = undefined;
      }
      rec.current = r;
      current.current = take;
      r.ondataavailable = (e) => {
        if (e.data.size) take.chunks.push(e.data);
      };
      r.onstop = () => {
        stopMeter.current?.();
        listening.current?.stop();
        if (take.tap) {
          const last = take.tap.end();
          piece(take, last.index, last.audio);
        }
        for (const tr of r.stream.getTracks()) tr.stop();
        if (!alive.current) return;
        setState("transcribing");
        void finish(take);
      };
      // A chunk each second, so the words so far can be read while it records when the audio cannot be cut.
      r.start(1000);
      setHeard("");
      setMeter({ levels: Array<number>(16).fill(0), seconds: 0 });
      stopMeter.current = startVoiceMeter(stream, setMeter);
      listening.current = listenTo(take);
      setState("recording");
    } catch (error) {
      for (const tr of stream?.getTracks() ?? []) tr.stop();
      current.current?.tap?.end();
      current.current = undefined;
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
