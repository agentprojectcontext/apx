import { cx } from "../cx";

export interface SpinnerProps {
  /** Pixel size. */
  size?: number;
  className?: string;
  /** Accessible label; omit when a visible label is next to it. */
  label?: string;
}

/** Indeterminate progress ring in the current text color. */
export function Spinner({ size = 16, className, label }: SpinnerProps) {
  return (
    <svg
      className={cx("apx-spinner", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
