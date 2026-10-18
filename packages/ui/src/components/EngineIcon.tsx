import { Bot } from "lucide-react";
import { type CSSProperties, useId, useSyncExternalStore } from "react";
import type { AcpBrand, AcpMark } from "../acp-marks";
import { cx } from "../cx";
import { ENGINE_MARKS } from "../engine-marks";
import type { ProviderBrand } from "../provider-marks";

export type EngineBrand = keyof typeof ENGINE_MARKS | AcpBrand | ProviderBrand;

/** A coding agent's engine id ("acp:qwen", "qwen-code", "antigravity") → its mark. */
const ACP_IDS: Record<string, AcpBrand> = {
  opencode: "opencode",
  "opencode-zen": "opencode",
  zen: "opencode",
  qwen: "qwen",
  "qwen-code": "qwen",
  cursor: "cursor",
  "cursor-agent": "cursor",
  copilot: "copilot",
  "github-copilot": "copilot",
  goose: "goose",
  kimi: "kimi",
  auggie: "auggie",
  augment: "auggie",
  droid: "droid",
  "factory-droid": "droid",
  vibe: "vibe",
  "mistral-vibe": "vibe",
  qoder: "qoder",
  grok: "grok",
  devin: "devin",
  amp: "amp",
  kilo: "kilo",
  poolside: "poolside",
  antigravity: "antigravity",
  agy: "antigravity",
  aider: "aider",
};

/** Model APIs by the words in their id or a model's name. */
const PROVIDER_WORDS: Array<[string, ProviderBrand]> = [
  ["openrouter", "openrouter"],
  ["groq", "groq"],
  ["cerebras", "cerebras"],
  ["deepseek", "deepseek"],
  ["mistral", "mistral"],
  ["lmstudio", "lmstudio"],
  ["lm-studio", "lmstudio"],
];

/**
 * The brand behind an engine, provider or model id: `claude`, `claude-code` → claude; `anthropic` → anthropic;
 * `codex`, `chatgpt` (the plan, signed in as Codex) → codex; `gemini`, `google` → gemini; `openai`, `gpt-…` → openai;
 * `ollama`, `groq`, `openrouter`… → their own mark; an ACP agent (`acp:opencode`, `acp:qwen`…) or OpenCode Zen → its
 * mark. Anything else has no mark.
 */
export function engineBrand(id: string | undefined): EngineBrand | undefined {
  const k = (id ?? "").toLowerCase();
  const acp = ACP_IDS[k.replace(/^acp:/, "").split("/")[0] ?? ""];
  if (acp) return acp;
  if (k.includes("anthropic")) return "anthropic";
  if (k.includes("claude")) return "claude";
  if (k.includes("codex") || k === "chatgpt") return "codex";
  if (k.includes("gemini") || k === "google") return "gemini";
  const word = PROVIDER_WORDS.find(([w]) => k.includes(w));
  if (word) return word[1];
  if (k.includes("openai") || k.startsWith("gpt")) return "openai";
  if (k.includes("ollama")) return "ollama";
  return undefined;
}

type LateBrand = AcpBrand | ProviderBrand;

/**
 * The ACP agents' and model APIs' marks arrive after the first screen (`@apx/ui/marks`): until then such an engine
 * shows the neutral bot, then every icon draws its mark.
 */
let lateMarks: Partial<Record<LateBrand, AcpMark>> = {};
const markListeners = new Set<() => void>();
export function registerMarks(marks: Partial<Record<LateBrand, AcpMark>>): void {
  lateMarks = { ...lateMarks, ...marks };
  for (const l of markListeners) l();
}
const subscribeMarks = (fn: () => void) => {
  markListeners.add(fn);
  return () => markListeners.delete(fn);
};

const ACP_BRANDS = new Set<string>(Object.values(ACP_IDS));
const isAcp = (b: EngineBrand): b is AcpBrand => ACP_BRANDS.has(b);
/** Every model API with a mark; typed against the marks module, so a mark added there must be named here. */
const PROVIDER_BRANDS: Record<ProviderBrand, true> = {
  groq: true,
  anthropic: true,
  openrouter: true,
  cerebras: true,
  deepseek: true,
  mistral: true,
  lmstudio: true,
};
const isProvider = (b: EngineBrand): b is ProviderBrand => b in PROVIDER_BRANDS;

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

/** The official mark of an engine or a model API, so each one reads at a glance. */
export function EngineIcon({ engine, size = 16, tile = false, label, className }: EngineIconProps) {
  const marks = useSyncExternalStore(subscribeMarks, () => lateMarks);
  const named = engineBrand(engine);
  const brand = named && (isAcp(named) || isProvider(named)) && !marks[named] ? undefined : named;
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
  if (isAcp(brand) || isProvider(brand)) {
    // One-colour marks in the text colour (brand colours kept where the mark has them); on a tile, centred on the
    // neutral round tile.
    const m = marks[brand] as AcpMark;
    const paths = m.paths.map((p) => (
      <path
        key={p.d.slice(0, 24)}
        d={p.d}
        fill={p.fill ?? "currentColor"}
        {...(p.evenodd ? { fillRule: "evenodd" as const } : {})}
        {...(p.opacity !== undefined ? { fillOpacity: p.opacity } : {})}
      />
    ));
    return (
      <span className={cx(cls, "apx-engine--acp")} style={box} {...a11y}>
        <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
          {tile && <circle className="apx-engine__tile" cx="12" cy="12" r="12" />}
          <svg
            x={tile ? 4 : 0}
            y={tile ? 4 : 0}
            width={tile ? 16 : 24}
            height={tile ? 16 : 24}
            viewBox={m.viewBox}
            aria-hidden="true"
          >
            {paths}
          </svg>
        </svg>
      </span>
    );
  }
  return (
    <span className={cls} style={box} {...a11y}>
      <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
        <Mark brand={brand} tile={tile} gid={gid} />
      </svg>
    </span>
  );
}

function Mark({ brand, tile, gid }: { brand: keyof typeof ENGINE_MARKS; tile: boolean; gid: string }) {
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
