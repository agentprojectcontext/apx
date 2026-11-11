import { KindIcon } from "../channels/KindIcon.tsx";
import type { ChannelKind } from "../channels/kinds.ts";
import { projectTone } from "../data/identity.ts";

/**
 * A project's name as a small tag in its own colour (the same tone as its tile), in a chat or routine row; a chat on a
 * channel carries that app's logo inside it.
 */
export function ProjectBadge({ id, name, channel }: { id: string; name: string; channel?: ChannelKind | undefined }) {
  return (
    <span className={`projbadge is-${projectTone(id)}${channel ? " has-channel" : ""}`}>
      {channel && <KindIcon kind={channel} size={10} />}
      {name}
    </span>
  );
}
