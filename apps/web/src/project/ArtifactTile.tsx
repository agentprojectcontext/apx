import { AgentAvatar, Avatar, IconButton, Icons, Tooltip } from "@apx/ui";
import type { ReactNode } from "react";
import { shortWhen } from "../common/format.ts";
import { blobOf, type ProjectEntry } from "../data/identity.ts";
import { useOwnerName } from "../data/owner.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { SubBadge } from "./subScope.tsx";

/** Who made an artifact: the owner, or an agent by id; nothing when it is not known. */
type Maker = { kind: "owner" } | { kind: "agent"; id: string } | undefined;

type Props = {
  title: string;
  icon: ReactNode;
  kind: string;
  maker: Maker;
  at: string;
  /** The subproject it comes from, when the gallery is its project's. */
  sub?: ProjectEntry | undefined;
  /** A note on the picture ("On the board"). */
  mark?: string | undefined;
  selected: boolean;
  onOpen: () => void;
  /** Opens the chat it was made in. */
  onChat?: (() => void) | undefined;
};

/** One artifact in a project's gallery: its picture (the kind's icon), its title, who made it and when. */
export function ArtifactTile({ title, icon, kind, maker, at, sub, mark, selected, onOpen, onChat }: Props) {
  const t = useT();
  const label = t("artifacts.openItem", { title });
  return (
    <li className={selected ? "artifacts__row projart is-selected" : "artifacts__row projart"}>
      <Tooltip content={label}>
        {/* ui: the whole card opens the artifact beside the gallery, as the design's gallery card does. */}
        <button type="button" className="projart__open" aria-expanded={selected} onClick={onOpen}>
          <span className="projart__thumb">
            {icon}
            <span className="projart__kind">{kind}</span>
            {mark && <span className="projart__mark">{mark}</span>}
          </span>
          <span className="projart__body">
            <span className="projart__title">{title}</span>
            <span className="projart__meta">
              <MakerLabel maker={maker} />
              <span className="projart__when">{shortWhen(at)}</span>
              {sub && <SubBadge project={sub} />}
            </span>
          </span>
        </button>
      </Tooltip>
      {onChat && (
        <IconButton
          size="sm"
          className="projart__chat"
          label={t("artifacts.openChat")}
          icon={<Icons.MessageSquare size={14} />}
          onClick={onChat}
        />
      )}
    </li>
  );
}

function MakerLabel({ maker }: { maker: Maker }) {
  const t = useT();
  const owner = useOwnerName();
  const agent = useData((s) => (maker?.kind === "agent" ? s.agents[maker.id] : undefined));
  if (maker?.kind === "owner")
    return (
      <span className="projart__who">
        <Avatar name={owner || t("artifacts.byYou")} size={14} />
        <span>{t("artifacts.byYou")}</span>
      </span>
    );
  if (!agent) return null;
  return (
    <span className="projart__who">
      <AgentAvatar name={agent.name} blob={blobOf(agent)} size={14} animated={false} />
      <span>{agent.name}</span>
    </span>
  );
}
