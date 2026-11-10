import { Icons } from "@apx/ui";
import { useT } from "../../i18n/index.ts";
import type { DictationState } from "./useDictation.ts";

/** What the mic hears, live, beside it: the newest levels as small bars. */
export function MicWave({ levels }: { levels: number[] }) {
  return (
    <span className="composer__wave" aria-hidden="true">
      {levels.slice(-12).map((level, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed slots in a rolling signal meter.
        <span key={i} style={{ transform: `scaleY(${0.15 + level * 0.85})` }} />
      ))}
    </span>
  );
}

/** Above the field while the mic has it: recording or transcribing, for how long, and the words heard so far. */
export function VoiceRecording({
  state,
  seconds,
  heard,
}: {
  state: DictationState;
  seconds: number;
  /** The words heard so far: shown, not editable; the final transcript goes into the field. */
  heard: string;
}) {
  const t = useT();
  if (state === "idle" || state === "unsupported") return null;
  const recording = state === "recording";
  return (
    <div className={`voice-recording${recording ? " is-recording" : ""}`}>
      <span className="voice-recording__status" role="status">
        <Icons.Mic size={14} aria-hidden="true" />
        {t(recording ? "composer.recording" : state === "starting" ? "composer.micStarting" : "composer.transcribing")}
      </span>
      {recording && (
        <time className="voice-recording__time">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </time>
      )}
      {heard && (
        <p className="voice-recording__heard" aria-live="polite">
          {heard}
        </p>
      )}
    </div>
  );
}
