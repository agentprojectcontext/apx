import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";

/**
 * Voice notes in the browser.
 *
 * One recorder, three states: idle → recording → a File you can attach. The
 * container is whatever this browser will actually produce — Chromium records
 * Opus in WebM, Safari records AAC in MP4 — and the extension follows it, so
 * the daemon stores the result as audio rather than as a video with no picture.
 */

interface Container {
  mime: string;
  ext: string;
}

const CONTAINERS: Container[] = [
  { mime: "audio/webm;codecs=opus", ext: ".weba" },
  { mime: "audio/webm", ext: ".weba" },
  { mime: "audio/ogg;codecs=opus", ext: ".ogg" },
  { mime: "audio/mp4", ext: ".m4a" },
];

function pickContainer(): Container {
  if (typeof MediaRecorder === "undefined") return { mime: "", ext: ".weba" };
  for (const c of CONTAINERS) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return c;
    } catch {
      /* isTypeSupported throws on some old builds; try the next one */
    }
  }
  return { mime: "", ext: ".weba" };
}

/** Whether this page is allowed to open a microphone at all. getUserMedia is
 *  gated on a secure context, so the panel served over plain http:// on a LAN
 *  address has no mic — worth saying out loud instead of failing silently. */
export function canRecord(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export interface Recording {
  file: File;
  seconds: number;
}

export interface RecorderApi {
  recording: boolean;
  /** Whole seconds elapsed, for the timer. */
  seconds: number;
  /** Rolling loudness, newest last, each 0..1 — the little waveform. */
  levels: number[];
  error: string | null;
  start: () => Promise<void>;
  /** Stop and keep what was recorded. Null when nothing usable came out. */
  stop: () => Promise<Recording | null>;
  /** Stop and throw it away. */
  cancel: () => void;
}

const BARS = 28;

export function useRecorder(): RecorderApi {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const keepRef = useRef(true);
  const startedAtRef = useRef(0);

  // Everything this hook opened, closed in one place: the tracks (so the
  // browser's recording indicator goes away), the meter loop and the timer.
  const teardown = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const start = useCallback(async () => {
    setError(null);
    if (!canRecord()) {
      setError(t("chat_ui.rec_insecure"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const container = pickContainer();
      const rec = new MediaRecorder(stream, container.mime ? { mimeType: container.mime } : undefined);
      chunksRef.current = [];
      keepRef.current = true;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      recRef.current = rec;
      rec.start(250);
      startedAtRef.current = Date.now();
      setSeconds(0);
      setLevels([]);
      setRecording(true);

      timerRef.current = setInterval(
        () => setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000)),
        250,
      );

      // The bars: RMS of the raw waveform, sampled per frame. Cosmetic, and it
      // is the only feedback that the mic is actually picking anything up.
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        let frame = 0;
        const tick = () => {
          rafRef.current = requestAnimationFrame(tick);
          // ~10 bars a second: one per 6 frames, so the strip scrolls at a
          // readable pace instead of blurring.
          if (frame++ % 6) return;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) {
            const d = (v - 128) / 128;
            sum += d * d;
          }
          const rms = Math.sqrt(sum / buf.length);
          setLevels((prev) => [...prev, Math.min(1, rms * 3)].slice(-BARS));
        };
        tick();
      } catch {
        /* no meter on this browser; the timer still says it is recording */
      }
    } catch (e) {
      teardown();
      setRecording(false);
      const name = (e as Error)?.name;
      setError(name === "NotAllowedError" ? t("chat_ui.rec_denied") : t("chat_ui.rec_failed"));
    }
  }, [teardown]);

  const finish = useCallback(
    (keep: boolean) =>
      new Promise<Recording | null>((resolve) => {
        const rec = recRef.current;
        keepRef.current = keep;
        if (!rec || rec.state === "inactive") {
          teardown();
          setRecording(false);
          return resolve(null);
        }
        const elapsed = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        rec.onstop = () => {
          const parts = chunksRef.current;
          chunksRef.current = [];
          recRef.current = null;
          const type = rec.mimeType || pickContainer().mime || "audio/webm";
          teardown();
          setRecording(false);
          setLevels([]);
          if (!keepRef.current || !parts.length) return resolve(null);
          const ext = CONTAINERS.find((c) => type.startsWith(c.mime.split(";")[0]))?.ext || ".weba";
          const blob = new Blob(parts, { type: type.split(";")[0] });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          resolve({ file: new File([blob], `voice-${stamp}${ext}`, { type: blob.type }), seconds: elapsed });
        };
        rec.stop();
      }),
    [teardown],
  );

  const stop = useCallback(() => finish(true), [finish]);
  const cancel = useCallback(() => {
    void finish(false);
  }, [finish]);

  return { recording, seconds, levels, error, start, stop, cancel };
}
