import type { Memory, MemoryScope } from "@apx/protocol";
import { Button, Icons, SearchField, SegmentedControl, Textarea } from "@apx/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { client } from "../data/client.ts";
import { isPending, type ProjectEntry, teamOf } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { MemoryNotePanel, NoteAuthor, NoteBadges, useKindLabel } from "./MemoryNotePanel.tsx";
import { MemoryReviewChat } from "./MemoryReviewChat.tsx";
import { closeReview, keepReview, openReview, type ReviewOf, type ReviewShelf, reviewerOf } from "./memoryReview.ts";
import { ProjectEmpty } from "./ProjectEmpty.tsx";
import { SubBadge, useSubScope } from "./subScope.tsx";

type Filter = "project" | "agents" | "global" | "forgotten";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Beside the list: one note, or the chat reviewing the notes (opened from a note, it steps back to it). */
type Side = { note: string } | { chat: string; of: ReviewOf };

/**
 * What the project's agents remember: notes about this project (and its subprojects), each agent's notebook and the
 * owner's global notes. A note opens beside the list; an agent can go through them with the owner in a chat there.
 */
export function ProjectMemory({ project }: { project: ProjectEntry }) {
  return usePack("memory") ? <MemoryBody project={project} /> : null;
}

function MemoryBody({ project }: { project: ProjectEntry }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const team = useMemo(() => teamOf(agents, project.id), [agents, project.id]);
  const [filter, setFilter] = useState<Filter>(project.isDefault ? "global" : "project");
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<Memory[] | undefined>();
  const { subs, subOf } = useSubScope(project);
  const subIds = subs.map((p) => p.id).join(",");

  const load = useCallback(async () => {
    const q = query.trim() ? { query: query.trim() } : {};
    try {
      const scope: MemoryScope | undefined =
        filter === "agents" ? "agent" : filter === "forgotten" ? undefined : filter;
      const list = async (projectId?: string) =>
        (
          await client.call("memory.list", {
            ...(scope ? { scope } : { forgotten: true }),
            ...(projectId ? { project: projectId } : {}),
            ...q,
            limit: 500,
          })
        ).memories;
      // A project's notes come with its subprojects', newest first.
      const memories =
        filter === "project"
          ? (await Promise.all([project.id, ...(subIds ? subIds.split(",") : [])].map((id) => list(id))))
              .flat()
              .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          : await list();
      const ids = new Set(team.map((a) => a.id));
      const shown = filter === "agents" ? memories.filter((m) => m.agent_id && ids.has(m.agent_id)) : memories;
      // What waits for the owner comes first, so it is seen before the notes that already stand.
      setNotes([...shown].sort((a, b) => Number(Boolean(b.pending)) - Number(Boolean(a.pending))));
    } catch (e) {
      setNotes([]);
      notify(t("error.memory", { error: errText(e) }));
    }
  }, [filter, query, project.id, subIds, team, t]);

  useEffect(() => {
    const id = setTimeout(() => void load(), query ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, query]);

  const [side, setSide] = useState<Side>();
  const shown = side && "note" in side ? notes?.find((m) => m.id === side.note) : undefined;
  // A note that left the list (forgotten, another filter) closes its panel.
  useEffect(() => {
    if (side && "note" in side && notes && !shown) setSide(undefined);
  }, [side, notes, shown]);
  const shelf: ReviewShelf | undefined = filter === "project" || filter === "global" ? filter : undefined;
  const placeOf = (note?: Memory): ReviewOf => {
    const on = note ? (note.scope as ReviewShelf) : (shelf ?? "project");
    const projectId = on === "global" ? undefined : (note?.project_id ?? (project.isDefault ? undefined : project.id));
    return { shelf: on, projectId, ...(note ? { note } : {}) };
  };
  const nameOf = (of: ReviewOf) => {
    const id = reviewerOf(of);
    return id ? agents[id]?.name : undefined;
  };
  const review = async (of: ReviewOf, restart = false) => {
    if (side && "chat" in side) closeReview(side.chat);
    const chat = await openReview(of, restart);
    if (chat) setSide({ chat, of });
  };
  const closeChat = (chat: string, to?: Side) => {
    closeReview(chat);
    setSide(to);
  };
  const tabReviewer = shelf ? nameOf(placeOf()) : undefined;
  // Each turn of the review may have changed notes: the list reads again when one ends.
  const reviewing = useData((s) => (side && "chat" in side ? isPending(s.threads[side.chat]?.state) : false));
  const wasReviewing = useRef(false);
  useEffect(() => {
    if (wasReviewing.current && !reviewing) void load();
    wasReviewing.current = reviewing;
  }, [reviewing, load]);

  const options = [
    ...(project.isDefault ? [] : [{ value: "project", label: t("memory.filter.project") }]),
    { value: "agents", label: t("memory.filter.agents") },
    { value: "global", label: t("memory.filter.global") },
    { value: "forgotten", label: t("memory.filter.forgotten") },
  ];

  return (
    <div className="memory memory--notes">
      <div className="team__head">
        <div className="team__titles">
          <div className="team__note">{t(`memory.lead.${filter}`)}</div>
        </div>
        <SegmentedControl
          size="sm"
          label={t("memory.view")}
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          options={options}
        />
        {tabReviewer && (
          <Button
            size="sm"
            className="memory__reviewbtn"
            variant="secondary"
            leadingIcon={<Icons.MessageCircle size={14} />}
            onClick={() => void review(placeOf())}
          >
            {t("memory.review.with", { name: tabReviewer })}
          </Button>
        )}
      </div>

      {!project.isDefault && filter === "project" && (
        <div className="memory__file">
          <Icons.FileText size={14} />
          <span>
            {t("memory.fileBefore")}
            <code>.apc/memory.md</code>
            {t("memory.fileAfter")}
          </span>
        </div>
      )}

      {filter !== "forgotten" && <PendingBar notes={notes} onConfirmed={load} />}

      <SearchField
        size="sm"
        placeholder={t("memory.search")}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />

      {notes && !notes.length ? (
        <ProjectEmpty name={project.name}>
          {query ? t("memory.noMatch") : filter === "project" ? undefined : t(`memory.empty.${filter}`)}
        </ProjectEmpty>
      ) : (
        <ul className="memory__list" aria-label={t("project.tab.memory")}>
          {notes?.map((m) => (
            <NoteRow
              key={m.id}
              note={m}
              sub={subOf(m.project_id)}
              selected={shown?.id === m.id}
              onOpen={() => {
                if (side && "chat" in side) closeReview(side.chat);
                setSide(shown?.id === m.id ? undefined : { note: m.id });
              }}
            />
          ))}
        </ul>
      )}
      {(filter === "project" || filter === "global") && (
        <AddNote key={filter} scope={filter} projectId={project.id} onAdded={load} />
      )}
      {shown && (
        <MemoryNotePanel
          key={`${shown.id}:${shown.revision ?? 0}`}
          note={shown}
          sub={subOf(shown.project_id)}
          reviewerName={shown.forgotten_at ? undefined : nameOf(placeOf(shown))}
          onReview={() => void review(placeOf(shown))}
          onChanged={load}
          onClose={() => setSide(undefined)}
        />
      )}
      {side && "chat" in side && (
        <MemoryReviewChat
          key={side.chat}
          threadId={side.chat}
          {...(side.of.note ? { back: () => closeChat(side.chat, { note: side.of.note?.id ?? "" }) } : {})}
          onClose={() => closeChat(side.chat)}
          onOpen={() => {
            keepReview(side.chat);
            setSide(undefined);
            go.thread(side.chat);
          }}
          onRestart={() => void review(side.of, true)}
        />
      )}
    </div>
  );
}

/** The notes agents learned about the owner that wait for them, confirmed in one go. */
function PendingBar({ notes, onConfirmed }: { notes: Memory[] | undefined; onConfirmed: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const ids = (notes ?? []).filter((m) => m.pending && !m.forgotten_at).map((m) => m.id);
  if (!ids.length) return null;
  const confirm = async () => {
    setBusy(true);
    try {
      await client.call("memory.confirm_all", { ids });
      onConfirmed();
    } catch (e) {
      notify(t("error.memory", { error: errText(e) }));
    }
    setBusy(false);
  };
  return (
    <div className="memory__file memory__pending">
      <Icons.Brain size={14} />
      <span className="memory__pending-text">{t("memory.pendingBar", { n: ids.length })}</span>
      <Button size="sm" loading={busy} onClick={() => void confirm()}>
        {t("memory.confirmAll")}
      </Button>
    </div>
  );
}

function AddNote({
  scope,
  projectId,
  onAdded,
}: {
  scope: "project" | "global";
  projectId: string;
  onAdded: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  // Opening the editor puts the cursor in it, so the keyboard does not lose its place.
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await client.call("memory.add", { text, scope, ...(scope === "project" ? { project: projectId } : {}) });
      setText("");
      setOpen(false);
      onAdded();
    } catch (e) {
      notify(t("error.memory", { error: errText(e) }));
    }
    setBusy(false);
  };
  // A button at the end of the list; the editor opens in place.
  if (!open)
    return (
      <Button
        variant="ghost"
        size="sm"
        className="memory__addbtn"
        leadingIcon={<Icons.Plus size={14} />}
        onClick={() => setOpen(true)}
      >
        {t("memory.add")}
      </Button>
    );
  return (
    <div className="memory__add">
      <Textarea
        ref={field}
        aria-label={t("memory.addLabel")}
        rows={3}
        value={text}
        placeholder={t(`memory.addPlaceholder.${scope}`)}
        onChange={(e) => setText(e.currentTarget.value)}
      />
      <div className="memory__editbar">
        <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" disabled={!text.trim()} loading={busy} onClick={() => void add()}>
          {t("memory.add")}
        </Button>
      </div>
    </div>
  );
}

/** One note in the list: the Brain tile, its first lines, what it is and who wrote it, its subproject and date. */
function NoteRow({
  note,
  sub,
  selected,
  onOpen,
}: {
  note: Memory;
  sub: ProjectEntry | undefined;
  selected: boolean;
  onOpen: () => void;
}) {
  const kind = useKindLabel();
  return (
    <li className={selected ? "memory__row memrow is-selected" : "memory__row memrow"}>
      {/* ui: the whole row opens the note beside the list, as an artifact's card does. */}
      <button type="button" className="memrow__open" aria-expanded={selected} onClick={onOpen}>
        <span className="memrow__tile" aria-hidden="true">
          <Icons.Brain size={14} />
        </span>
        <span className="memrow__body">
          <span className="memory__text">{note.text}</span>
          <span className="memory__meta">
            <span>{kind(note)}</span>
            <NoteBadges note={note} />
            <NoteAuthor note={note} />
          </span>
        </span>
        {sub && <SubBadge project={sub} />}
        <span className="memrow__when">{shortWhen(note.forgotten_at ?? note.updated_at)}</span>
      </button>
    </li>
  );
}
