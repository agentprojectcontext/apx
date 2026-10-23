import { type ReactNode, useId, useSyncExternalStore } from "react";
import { CHANNEL_MARKS } from "../channel-marks";
import { cx } from "../cx";
import type { IntegrationMark, LateIntegrationBrand, MarkArt } from "../integration-marks";
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
  atlassian: true,
  gitlab: true,
  vercel: true,
  supabase: true,
  stripe: true,
  todoist: true,
  airtable: true,
  figma: true,
  "home-assistant": true,
  n8n: true,
  cloudflare: true,
  netlify: true,
  neon: true,
  clickup: true,
  monday: true,
  canva: true,
  miro: true,
  dropbox: true,
  box: true,
  calendly: true,
  datadog: true,
  grafana: true,
  paypal: true,
  wordpress: true,
  "hugging-face": true,
  railway: true,
  intercom: true,
  attio: true,
  mixpanel: true,
  amplitude: true,
  "better-stack": true,
  square: true,
  strava: true,
  wolfram: true,
  "aws-knowledge": true,
  "microsoft-learn": true,
  semgrep: true,
  circleci: true,
  postman: true,
  prisma: true,
  cloudinary: true,
  webflow: true,
};
const ALIASES: Record<string, IntegrationBrand> = {
  brave: "brave-search",
  googlecalendar: "google-calendar",
  "google-mail": "gmail",
  googledrive: "google-drive",
  jira: "atlassian",
  confluence: "atlassian",
  homeassistant: "home-assistant",
  huggingface: "hugging-face",
  betterstack: "better-stack",
  "wordpress-com": "wordpress",
  "prisma-postgres": "prisma",
  "monday-com": "monday",
  aws: "aws-knowledge",
  "aws-docs": "aws-knowledge",
  "microsoft-docs": "microsoft-learn",
  "wolfram-alpha": "wolfram",
  wolframalpha: "wolfram",
  "circle-ci": "circleci",
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
/** Draws a mark kept whole (MarkArt): it comes with the marks, so the first screen never carries it. */
let drawArt: ((mark: MarkArt, prefix: string) => ReactNode) | undefined;
const listeners = new Set<() => void>();
export function registerIntegrationMarks(
  marks: Partial<Record<LateIntegrationBrand, IntegrationMark>>,
  draw?: (mark: MarkArt, prefix: string) => ReactNode,
): void {
  if (draw) drawArt = draw;
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
      drawArt && (
        <svg viewBox={mark.viewBox} aria-hidden="true">
          {drawArt(mark, `${prefix}-`)}
        </svg>
      )
    ) : (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {mark.paths.map((p) => (
          <path key={p.d.slice(0, 24)} d={p.d} fill={p.color ?? "currentColor"} />
        ))}
      </svg>
    ));
  return <ProjectTile tone="neutral" icon={icon} size={size} label={label} className={cx("apx-intmark", className)} />;
}
