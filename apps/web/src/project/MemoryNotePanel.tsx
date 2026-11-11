import type { Memory } from "@apx/protocol";
import { AgentAvatar, Badge, Button, IconButton, Icons, Textarea } from "@apx/ui";
import { useState } from "react";
import { Drawer } from "../common/Drawer.tsx";
import { shortWhen } from "../common/format.ts";
import { client } from "../data/client.ts";
import { blobOf, type ProjectEntry } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { MemoryHistory } from "./MemoryHistory.tsx";
import { SubBadge } from "./subScope.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What a note is, as one word or two: its kind when it has one. */
export function useKindLabel(): (note: Memory) => string {
  const t = useT();
  return (note) => t(note.kind ? (`memory.kind.${note.kind}` as MessageKey) : "memory.kindLabel");
}

/** Who wrote the note: the owner, APX v1, or the agent with its face. */
export function NoteAuthor({ note }: { note: Memory }) {
  const t = useT();
  const author = useData((s) => (note.author_agent ? s.agents[note.author_agent] : undefined));
  if (note.source === "owner") return <span className="memory__by">{t("memory.byYou")}</span>;
  if (note.source === "imported")
    return (
      <span className="memory__by" title={t("memory.fromV1Hint")}>
        {t("memory.fromV1")}
      </span>
    );
  return (
    <span className="memory__by">
      {author && <AgentAvatar name={author.name} blob={blobOf(author)} size={16} />}
      {author?.name ?? note.author_agent ?? t("memory.byAgent")}
    </span>
  );
}

/** The badges a note carries: waiting for the owner, whose notebook. */
export function NoteBadges({ note }: { note: Memory }) {
  const t = useT();
  const owner = useData((s) => (note.agent_id ? s.agents[note.agent_id] : undefined));
  return (
    <>
      {note.pending && !note.forgotten_at && (
        <Badge tone="info" title={t("memory.pendingHint")}>
          {t("memory.pending")}
        </Badge>
      )}
      {owner && <Badge>{t("memory.notebookOf", { name: owner.name })}</Badge>}
    </>
  );
}

/**
 * One note beside the list: its whole text and everything done with it — edit, confirm, forget or bring back, the chat
 * it was learned in, its sources and revisions, and a review with an agent.
 */
export function MemoryNotePanel({
  note,
  sub,
  reviewerName,
  onReview,
  onChanged,
  onClose,
}: {
  note: Memory;
  sub: ProjectEntry | undefined;
  /** The agent that reviews this note with the owner, when there is one. */
  reviewerName: string | undefined;
  onReview: () => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const kind = useKindLabel();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const forgotten = Boolean(note.forgotten_at);
  const act = (call: () => Promise<unknown>) => async () => {
    try {
      await call();
      onChanged();
    } catch (e) {
      notify(t("error.memory", { error: errText(e) }));
    }
  };
  const save = act(async () => {
    await client.call("memory.add", { id: note.id, text, scope: note.scope });
    setEditing(false);
  });
  const edit = () => {
    setText(note.text);
    setEditing(true);
  };
  return (
    <Drawer
      docked
      className="memnote"
      label={t("memory.panel.label")}
      title={kind(note)}
      onClose={onClose}
      actions={
        <div className="memnote__tools">
          {!forgotten && !editing && (
            <IconButton size="sm" label={t("memory.edit")} icon={<Icons.Pencil size={14} />} onClick={edit} />
          )}
          {forgotten ? (
            <IconButton
              size="sm"
              label={t("memory.deleteForever")}
              icon={<Icons.Trash2 size={14} />}
              onClick={() => void act(() => client.call("memory.remove", { id: note.id, forever: true }))()}
            />
          ) : (
            <IconButton
              size="sm"
              label={t("memory.remove")}
              icon={<Icons.Trash2 size={14} />}
              onClick={() => void act(() => client.call("memory.remove", { id: note.id }))()}
            />
          )}
        </div>
      }
    >
      {editing ? (
        <div className="memory__edit">
          <Textarea
            aria-label={t("memory.addLabel")}
            rows={6}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <div className="memory__editbar">
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" disabled={!text.trim()} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="memnote__text">{note.text}</p>
      )}
      <div className="memory__meta memnote__meta">
        <NoteBadges note={note} />
        {sub && <SubBadge project={sub} />}
        <NoteAuthor note={note} />
        <span>
          {forgotten
            ? t("memory.panel.forgotten", { when: shortWhen(note.forgotten_at ?? note.updated_at) })
            : t("memory.panel.updated", { when: shortWhen(note.updated_at) })}
        </span>
      </div>
      <div className="memnote__actions">
        {forgotten ? (
          <Button size="sm" onClick={() => void act(() => client.call("memory.restore", { id: note.id }))()}>
            {t("memory.restore")}
          </Button>
        ) : (
          <>
            {note.pending && (
              <Button size="sm" onClick={() => void act(() => client.call("memory.confirm", { id: note.id }))()}>
                {t("memory.confirm")}
              </Button>
            )}
            {reviewerName && (
              <Button size="sm" variant="secondary" leadingIcon={<Icons.MessageCircle size={14} />} onClick={onReview}>
                {t("memory.review.with", { name: reviewerName })}
              </Button>
            )}
          </>
        )}
        {note.thread_id && (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Icons.MessageSquare size={14} />}
            onClick={() => go.thread(note.thread_id as string)}
          >
            {t("memory.origin")}
          </Button>
        )}
      </div>
      <MemoryHistory note={note} onChanged={onChanged} />
    </Drawer>
  );
}
