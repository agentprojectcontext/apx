import type { Thread } from "@apx/protocol";
import { EMAIL_LANG, parseEmailBlock } from "@apx/protocol/email-block";
import type { CodeRenderer } from "@apx/ui";
import { Fragment, type ReactNode, Suspense } from "react";
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

/**
 * A block that is a card of its own between the reply's bubbles (replySegments.ts): while the agent is still writing
 * it, its code coming in; once whole, its frame, what it draws (a page, a diagram, an email card) or its run button.
 */
export function replyBlock(
  thread: Thread,
  messageId: string,
  block: { lang: string; code: string },
  writing: boolean,
): ReactNode {
  const pre = (
    <pre>
      <code>{block.code}</code>
    </pre>
  );
  // A new key once it is whole, so the frame starts again on what it draws.
  return writing ? (
    <Suspense key="writing" fallback={pre}>
      <CodeBlock code={block.code} lang={block.lang || undefined} pre={pre} writing />
    </Suspense>
  ) : (
    <Fragment key="whole">
      {runnableCode(thread, messageId)(block.code, block.lang || undefined, pre, block.lang)}
    </Fragment>
  );
}
