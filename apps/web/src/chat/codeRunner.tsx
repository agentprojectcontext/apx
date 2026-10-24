import type { Thread } from "@apx/protocol";
import type { CodeRenderer } from "@apx/ui";
import { Suspense } from "react";
import { RunnableCode } from "../lazy.ts";

const SHELL_LANGS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "shell", "console", "fish"]);

/** A fenced shell block an agent wrote gets run and copy buttons (in the chat's folder, or else APX's work folder). */
export function runnableCode(thread: Thread, messageId: string): CodeRenderer {
  return (code, lang, pre) =>
    lang && SHELL_LANGS.has(lang) && code.trim() ? (
      <Suspense fallback={pre}>
        <RunnableCode thread={thread} messageId={messageId} code={code} pre={pre} />
      </Suspense>
    ) : (
      pre
    );
}
