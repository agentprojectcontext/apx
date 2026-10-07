import type { Agent, Task } from "@apx/protocol";
import { AgentAvatar, Composer, IconButton, Icons } from "@apx/ui";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { availableAgents } from "../common/pickers/agents.ts";
import { blobOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { commentTask } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { insertMention, type Mention, mentionAt, mentionToken } from "./mentions.ts";

/**
 * The comment box under a task's conversation, like the chat's: Enter sends, Shift+Enter adds a line, @ picks an agent
 * to ask. `focus` changes when a quote was put in, to bring the caret to the end.
 */
export function TaskComment({
  task,
  text,
  onChange,
  focus = 0,
  onSent,
}: {
  task: Task;
  text: string;
  onChange: (text: string) => void;
  focus?: number;
  /** A comment went out: the panel shows its end, where the answer will come. */
  onSent?: () => void;
}) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<Mention>();
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const listId = useId();
  const roster = Object.values(agents);
  const query = mention?.query.toLowerCase() ?? "";
  const choices = availableAgents(roster, task.project_id, false, task.project_id ? "secretary" : "all").filter((a) =>
    [a.name, a.slug ?? "", a.id].some((name) => name.toLowerCase().includes(query)),
  );
  const selected = Math.min(active, Math.max(0, choices.length - 1));
  useEffect(() => {
    if (mention) list.current?.children.item(selected)?.scrollIntoView({ block: "nearest" });
  }, [selected, mention]);
  useEffect(() => {
    const el = input.current;
    if (!focus || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollIntoView({ block: "nearest" });
  }, [focus]);
  const seen = useRef({ value: "", caret: -1 });
  const updateMention = (value: string, caret: number) => {
    seen.current = { value, caret };
    setMention(mentionAt(value, caret));
    setActive(0);
  };
  /** The caret moved: a key that only closed the picker (Escape) leaves it closed. */
  const follow = (value: string, caret: number) => {
    if (seen.current.value !== value || seen.current.caret !== caret) updateMention(value, caret);
  };
  const pick = (agent: Agent) => {
    if (!mention) return;
    const next = insertMention(text, mention, mentionToken(agent, roster, task.project_id));
    onChange(next.text);
    setMention(undefined);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const send = async () => {
    if (sending || !text.trim()) return;
    setSending(true);
    try {
      if (await commentTask(task.id, text.trim())) {
        onChange("");
        onSent?.();
      }
    } finally {
      setSending(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!mention || e.nativeEvent.isComposing) return false;
    if (e.key === "Escape") {
      e.preventDefault();
      setMention(undefined);
      return true;
    }
    if (choices.length && ["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      setActive((selected + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
      return true;
    }
    const choice = choices[selected];
    if (choice && ["Enter", "Tab"].includes(e.key) && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      pick(choice);
      return true;
    }
    return false;
  };
  /** The @ button: an @ at the caret (after a space), with the picker open. */
  const startMention = () => {
    const el = input.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const at = `${before && !/\s$/.test(before) ? " " : ""}@`;
    const next = before + at + text.slice(caret);
    onChange(next);
    updateMention(next, caret + at.length);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret + at.length, caret + at.length);
    });
  };
  return (
    <div className="taskpanel__comment">
      <Composer
        className="taskpanel__composer"
        inputRef={input}
        inputLabel={t("tasks.comment")}
        placeholder={t("tasks.commentHint")}
        labels={{ send: t("tasks.send") }}
        value={text}
        disabled={sending}
        onValueChange={(value) => {
          onChange(value);
          updateMention(value, input.current?.selectionStart ?? value.length);
        }}
        onSubmit={() => void send()}
        onInputKeyDown={onKey}
        onInputSelect={(e) => follow(e.currentTarget.value, e.currentTarget.selectionStart)}
        onInputBlur={() => setMention(undefined)}
        inputAria={{
          controls: listId,
          expanded: Boolean(mention),
          ...(mention && choices.length ? { activedescendant: `${listId}-${selected}` } : {}),
        }}
        toolbar={
          <IconButton
            size="sm"
            label={t("tasks.mentionAgents")}
            icon={<Icons.AtSign size={14} />}
            onMouseDown={(e) => e.preventDefault()}
            onClick={startMention}
          />
        }
        popup={
          mention && (
            <div className="taskmentions" ref={list} id={listId} role="listbox" aria-label={t("tasks.mentionAgents")}>
              {choices.map((agent, i) => (
                <button
                  type="button"
                  role="option"
                  id={`${listId}-${i}`}
                  key={agent.id}
                  aria-selected={i === selected}
                  className={`taskmentions__option${i === selected ? " is-active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(agent)}
                >
                  <AgentAvatar name={agent.name} blob={blobOf(agent)} size={20} animated={false} />
                  <span>{agent.name}</span>
                  <span className="taskmentions__slug">@{agent.slug ?? agent.id}</span>
                </button>
              ))}
              {choices.length === 0 && <p className="taskmentions__empty">{t("tasks.mentionEmpty")}</p>}
            </div>
          )
        }
      />
    </div>
  );
}
