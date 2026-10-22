import { createElement, type ReactNode, useId, useSyncExternalStore } from "react";
import { CHANNEL_MARKS } from "../channel-marks";
import { cx } from "../cx";
import type { IntegrationMark, LateIntegrationBrand, MarkNode } from "../integration-marks";
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
let lateMarks: Partial<Record<LateIntegrationBrand, IntegrationMark>> = {};
const listeners = new Set<() => void>();
export function registerIntegrationMarks(marks: Partial<Record<LateIntegrationBrand, IntegrationMark>>): void {
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
  // Each icon's gradients and masks get ids of their own: two icons on a page never draw with each other's.
  const prefix = `m${useId().replace(/[^\w-]/g, "")}`;
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
  const mark: IntegrationMark | undefined = brand === "slack" ? CHANNEL_MARKS.slack : marks[brand];
  const icon =
    mark &&
    ("art" in mark ? (
      <svg viewBox={mark.viewBox} aria-hidden="true">
        {mark.art.map((n, i) => drawn(n, `${prefix}-`, i))}
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {mark.paths.map((p) => (
          <path key={p.d.slice(0, 24)} d={p.d} fill={p.color ?? "currentColor"} />
        ))}
      </svg>
    ));
  return <ProjectTile tone="neutral" icon={icon} size={size} label={label} className={cx("apx-intmark", className)} />;
}

/** One element of a mark drawn whole, with `{id}` in its attributes made this icon's own. */
function drawn(n: MarkNode, prefix: string, key: number): ReactNode {
  const props: Record<string, unknown> = { key };
  for (const [k, v] of Object.entries(n.a)) {
    const value = v.replaceAll("{id}", prefix);
    // A style is written as CSS ("mask-type:alpha"); React takes it as an object.
    props[k] =
      k === "style"
        ? Object.fromEntries(
            value
              .split(";")
              .filter(Boolean)
              .map((d) => {
                const [prop = "", val = ""] = d.split(":");
                return [prop.trim().replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()), val.trim()];
              }),
          )
        : value;
  }
  return createElement(n.t, props, ...(n.c ?? []).map((c, i) => drawn(c, prefix, i)));
}
