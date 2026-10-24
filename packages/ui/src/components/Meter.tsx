import { cx } from "../cx";

export type MeterTone = "brand" | "violet" | "info" | "warning" | "danger" | "muted";
export interface MeterSegment {
  value: number;
  tone?: MeterTone;
  /** Shown in the legend and read by screen readers. */
  label?: string;
}

export interface MeterProps {
  /** One amount, toned by how full it is, or stacked parts (each with its tone). */
  value?: number;
  segments?: MeterSegment[];
  max: number;
  /** Accessible name. */
  label: string;
  /** Spoken value ("6.2 of 16 GB"); the percentage when omitted. */
  valueText?: string;
  size?: "sm" | "md";
  /** A swatch and label under the bar for each segment that has a label. */
  legend?: boolean;
  className?: string;
}

/** Fill toned by share: brand, warning past 80%, danger past 92%. */
const toneFor = (share: number): MeterTone => (share >= 0.92 ? "danger" : share >= 0.8 ? "warning" : "brand");

/** Horizontal bar for an amount out of a whole (RAM, disk), single or stacked. */
export function Meter({ value, segments, max, label, valueText, size = "md", legend, className }: MeterProps) {
  const parts = segments ?? [{ value: value ?? 0, tone: toneFor(max > 0 ? (value ?? 0) / max : 0) }];
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0);
  const pct = (v: number) => (max > 0 ? Math.min(100, (Math.max(0, v) / max) * 100) : 0);
  return (
    <div className={cx("apx-meter", `apx-meter--${size}`, className)}>
      {/* Stacked parts have no native <meter>: one image named with the whole, the legend names the parts. */}
      <div
        className="apx-meter__track"
        role="img"
        aria-label={`${label}: ${valueText ?? `${Math.round(pct(total))}%`}`}
      >
        {parts.map((p, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
            key={i}
            className={cx("apx-meter__fill", `apx-meter__fill--${p.tone ?? "brand"}`)}
            style={{ width: `${pct(p.value)}%` }}
          />
        ))}
      </div>
      {legend && (
        <div className="apx-meter__legend">
          {parts
            .filter((p) => p.label)
            .map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
              <span key={i} className="apx-meter__key">
                <span className={cx("apx-meter__swatch", `apx-meter__fill--${p.tone ?? "brand"}`)} />
                {p.label}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
