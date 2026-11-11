import type { Thread } from "@apx/protocol";
import { ConversationRow, Icons, Spinner } from "@apx/ui";
import { accountName } from "../channels/accountName.ts";
import { KindTile } from "../channels/KindIcon.tsx";
import { isChannelKind } from "../channels/kinds.ts";
import { shortWhen } from "../common/format.ts";
import { useChannels } from "../data/channels.ts";
import { isWorking } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";
import { ChatRow } from "./InboxTabs.tsx";
import { FoldContext, useRowFold } from "./RowFold.tsx";
import { useOpenRow } from "./useOpenRow.ts";

/**
 * Every chat on one channel account as one row: the account, how many chats and who wrote last. A click unfolds its
 * chats under it (remembered); the chat on screen keeps it open.
 */
export function ChannelBundle({
  account,
  threads,
  selected,
}: {
  account: string;
  threads: Thread[];
  selected: string | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useOpenRow(
    `channel:${account}`,
    threads.some((th) => th.id === selected),
  );
  const label = t(open ? "inbox.channelBundle.close" : "inbox.channelBundle.open");
  return (
    <div className="channelbundle">
      <FoldContext.Provider value={{ open, toggle: () => setOpen(!open), label }}>
        <ChannelHead account={account} threads={threads} onToggle={() => setOpen(!open)} />
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

function ChannelHead({ account, threads, onToggle }: { account: string; threads: Thread[]; onToggle(): void }) {
  const t = useT();
  const fold = useRowFold();
  const info = useChannels((s) => s.channels.find((c) => c.id === account));
  const kind = info && isChannelKind(info.type) ? info.type : undefined;
  const name = info ? accountName(info, t) : account;
  // The bundle comes newest first: its first chat is who wrote last.
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
            {kind ? <KindTile kind={kind} size={20} /> : <Icons.Send size={16} />}
          </span>
        }
        title={name}
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
              <span className="inboxtask__count" title={t("inbox.channelBundle.chats", { n: threads.length })}>
                <Icons.MessageSquare size={12} /> {threads.length}
              </span>
              {latest && (
                <>
                  {" · "}
                  {[latest.title, said].filter(Boolean).join(": ")}
                </>
              )}
            </span>
          </span>
        }
      />
      {fold.button}
    </div>
  );
}
