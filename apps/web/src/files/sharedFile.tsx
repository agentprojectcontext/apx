// What a shared file's card and preview both show: its kind's icon, who sent it, when, and what can be done with it.
import type { Author, SharedFile, SharedKind } from "@apx/protocol";
import { AgentAvatar, Avatar, IconButton, Icons, Tooltip } from "@apx/ui";
import type { ReactNode } from "react";
import { client } from "../data/client.ts";
import { mediaUrl } from "../data/media.ts";
import { notify } from "../data/notices.ts";
import { useOwnerName } from "../data/owner.ts";
import { useData } from "../data/state.ts";
import { currentLocale, type MessageKey, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

export const ONE: Record<SharedKind, MessageKey> = {
  image: "shared.one.image",
  video: "shared.one.video",
  audio: "shared.one.audio",
  document: "shared.one.document",
};

export function kindIcon(kind: SharedKind, size: number): ReactNode {
  if (kind === "image") return <Icons.Image size={size} />;
  if (kind === "video") return <Icons.Film size={size} />;
  if (kind === "audio") return <Icons.Music size={size} />;
  return <Icons.FileText size={size} />;
}

/** "30 oct 2026, 12:26": the day and the time, always both. */
export const when = (iso: string) =>
  new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Who sent it, as an avatar and a name: the owner, an agent, a contact or a widget. */
export function Sender({ author, size = 18 }: { author: Author; size?: number }) {
  const t = useT();
  const owner = useOwnerName();
  const agent = useData((s) => (author.kind === "agent" ? s.agents[author.id] : undefined));
  const name =
    author.kind === "user"
      ? t("shared.you")
      : author.kind === "agent"
        ? (agent?.name ?? "")
        : author.kind === "person"
          ? author.name
          : author.kind === "surface"
            ? author.title
            : "";
  if (!name) return null;
  return (
    <span className="sharedf__sender">
      {author.kind === "agent" ? (
        <AgentAvatar name={name} blob={agent?.blob} size={size} animated={false} />
      ) : (
        <Avatar name={author.kind === "user" ? owner || name : name} size={size} />
      )}
      <span>{name}</span>
    </span>
  );
}

function Action({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip content={label}>
      <IconButton
        label={label}
        icon={icon}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      />
    </Tooltip>
  );
}

/** Go to the chat and download; `all` adds show in its folder and copy its path. */
export function SharedActions({ file, all = false }: { file: SharedFile; all?: boolean }) {
  const t = useT();
  const engine = useData((s) => s.threads[file.thread_id]?.engine);
  const failed = (e: unknown) => notify(e instanceof Error ? e.message : String(e));
  const download = async () => {
    try {
      const a = document.createElement("a");
      a.href = await mediaUrl(file.media_id);
      a.download = file.name || file.media_id;
      a.click();
    } catch (e) {
      failed(e);
    }
  };
  return (
    <span className="sharedf__actions">
      <Action
        label={t("shared.goTo")}
        icon={<Icons.MessageSquare size={16} />}
        onClick={() => go.message(file.thread_id, file.message_id, engine)}
      />
      <Action label={t("shared.download")} icon={<Icons.Download size={16} />} onClick={() => void download()} />
      {all && (
        <>
          <Action
            label={t("shared.reveal")}
            icon={<Icons.FolderOpen size={16} />}
            onClick={() => void client.call("media.reveal", { media_id: file.media_id }).catch(failed)}
          />
          <Action
            label={t("shared.copyPath")}
            icon={<Icons.Copy size={16} />}
            onClick={() =>
              void navigator.clipboard.writeText(file.path).then(() => notify(t("shared.copied"), "info"), failed)
            }
          />
        </>
      )}
    </span>
  );
}
