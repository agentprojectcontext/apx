import type { Thread } from "@apx/protocol";
import { Avatar, Tag } from "@apx/ui";
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
}: {
  thread: Thread;
  size?: number;
  slot?: number;
  labelOnly?: boolean;
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
  return (
    <span className="threadavatar" style={{ width: slot, minWidth: slot, height: slot }}>
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
