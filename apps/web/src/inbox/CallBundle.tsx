import type { Thread } from "@apx/protocol";
import { ConversationRow, Icons, Spinner } from "@apx/ui";
import { shortWhen } from "../common/format.ts";
import { isWorking } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ChatRow } from "./InboxTabs.tsx";
import { FoldContext, useRowFold } from "./RowFold.tsx";
import { useOpenRow } from "./useOpenRow.ts";

/**
 * Every call, with any agent, as one row: how many and what was said last. A click unfolds the calls under it
 * (remembered), each with what it asked under it; the call on screen keeps it open.
 */
export function CallBundle({ threads, selected }: { threads: Thread[]; selected: string | undefined }) {
  const t = useT();
  // What a call asked its agent, on screen, keeps its call's row open too.
  const parent = useData((s) => (selected ? s.threads[selected]?.parent_id : undefined));
  const [open, setOpen] = useOpenRow(
    "calls",
    threads.some((c) => c.id === selected || c.id === parent),
  );
  const label = t(open ? "call.close" : "call.open");
  return (
    <div className="channelbundle callbundle">
      <FoldContext.Provider value={{ open, toggle: () => setOpen(!open), label }}>
        <CallsHead threads={threads} onToggle={() => setOpen(!open)} />
      </FoldContext.Provider>
      {open && (
        <div className="tree__sessions apx-branches channelbundle__chats">
          {threads.map((th) => (
            <ChatRow key={th.id} thread={th} selected={selected} bundled />
          ))}
        </div>
      )}
    </div>
  );
}

function CallsHead({ threads, onToggle }: { threads: Thread[]; onToggle(): void }) {
  const t = useT();
  const fold = useRowFold();
  // The bundle comes newest first.
  const latest = threads[0];
  const unread = threads.reduce((n, th) => n + th.unread, 0);
  const working = threads.some((th) => isWorking(th.state));
  const said = latest?.preview.split("\n").find((l) => l.trim()) ?? "";
  return (
    <div className="threadrow-wrap" ref={fold.wrap}>
      <ConversationRow
        className="threadrow channelbundle__head"
        onClick={onToggle}
        avatar={
          <span className="channelbundle__face">
            <span className="threadavatar__call" style={{ width: 22, height: 22 }}>
              <Icons.Phone size={12} />
            </span>
          </span>
        }
        title={t("call.calls")}
        titleTag={
          <>
            {fold.slot}
            {working && <Spinner size={12} className="threadrow__spin" />}
          </>
        }
        time={latest && shortWhen(latest.updated_at)}
        unread={unread}
        preview={
          <span className="threadrow__line">
            <span className="threadrow__who">
              <span className="inboxtask__count" title={t("call.count", { n: threads.length })}>
                <Icons.Phone size={12} /> {threads.length}
              </span>
              {said && ` · ${said}`}
            </span>
          </span>
        }
      />
      {fold.button}
    </div>
  );
}
