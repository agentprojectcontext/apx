import type { Thread } from "@apx/protocol";
import type { CodeRenderer } from "@apx/ui";
import { lazy, Suspense } from "react";

// The run button and its terminal load the first time a chat shows a shell block; until then the block shows as is.
const RunnableCode = lazy(() => import("./RunnableCode.tsx").then((m) => ({ default: m.RunnableCode })));

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
