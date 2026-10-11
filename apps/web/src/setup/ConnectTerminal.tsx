import { Icons } from "@apx/ui";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { SshPrompt } from "../apx-desktop.d.ts";
import { useT } from "../i18n/index.ts";

export type TermLine = { kind: "step" | "out" | "said"; text: string };

/**
 * Connecting over SSH, drawn as a terminal: the steps and the server's output read-only, and an input line when ssh
 * asks something (a password or passphrase masked, a yes/no in the clear). `children` go under the output.
 */
export function ConnectTerminal(props: {
  target: string;
  lines: TermLine[];
  prompt: SshPrompt | undefined;
  /** The owner's answer to `prompt`; undefined cancels it. */
  onAnswer: (answer: string | undefined) => void;
  busy: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  const body = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const { prompt, lines } = props;
  // A new question starts empty: an answer never carries over to the next one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on each new question
  useEffect(() => setValue(""), [prompt?.id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the output as it grows
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, prompt?.id, props.children]);

  const asked = prompt?.text.split("\n") ?? [];
  const last = asked.pop() ?? "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    props.onAnswer(value);
    setValue("");
  };

  return (
    <div id="connect-term" className="connect__term">
      <div className="connect__term-bar">
        <Icons.Terminal size={14} />
        <span>ssh {props.target}</span>
      </div>
      <div ref={body} className="connect__term-body">
        <pre id="connect-log" className="connect__term-log" aria-live="polite">
          {lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
            <span key={i} className={`connect__term-line is-${l.kind}`}>
              {l.text}
              {"\n"}
            </span>
          ))}
          {asked.length > 0 && `${asked.join("\n")}\n`}
        </pre>
        {prompt ? (
          <form id="term-answer" className="connect__term-ask" onSubmit={submit}>
            <label htmlFor="term-input" className="connect__term-prompt">
              {last}
            </label>
            <input
              id="term-input"
              className="connect__term-input"
              type={prompt.secret ? "password" : "text"}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              // biome-ignore lint/a11y/noAutofocus: the one thing to do while ssh waits
              autoFocus
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") props.onAnswer(undefined);
              }}
            />
          </form>
        ) : (
          props.busy && <span className="connect__term-cursor" aria-hidden="true" />
        )}
        {prompt?.secret && <span className="connect__term-note">{t("connect.term.secretHint")}</span>}
        {props.children}
      </div>
    </div>
  );
}
