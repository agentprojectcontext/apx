import { Composer, IconButton, Icons, MarkdownView, Message } from "@apx/ui";
import { type KeyboardEvent, useEffect, useRef, useSyncExternalStore } from "react";
import { useMarkdownLabels } from "../../common/useMarkdownLabels.ts";
import { asideOf, askAside, closeAside, subscribeAside, typeAside } from "../../data/aside.ts";
import { useT } from "../../i18n/index.ts";

/**
 * A side question, over the composer: the owner asks the chat's agent something quick and the answer shows here
 * only; nothing of it enters the chat (DECISIONS.md#d-215). Closing it lets the side conversation go. Esc closes.
 */
export function AsidePanel({ thread, agent }: { thread: string; agent: string }) {
  const t = useT();
  const md = useMarkdownLabels();
  const aside = useSyncExternalStore(subscribeAside, () => asideOf(thread));
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const asking = aside?.asking;

  // The field has the words whenever no answer is awaited (at first, and after each one).
  useEffect(() => {
    if (!asking) field.current?.focus();
  }, [asking]);
  // The newest exchange in view, as in the chat.
  const count = (aside?.turns.length ?? 0) + (asking ? 1 : 0) + (aside?.error ? 1 : 0);
  useEffect(() => {
    if (count) log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [count]);

  if (!aside) return null;
  const close = () => closeAside(thread);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Escape") return false;
    e.preventDefault();
    close();
    return true;
  };

  return (
    <section className="aside" aria-label={t("composer.aside")}>
      <header className="aside__head">
        <Icons.MessageCircle size={14} aria-hidden="true" />
        <span className="aside__title">{t("composer.aside")}</span>
        <span className="aside__sub">{t("composer.asideDesc")}</span>
        <span className="aside__spacer" />
        <IconButton size="sm" label={t("composer.asideClose")} icon={<Icons.X size={14} />} onClick={close} />
      </header>
      <div className="aside__log" ref={log}>
        {count === 0 && <p className="aside__hint">{t("composer.asideHint", { agent })}</p>}
        {aside.turns.map((turn, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: exchanges are only ever added at the end.
          <div className="aside__turn" key={i}>
            <Message from="user" grouped>
              {turn.question}
            </Message>
            <Message from="agent" grouped>
              <MarkdownView size="sm" labels={md} source={turn.answer} />
            </Message>
          </div>
        ))}
        {asking && (
          <div className="aside__turn">
            <Message from="user" grouped>
              {asking}
            </Message>
            <p className="aside__thinking" role="status">
              {t("composer.asideThinking", { agent })}
            </p>
          </div>
        )}
        {aside.error && (
          <p className="aside__error" role="alert">
            {t("composer.asideFailed", { error: aside.error })}
          </p>
        )}
      </div>
      <Composer
        className="aside__field"
        placeholder={t("composer.asidePlaceholder", { agent })}
        labels={{ send: t("composer.send") }}
        value={aside.text}
        onValueChange={(v) => typeAside(thread, v)}
        onSubmit={(v) => askAside(thread, v)}
        onInputKeyDown={onKey}
        inputRef={field}
        disabled={Boolean(asking)}
      />
    </section>
  );
}
