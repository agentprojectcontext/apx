import type { Thread } from "@apx/protocol";
import { EMAIL_LANG, parseEmailBlock } from "@apx/protocol/email-block";
import type { CodeRenderer } from "@apx/ui";
import { Suspense } from "react";
import { CodeBlock, EmailCard, RunnableCode } from "../lazy.ts";

const SHELL_LANGS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "shell", "console", "fish"]);

/**
 * A fenced shell block an agent wrote gets run and copy buttons (in the chat's folder, or else APX's work folder); an
 * ```email block is an email card; any other block gets its frame (language, copy, expand, and a preview for HTML
 * and Mermaid).
 */
export function runnableCode(thread: Thread, messageId: string): CodeRenderer {
  return (code, lang, pre) => {
    const mail = lang === EMAIL_LANG ? parseEmailBlock(code) : undefined;
    if (mail)
      return (
        <Suspense fallback={pre}>
          <EmailCard mail={mail} messageId={messageId} />
        </Suspense>
      );
    return lang && SHELL_LANGS.has(lang) && code.trim() ? (
      <Suspense fallback={pre}>
        <RunnableCode thread={thread} messageId={messageId} code={code} pre={pre} />
      </Suspense>
    ) : (
      <Suspense fallback={pre}>
        <CodeBlock code={code} lang={lang} pre={pre} />
      </Suspense>
    );
  };
}
