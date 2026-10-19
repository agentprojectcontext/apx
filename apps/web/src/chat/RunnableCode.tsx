import type { TerminalInfo, Thread } from "@apx/protocol";
import { IconButton, Icons } from "@apx/ui";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { watchEvents } from "../data/live.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { asksSecret, screenText } from "../panel/terminalText.ts";
import { go } from "../shell/nav.ts";
import { CopyButton } from "./MessageActions.tsx";

const MAX_OUTPUT = 64 * 1024;

// One terminal.list per chat for every block in it, to find again the run a block already had.
const listed = new Map<string, Promise<TerminalInfo[]>>();
const terminalsOf = (thread: string) => {
  let p = listed.get(thread);
  if (!p) {
    p = client.call("terminal.list", { thread }).then(
      (r) => r.terminals,
      () => [],
    );
    listed.set(thread, p);
  }
  return p;
};

/**
 * The block as a card; running it opens a terminal of its own whose output shows in a card below, read-only. What
 * it asks (a password) is typed in that terminal in the side panel; when it ends, the agent that wrote it is told.
 */
export function RunnableCode({
  thread,
  messageId,
  code,
  pre,
}: {
  thread: Thread;
  messageId: string;
  code: string;
  pre: ReactElement;
}) {
  const t = useT();
  const command = code.trim();
  const [busy, setBusy] = useState(false);
  const [term, setTerm] = useState<TerminalInfo>();
  useEffect(() => {
    let stop = false;
    void terminalsOf(thread.id).then((list) => {
      const last = list.filter((x) => x.command === command).at(-1);
      if (!stop && last) setTerm((cur) => cur ?? last);
    });
    return () => {
      stop = true;
    };
  }, [thread.id, command]);
  const run = async () => {
    setBusy(true);
    try {
      const opened = await client.call("terminal.open", {
        thread: thread.id,
        cols: 100,
        rows: 24,
        command,
        message: messageId,
      });
      listed.delete(thread.id);
      setTerm(opened);
    } catch (e) {
      notify(t("terminal.openFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="runcode">
      <div className="runcode__card">
        {pre}
        <div className="runcode__actions">
          <IconButton
            size="sm"
            label={t("code.run")}
            icon={<Icons.Play size={13} />}
            disabled={busy || term?.alive === true}
            onClick={() => void run()}
          />
          <CopyButton text={command} />
        </div>
      </div>
      {term && <RunOutput key={term.id} terminal={term} />}
    </div>
  );
}

/** What the block's terminal printed, live while it runs; its button brings that terminal forward in the side panel. */
function RunOutput({ terminal }: { terminal: TerminalInfo }) {
  const t = useT();
  const [raw, setRaw] = useState("");
  const [alive, setAlive] = useState(terminal.alive);
  const [exit, setExit] = useState(terminal.exit_code);
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const add = (data: string) => setRaw((s) => (s + data).slice(-MAX_OUTPUT));
    // Output that arrives while the backlog is on its way waits behind it.
    let ready = false;
    let exited = false;
    let stopped = false;
    const early: string[] = [];
    const stop = watchEvents((ev) => {
      if (ev.type === "terminal.output" && ev.terminal === terminal.id) {
        if (ready) add(ev.data);
        else early.push(ev.data);
      }
      if (ev.type === "terminal.exited" && ev.terminal === terminal.id) {
        exited = true;
        setAlive(false);
        setExit(ev.exit_code);
      }
    });
    void client
      .call("terminal.attach", { terminal: terminal.id })
      .then((r) => {
        if (stopped) return;
        setRaw((r.backlog + early.join("")).slice(-MAX_OUTPUT));
        // An exit event is newer than the attach snapshot, even when its response arrives last.
        if (!exited) {
          setAlive(r.terminal.alive);
          setExit(r.terminal.exit_code);
        }
      })
      .catch(() => {
        if (!stopped) setRaw(early.join(""));
      })
      .finally(() => {
        ready = true;
      });
    return () => {
      stopped = true;
      stop();
    };
  }, [terminal.id]);
  const screen = screenText(raw).replace(/^\n+/, "");
  // Keep the newest line in view, as a terminal does (it renders again only when output comes).
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  const waiting = alive && asksSecret(screen);
  const status = alive
    ? waiting
      ? t("code.waitingInput")
      : t("terminal.running")
    : exit != null
      ? t("terminal.exit", { code: exit })
      : t("terminal.done");
  return (
    <div className="runcode__out">
      <pre ref={box} className="runcode__screen">
        {screen || (alive ? "…" : "")}
      </pre>
      <div className="runcode__foot">
        <span className={`runcode__status${alive ? " is-running" : exit ? " is-failed" : ""}`}>{status}</span>
        <IconButton
          size="sm"
          className={waiting ? "runcode__shell is-asking" : "runcode__shell"}
          label={waiting ? t("code.typeInPanel") : t("code.openTerminal")}
          icon={<Icons.Terminal size={13} />}
          onClick={() => go.terminal(terminal.id)}
        />
      </div>
    </div>
  );
}
