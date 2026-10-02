import { Bot } from "lucide-react";
import { type CSSProperties, useId } from "react";
import { cx } from "../cx";
import { ENGINE_MARKS } from "../engine-marks";

export type EngineBrand = keyof typeof ENGINE_MARKS;

/**
 * The brand behind an engine or provider id: `claude`, `claude-code`, `anthropic` → claude; `codex` → codex;
 * `gemini`, `acp:gemini`, `google` → gemini; `openai` → openai; `ollama` → ollama. Anything else has no mark.
 */
export function engineBrand(id: string | undefined): EngineBrand | undefined {
  const k = (id ?? "").toLowerCase();
  if (k.includes("claude") || k.includes("anthropic")) return "claude";
  if (k.includes("codex")) return "codex";
  if (k.includes("gemini") || k === "google") return "gemini";
  if (k.includes("openai") || k.startsWith("gpt")) return "openai";
  if (k.includes("ollama")) return "ollama";
  return undefined;
}

export interface EngineIconProps {
  /** Engine or provider id (`claude`, `codex`, `acp:gemini`, `openai`…). Unknown ids show a neutral bot. */
  engine: string | undefined;
  /** Pixel size (default 16). */
  size?: number;
  /** App-icon look: the mark on its round tile, for sidebars and headers. Default: the bare mark. */
  tile?: boolean;
  /** Accessible name; omit when the icon sits next to visible text. */
  label?: string;
  className?: string;
}

/** The official mark of Claude Code, Codex, Gemini, OpenAI or Ollama, so each app reads at a glance. */
export function EngineIcon({ engine, size = 16, tile = false, label, className }: EngineIconProps) {
  const brand = engineBrand(engine);
  const gid = useId().replace(/:/g, "");
  const box: CSSProperties = { width: size, height: size };
  const a11y = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  const cls = cx("apx-engine", tile && "apx-engine--tile", brand && `apx-engine--${brand}`, className);
  if (!brand)
    return (
      <span className={cx(cls, "apx-engine--none")} style={box} {...a11y}>
        <Bot size={Math.round(size * (tile ? 0.6 : 0.9))} />
      </span>
    );
  return (
    <span className={cls} style={box} {...a11y}>
      <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
        <Mark brand={brand} tile={tile} gid={gid} />
      </svg>
    </span>
  );
}

function Mark({ brand, tile, gid }: { brand: EngineBrand; tile: boolean; gid: string }) {
  switch (brand) {
    case "claude": {
      const m = ENGINE_MARKS.claude;
      // The tile is Claude's orange with the spark in white; bare, the spark keeps its orange.
      return tile ? (
        <>
          <circle cx="12" cy="12" r="12" fill={m.color} />
          <path d={m.d} fill="#fff" transform="translate(4.2 4.2) scale(0.65)" />
        </>
      ) : (
        <path d={m.d} fill={m.color} />
      );
    }
    case "codex": {
      const m = ENGINE_MARKS.codex;
      return (
        <>
          <defs>
            <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="12" x2="12" y1="3" y2="21">
              <stop stopColor={m.from} />
              <stop offset=".5" stopColor={m.via} />
              <stop offset="1" stopColor={m.to} />
            </linearGradient>
          </defs>
          {tile ? <circle cx="12" cy="12" r="12" fill="#fff" /> : <path d={m.tile} fill="#fff" />}
          <path d={m.d} fill={`url(#${gid})`} />
        </>
      );
    }
    case "gemini": {
      const m = ENGINE_MARKS.gemini;
      const star = (
        <>
          <defs>
            <linearGradient id={`${gid}g`} gradientUnits="userSpaceOnUse" x1="7" x2="11" y1="15.5" y2="12">
              <stop stopColor="#08B962" />
              <stop offset="1" stopColor="#08B962" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${gid}r`} gradientUnits="userSpaceOnUse" x1="8" x2="11.5" y1="5.5" y2="11">
              <stop stopColor="#F94543" />
              <stop offset="1" stopColor="#F94543" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${gid}y`} gradientUnits="userSpaceOnUse" x1="3.5" x2="17.5" y1="13.5" y2="12">
              <stop stopColor="#FABC12" />
              <stop offset=".46" stopColor="#FABC12" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={m.d} fill={m.color} />
          <path d={m.d} fill={`url(#${gid}g)`} />
          <path d={m.d} fill={`url(#${gid}r)`} />
          <path d={m.d} fill={`url(#${gid}y)`} />
        </>
      );
      return tile ? (
        <>
          <circle cx="12" cy="12" r="12" fill="#fff" />
          <g transform="translate(4.2 4.2) scale(0.65)">{star}</g>
        </>
      ) : (
        star
      );
    }
    default: {
      // OpenAI and Ollama are one-colour marks: ink on a light tile, or the current text colour bare.
      const d = ENGINE_MARKS[brand].d;
      return tile ? (
        <>
          <circle cx="12" cy="12" r="12" fill="#fff" />
          <path d={d} fill="#0d0d0d" fillRule="evenodd" transform="translate(4.8 4.8) scale(0.6)" />
        </>
      ) : (
        <path d={d} fill="currentColor" fillRule="evenodd" />
      );
    }
  }
}
