import { useSyncExternalStore } from "react";
import { CHANNEL_MARKS, type ChannelMark } from "../channel-marks";
import { cx } from "../cx";
import type { LateIntegrationBrand } from "../integration-marks";
import { ProjectTile, type TileTone } from "./ProjectTile";

export type IntegrationBrand = LateIntegrationBrand | "slack";

/** Every integration with a mark; typed against the marks module, so a mark added there must be named here. */
const BRANDS: Record<IntegrationBrand, true> = {
  github: true,
  notion: true,
  slack: true,
  sentry: true,
  "brave-search": true,
  obsidian: true,
  "google-calendar": true,
  gmail: true,
  "google-drive": true,
  linear: true,
  asana: true,
};
const ALIASES: Record<string, IntegrationBrand> = {
  brave: "brave-search",
  googlecalendar: "google-calendar",
  "google-mail": "gmail",
  googledrive: "google-drive",
};

/** The integration an id names (`GitHub`, `brave_search`, `googlecalendar` all count), or undefined. */
export function integrationBrand(id: string): IntegrationBrand | undefined {
  const k = id
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (Object.hasOwn(BRANDS, k)) return k as IntegrationBrand;
  return ALIASES[k];
}

/** The marks arrive after the first screen (`@apx/ui/marks`); Slack's is the channel mark, here from the start. */
let lateMarks: Partial<Record<LateIntegrationBrand, ChannelMark>> = {};
const listeners = new Set<() => void>();
export function registerIntegrationMarks(marks: Partial<Record<LateIntegrationBrand, ChannelMark>>): void {
  lateMarks = { ...lateMarks, ...marks };
  for (const l of listeners) l();
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export interface IntegrationIconProps {
  /** Integration id or MCP server name (`github`, `brave-search`, `google-calendar`…). */
  id: string;
  /** The app's name: its first letter fills the tile when the id has no mark (a custom MCP server). */
  name: string;
  /** Pixel size (default 32). */
  size?: number;
  /** Tone of the letter tile; a mark always sits on the neutral tile. */
  tone?: TileTone;
  /** Accessible name; omit when the icon sits next to visible text. */
  label?: string;
  className?: string;
}

/** The official mark of an integration's app on its tile; the letter tile for anything without one. */
export function IntegrationIcon({ id, name, size = 32, tone = "info", label, className }: IntegrationIconProps) {
  const marks = useSyncExternalStore(subscribe, () => lateMarks);
  const brand = integrationBrand(id);
  if (!brand)
    return (
      <ProjectTile
        tone={tone}
        initial={name.slice(0, 1).toUpperCase()}
        size={size}
        label={label}
        className={className}
      />
    );
  // A known app whose mark is still on its way gets the empty tile, so a letter never flashes before the logo.
  const mark = brand === "slack" ? CHANNEL_MARKS.slack : marks[brand];
  const icon = mark && (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {mark.paths.map((p) => (
        <path key={p.d.slice(0, 24)} d={p.d} fill={p.color ?? "currentColor"} />
      ))}
    </svg>
  );
  return <ProjectTile tone="neutral" icon={icon} size={size} label={label} className={cx("apx-intmark", className)} />;
}
