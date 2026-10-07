import type { Thread } from "@apx/protocol";
import { type CodeRenderer, IconButton, Icons } from "@apx/ui";
import type { ReactElement } from "react";
import { useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

const SHELL_LANGS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "shell", "console", "fish"]);

/** A fenced shell block an agent wrote gets a run button when the chat has a folder to run it in. */
export function runnableCode(thread: Thread, messageId: string): CodeRenderer {
  return (code, lang, pre) =>
    lang && SHELL_LANGS.has(lang) && code.trim() ? (
      <RunnableCode thread={thread} messageId={messageId} code={code} pre={pre} />
    ) : (
      pre
    );
}

/**
 * Runs the block in a terminal of its own in the side panel, where the owner can type what it asks (a password);
 * when it ends, the agent that wrote it is told how it went.
 */
function RunnableCode({
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
  const [busy, setBusy] = useState(false);
  // The same rule as the side panel's terminals (useWorkspace): a project with its folder on this machine.
  const hasFolder = useData((s) => {
    const p = thread.project_id ? s.projects.find((x) => x.id === thread.project_id) : undefined;
    return Boolean(p?.path && p.present);
  });
  if (!hasFolder) return pre;
  const run = async () => {
    setBusy(true);
    try {
      const term = await client.call("terminal.open", {
        thread: thread.id,
        cols: 80,
        rows: 24,
        command: code.trim(),
        message: messageId,
      });
      go.terminal(term.id);
    } catch (e) {
      notify(t("terminal.openFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="runcode">
      {pre}
      <IconButton
        size="sm"
        className="runcode__run"
        label={t("code.run")}
        icon={<Icons.Play size={13} />}
        disabled={busy}
        onClick={() => void run()}
      />
    </div>
  );
}
