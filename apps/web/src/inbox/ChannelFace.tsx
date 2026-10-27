import type { Thread } from "@apx/protocol";
import { Avatar, Tag, Tooltip } from "@apx/ui";
import { KindIcon } from "../channels/KindIcon.tsx";
import { CHANNEL_KINDS } from "../channels/kinds.ts";
import { PersonAvatar } from "../channels/PersonAvatar.tsx";
import { useThreadPerson } from "../channels/useThreadPerson.ts";
import { useT } from "../i18n/index.ts";
import { useThreadChannel } from "./useThreadChannel.ts";

/** Channel identities never borrow the responding agent's face. */
export function ChannelFace({
  thread,
  size = 32,
  slot = size,
  labelOnly = false,
  showMark = false,
}: {
  thread: Thread;
  size?: number;
  slot?: number;
  labelOnly?: boolean;
  showMark?: boolean;
}) {
  const t = useT();
  const person = useThreadPerson(thread);
  const channel = useThreadChannel(thread);
  const name = person?.name || thread.title;
  const label = channel ? t("chat.viaChannel", { channel: t(CHANNEL_KINDS[channel].name) }) : "";

  if (labelOnly)
    return channel ? (
      <Tag>
        <KindIcon kind={channel} size={11} /> {label}
      </Tag>
    ) : null;
  const markSize = Math.min(16, size);
  const width = slot + (channel && showMark ? markSize + 4 : 0);
  return (
    <span className="threadavatar" style={{ width, minWidth: width, height: slot, gap: 4 }}>
      {channel && showMark && (
        <Tooltip content={label}>
          <span className="threadavatar__channel" role="img" aria-label={label} style={{ display: "inline-flex" }}>
            <KindIcon kind={channel} size={markSize} />
          </span>
        </Tooltip>
      )}
      <PersonAvatar
        personId={person?.id}
        name={name}
        size={size}
        className="threadavatar__person"
        fallback={<Avatar name={name} size={size} />}
      />
    </span>
  );
}
