import type { TerminalInfo, Thread } from "@apx/protocol";
import { Button, EmptyState, Icons, Skeleton } from "@apx/ui";
import { Suspense, useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { watchEvents } from "../data/live.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { TerminalView } from "../lazy.ts";
import { useNav } from "../shell/nav.ts";
import { PanelTabs } from "./PanelTabs.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The chat's terminals: the owner's own shells in the chat's folder and the long-running ones opened to run something,
 * one tab each, with "+" for a new shell. The commands the agent ran live in the chat's processes.
 */
export function TerminalPanel({ thread }: { thread: Thread }) {
  const t = useT();
  const threadId = thread.id;
  const [terms, setTerms] = useState<TerminalInfo[]>();
  const [tab, setTab] = useState<string>();
  const wanted = useNav((s) => s.panelTerminal);
  const load = useCallback(async () => {
    const r = await client.call("terminal.list", { thread: threadId }).catch(() => ({ terminals: [] }));
    setTerms(r.terminals);
    return r.terminals;
  }, [threadId]);
  useEffect(() => {
    void load();
    return watchEvents((ev) => {
      if (ev.type === "terminal.exited") void load();
    });
  }, [load]);
  // A terminal opened elsewhere (a run button in the chat) comes forward once the list knows it.
  useEffect(() => {
    if (wanted) void load().then((list) => list.some((x) => x.id === wanted) && setTab(wanted));
  }, [wanted, load]);
  const open = async () => {
    try {
      const term = await client.call("terminal.open", { thread: threadId, cols: 80, rows: 24 });
      await load();
      setTab(term.id);
    } catch (e) {
      notify(t("terminal.openFailed", { error: errText(e) }));
    }
  };
  const close = async (id: string) => {
    await client.call("terminal.close", { terminal: id }).catch(() => {});
    const left = await load();
    if (tab === id) setTab(left.at(-1)?.id);
  };
  const current = terms?.find((x) => x.id === tab) ?? terms?.at(-1);
  return (
    <div className="sidepanel__body term">
      <PanelTabs
        label={t("panel.terminal")}
        tabs={(terms ?? []).map((x) => ({
          id: x.id,
          label: x.title,
          icon: <Icons.Terminal size={12} />,
          ...(!x.alive && { note: t("terminal.ended") }),
        }))}
        value={current?.id}
        onSelect={setTab}
        onClose={(id) => void close(id)}
        onNew={() => void open()}
        newLabel={t("terminal.new")}
      />
      {!terms ? (
        <Skeleton className="term__loading" />
      ) : current ? (
        <Suspense fallback={<Skeleton className="term__loading" />}>
          <TerminalView key={current.id} terminal={current} />
        </Suspense>
      ) : (
        <EmptyState
          icon={<Icons.Terminal />}
          title={t("terminal.none")}
          action={
            <Button size="sm" variant="secondary" leadingIcon={<Icons.Plus size={14} />} onClick={() => void open()}>
              {t("terminal.openOwn")}
            </Button>
          }
        >
          {t("terminal.noneBody")}
        </EmptyState>
      )}
    </div>
  );
}
