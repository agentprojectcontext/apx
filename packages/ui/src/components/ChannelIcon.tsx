import { Mail, MessageCircle, Smartphone } from "lucide-react";
import type { CSSProperties } from "react";
import { CHANNEL_MARKS, type ChannelBrand } from "../channel-marks";
import { cx } from "../cx";

export interface ChannelIconProps {
  /** Channel kind (`telegram`, `whatsapp`, `slack`…). Email and SMS have no brand: a generic icon. */
  channel: string;
  /** Pixel size (default 16). */
  size?: number;
  /** Accessible name; omit when the icon sits next to visible text. */
  label?: string;
  className?: string;
}

const isBrand = (k: string): k is ChannelBrand => Object.hasOwn(CHANNEL_MARKS, k);

/** The official mark of a chat app (Telegram, WhatsApp, Slack, Discord…), in its own colours. */
export function ChannelIcon({ channel, size = 16, label, className }: ChannelIconProps) {
  const box: CSSProperties = { width: size, height: size };
  const a11y = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  const cls = cx("apx-chanicon", className);
  if (!isBrand(channel)) {
    const Icon = channel === "email" ? Mail : channel === "sms" ? Smartphone : MessageCircle;
    return (
      <span className={cx(cls, "apx-chanicon--none")} style={box} {...a11y}>
        <Icon size={size} />
      </span>
    );
  }
  return (
    <span className={cls} style={box} {...a11y}>
      <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
        {CHANNEL_MARKS[channel].paths.map((p) => (
          <path key={p.d.slice(0, 24)} d={p.d} fill={p.color ?? "currentColor"} />
        ))}
      </svg>
    </span>
  );
}
