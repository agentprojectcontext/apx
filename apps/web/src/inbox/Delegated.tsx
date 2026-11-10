import type { Thread } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { loadDelegated } from "../data/actions.ts";
import { DELEGATED_SHOWN } from "../data/identity.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { delegatedByChat } from "./groupThreads.ts";
import { SessionRow } from "./InboxViews.tsx";
import { FoldContext } from "./RowFold.tsx";
import { selectionPath } from "./selectionPath.ts";
import { useOpenRow } from "./useOpenRow.ts";

const NONE: Thread[] = [];

/** "Roby → Researcher: the task": under its caller, the caller's name only repeats the row above. */
const CALLER = /^[^→\n]*→\s*/;

/**
 * A chat's row with the chats its agents delegated nested under it, closed until the owner opens them (remembered):
 * the chevron opens them, a delegated chat opens itself. A chat that delegated nothing is just its row. `inline`: the
 * row draws the chevron after its title (see RowFold); otherwise it stands before the row.
 */
function WithDelegated({
  thread,
  selected,
  children,
  ancestors = [],
  inline = false,
}: {
  thread: Thread;
  selected: string | undefined;
  children: ReactNode;
  ancestors?: string[];
  inline?: boolean | undefined;
}) {
  const t = useT();
  const loaded = useData((s) => s.threads);
  const kids = delegatedByChat(loaded).get(thread.id) ?? NONE;
  const counted = useData((s) => s.delegated[thread.id] ?? 0);
  const agents = useShownAgents();
  const [all, setAll] = useState(false);
  const path = selectionPath(loaded, selected);
  const active = kids.findIndex((k) => path.has(k.id));
  const [open, setOpen] = useOpenRow(`chat:${thread.id}`, Boolean(selected) && active >= 0);
  useEffect(() => {
    if (selected && active >= DELEGATED_SHOWN) setAll(true);
  }, [active, selected]);
  const total = Math.max(counted, kids.length);
  if (total === 0 || ancestors.includes(thread.id)) return <>{children}</>;
  const shown = all ? kids : kids.slice(0, DELEGATED_SHOWN);
  const more = total - shown.length;
  const showMore = () => {
    setAll(true);
    if (kids.length < total) void loadDelegated(thread.id);
  };
  const label = open ? t("inbox.delegated.close") : t("inbox.delegated.open");
  return (
    <div className={inline ? "delegated is-inline" : "delegated"} data-thread={thread.id}>
      {inline ? (
        <FoldContext.Provider value={{ open, toggle: () => setOpen(!open), label }}>{children}</FoldContext.Provider>
      ) : (
        <div className="delegated__head">
          <button
            type="button"
            className="delegated__fold"
            aria-expanded={open}
            aria-label={label}
            title={label}
            onClick={() => setOpen(!open)}
          >
            {open ? <Icons.ChevronDown size={14} /> : <Icons.ChevronRight size={14} />}
          </button>
          <div className="delegated__row">{children}</div>
        </div>
      )}
      {open && (
        <div className="tree__sessions apx-branches delegated__list">
          {shown.map((k) => (
            <ListedChat key={k.id} thread={k} selected={selected} nested ancestors={[...ancestors, thread.id]}>
              <SessionRow
                thread={k}
                agent={agents[k.agent_ids[0] ?? ""]}
                selected={k.id === selected}
                label={k.title.replace(CALLER, "")}
              />
            </ListedChat>
          ))}
          {more > 0 ? (
            <button type="button" className="tree__more" onClick={showMore}>
              {t("inbox.showMore", { n: more })}
            </button>
          ) : (
            all &&
            kids.length > DELEGATED_SHOWN && (
              <button type="button" className="tree__more" onClick={() => setAll(false)}>
                {t("inbox.showLess")}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A row of a chat list: a delegated chat listed on its own says where it came from; any other, what it delegated.
 * `inline`: its row (a ThreadRow) draws the fold chevron after its title.
 */
export function ListedChat(props: {
  thread: Thread;
  selected: string | undefined;
  children: ReactNode;
  nested?: boolean;
  ancestors?: string[];
  inline?: boolean;
}) {
  return !props.nested && props.thread.kind === "a2a" && props.thread.parent_id ? (
    <DelegatedFrom parentId={props.thread.parent_id}>{props.children}</DelegatedFrom>
  ) : (
    <WithDelegated {...props} />
  );
}

/**
 * A delegated chat listed on its own (its project's list, while the chat it came from is elsewhere): its row and,
 * under it, the chat it was delegated from, which opens it in the Inbox (it is not this project's).
 */
function DelegatedFrom({ parentId, children }: { parentId: string; children: ReactNode }) {
  const t = useT();
  const parent = useData((s) => s.threads[parentId]);
  return (
    <div className="delegated is-alone">
      {children}
      <button type="button" className="delegated__from" onClick={() => go.inboxThread(parentId)}>
        <Icons.Reply size={12} />
        <span className="delegated__fromtext">
          {parent ? t("inbox.delegated.from", { chat: parent.title }) : t("inbox.delegated.fromUnknown")}
        </span>
      </button>
    </div>
  );
}
