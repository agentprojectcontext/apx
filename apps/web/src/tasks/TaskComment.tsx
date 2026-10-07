import type { Agent, Task } from "@apx/protocol";
import { AgentAvatar, Button, Textarea } from "@apx/ui";
import { useId, useRef, useState } from "react";
import { availableAgents } from "../common/pickers/agents.ts";
import { blobOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { commentTask } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { insertMention, type Mention, mentionAt, mentionToken } from "./mentions.ts";

export function TaskComment({ task, text, onChange }: { task: Task; text: string; onChange: (text: string) => void }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const input = useRef<HTMLTextAreaElement>(null);
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
  const updateMention = (value: string, caret: number) => {
    setMention(mentionAt(value, caret));
    setActive(0);
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
      if (await commentTask(task.id, text.trim())) onChange("");
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="taskpanel__comment">
      <label className="taskpanel__commentlabel" htmlFor={`${listId}-input`}>
        {t("tasks.comment")}
      </label>
      <div className="taskpanel__input">
        {mention && (
          <div className="taskmentions" id={listId} role="listbox" aria-label={t("tasks.mentionAgents")}>
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
        )}
        <Textarea
          ref={input}
          id={`${listId}-input`}
          rows={2}
          placeholder={t("tasks.commentHint")}
          value={text}
          disabled={sending}
          aria-autocomplete="list"
          aria-controls={mention ? listId : undefined}
          aria-activedescendant={mention && choices.length ? `${listId}-${selected}` : undefined}
          onChange={(e) => {
            onChange(e.currentTarget.value);
            updateMention(e.currentTarget.value, e.currentTarget.selectionStart);
          }}
          onClick={(e) => updateMention(text, e.currentTarget.selectionStart)}
          onKeyUp={(e) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              updateMention(text, e.currentTarget.selectionStart);
          }}
          onBlur={() => setMention(undefined)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (mention && e.key === "Escape") {
              e.preventDefault();
              setMention(undefined);
            } else if (mention && choices.length && ["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              setActive((selected + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
            } else if (mention && choices[selected] && ["Enter", "Tab"].includes(e.key) && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              pick(choices[selected]);
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
      </div>
      <Button size="sm" disabled={sending || !text.trim()} onClick={() => void send()}>
        {t("tasks.send")}
      </Button>
    </div>
  );
}
