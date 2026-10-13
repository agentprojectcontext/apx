import type { Part } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { useRef, useState } from "react";
import { audioEnded } from "../../data/sounds.ts";
import { useT } from "../../i18n/index.ts";
import { useMediaUrl } from "./useMediaUrl.ts";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** A voice note, with the same controls for channel recordings and synthesized speech. */
export function AudioPart({ part }: { part: Extract<Part, { type: "audio" }> }) {
  const t = useT();
  const src = useMediaUrl(part.media_id);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const readDuration = () => {
    const length = audio.current?.duration ?? 0;
    if (Number.isFinite(length)) setDuration(length);
  };
  const toggle = async () => {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) el.pause();
    else {
      try {
        await el.play();
        setFailed(false);
      } catch {
        setFailed(true);
      }
    }
  };
  return (
    <div className="audiopart">
      {src && (
        // biome-ignore lint/a11y/useMediaCaption: spoken words appear with the message or below this player.
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onLoadedMetadata={readDuration}
          onDurationChange={readDuration}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            audioEnded();
          }}
          onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)}
          onError={() => setFailed(true)}
        />
      )}
      <div className="audiopart__player">
        <button
          type="button"
          className="audiopart__play"
          disabled={!src || failed}
          aria-label={t(playing ? "audio.pause" : "audio.play")}
          onClick={() => void toggle()}
        >
          {playing ? <Icons.Square size={14} /> : <Icons.Play size={16} />}
        </button>
        <div className="audiopart__track">
          <span className="audiopart__label">{t("composer.voiceNote")}</span>
          <input
            type="range"
            aria-label={t("audio.seek")}
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(position, duration)}
            disabled={!duration || failed}
            onChange={(e) => {
              if (audio.current) audio.current.currentTime = Number(e.currentTarget.value);
              setPosition(Number(e.currentTarget.value));
            }}
          />
        </div>
        <span className="audiopart__time">
          {clock(position)}
          {duration > 0 && ` / ${clock(duration)}`}
        </span>
      </div>
      {failed && (
        <span role="status" className="audiopart__text">
          {t("audio.unavailable")}
        </span>
      )}
      {part.transcript && <p className="audiopart__text">{part.transcript}</p>}
    </div>
  );
}
