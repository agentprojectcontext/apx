import { ChannelIcon } from "@apx/ui";
import type { ChannelKind } from "./kinds.ts";

/** A channel kind's mark where a tile goes: the app's own logo, full, with no frame around it. */
export function KindTile({ kind, size = 20 }: { kind: ChannelKind; size?: number }) {
  return (
    <span className="kindtile" style={{ width: size, height: size }}>
      <ChannelIcon channel={kind} size={Math.round(size * 0.9)} />
    </span>
  );
}

/** A channel kind's bare mark, for menus and tags. */
export function KindIcon({ kind, size = 14 }: { kind: ChannelKind; size?: number }) {
  return <ChannelIcon channel={kind} size={size} />;
}
