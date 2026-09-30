import { Mic, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../cx";

export interface VoiceNoteProps {
  /** Audio URL. Without it the note renders as a static placeholder. */
  src?: string;
  /** Total length in seconds (shown before the audio loads). */
  duration: number;
  /** Header label ("Voice note"). */
  label?: string;
  /** File size or other detail after the label ("42 KB"). */
  detail?: string;
  /** Initial played fraction 0–1 (static previews). */
  progress?: number;
  className?: string;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Voice message card with play/pause and a scrubber — for voice notes from Telegram/WhatsApp or TTS replies. */
export function VoiceNote({ src, duration, label = "Voice note", detail, progress = 0, className }: VoiceNoteProps) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(progress * duration);
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const onTime = () => setT(a.currentTime);
    const onEnd = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, [src]);
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (playing) a.pause();
    else void a.play();
    setPlaying(!playing);
  };
  const pct = Math.min(100, (t / Math.max(duration, 0.001)) * 100);
  return (
    <div className={cx("apx-voice", className)}>
      <div className="apx-voice__head">
        <Mic size={12} />
        <span>{label}</span>
        <span>· {fmt(duration)}</span>
        {detail && <span>· {detail}</span>}
      </div>
      <div className="apx-voice__player">
        <button
          type="button"
          className="apx-voice__play"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          disabled={!src}
        >
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
        <div className="apx-voice__track">
          <div className="apx-voice__fill" style={{ width: `${pct}%` }} />
          <div className="apx-voice__knob" style={{ left: `${pct}%` }} />
        </div>
        <span className="apx-voice__time">
          {fmt(t)} / {fmt(duration)}
        </span>
      </div>
      {src && <audio ref={audio} src={src} preload="metadata" />}
    </div>
  );
}
