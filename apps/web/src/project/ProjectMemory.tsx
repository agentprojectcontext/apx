import type { Memory, MemoryScope } from "@apx/protocol";
import {
  AgentAvatar,
  Badge,
  Button,
  EmptyState,
  IconButton,
  Icons,
  SearchField,
  SegmentedControl,
  Textarea,
} from "@apx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { client } from "../data/client.ts";
import { blobOf, type ProjectEntry } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { teamOf } from "./ProjectOverview.tsx";

type Filter = "project" | "agents" | "global";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What the project's agents remember: notes about this project, each agent's notebook and the owner's global notes. */
export function ProjectMemory({ project }: { project: ProjectEntry }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const team = useMemo(() => teamOf(agents, project.id), [agents, project.id]);
  const [filter, setFilter] = useState<Filter>(project.isDefault ? "global" : "project");
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<Memory[] | undefined>();

  const load = useCallback(async () => {
    const q = query.trim() ? { query: query.trim() } : {};
    try {
      const scope: MemoryScope = filter === "agents" ? "agent" : filter;
      const r = await client.call("memory.list", {
        scope,
        ...(filter === "project" ? { project: project.id } : {}),
        ...q,
        limit: 500,
      });
      const ids = new Set(team.map((a) => a.id));
      setNotes(filter === "agents" ? r.memories.filter((m) => m.agent_id && ids.has(m.agent_id)) : r.memories);
    } catch (e) {
      setNotes([]);
      notify(t("error.memory", { error: errText(e) }));
    }
  }, [filter, query, project.id, team, t]);

  useEffect(() => {
    const id = setTimeout(() => void load(), query ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, query]);

  const options = [
    ...(project.isDefault ? [] : [{ value: "project", label: t("memory.filter.project") }]),
    { value: "agents", label: t("memory.filter.agents") },
    { value: "global", label: t("memory.filter.global") },
  ];

  return (
    <div className="memory">
      <div className="team__head">
        <div className="team__titles">
          <div className="team__title">
            {t("project.tab.memory")} {notes && <span className="team__count">{notes.length}</span>}
          </div>
          <div className="team__note">{t(`memory.lead.${filter}`)}</div>
        </div>
        <SegmentedControl
          size="sm"
          label={t("memory.view")}
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          options={options}
        />
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

      <SearchField
        size="sm"
        placeholder={t("memory.search")}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />

      {notes && !notes.length ? (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Brain />}>
          {query ? t("memory.noMatch") : t(`memory.empty.${filter}`)}
        </EmptyState>
      ) : (
        <ul className="memory__list" aria-label={t("project.tab.memory")}>
          {notes?.map((m) => (
            <NoteRow key={m.id} note={m} onChanged={load} />
          ))}
        </ul>
      )}
      {filter !== "agents" && <AddNote key={filter} scope={filter} projectId={project.id} onAdded={load} />}
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

function NoteRow({ note, onChanged }: { note: Memory; onChanged: () => void }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const author = note.author_agent ? agents[note.author_agent] : undefined;
  const owner = note.agent_id ? agents[note.agent_id] : undefined;
  const save = async () => {
    try {
      await client.call("memory.add", { id: note.id, text, scope: note.scope });
      setEditing(false);
      onChanged();
    } catch (e) {
      notify(t("error.memory", { error: errText(e) }));
    }
  };
  const remove = async () => {
    try {
      await client.call("memory.remove", { id: note.id });
      onChanged();
    } catch (e) {
      notify(t("error.memory", { error: errText(e) }));
    }
  };
  return (
    <li className="memory__row">
      {editing ? (
        <div className="memory__edit">
          <Textarea
            aria-label={t("memory.addLabel")}
            rows={2}
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
        <div className="memory__text">{note.text}</div>
      )}
      <div className="memory__meta">
        {note.tainted && (
          <Badge tone="warning" title={t("memory.taintedHint")}>
            {t("memory.tainted")}
          </Badge>
        )}
        {owner && <Badge>{t("memory.notebookOf", { name: owner.name })}</Badge>}
        {note.source === "owner" ? (
          <span className="memory__by">{t("memory.byYou")}</span>
        ) : (
          <span className="memory__by">
            {author && <AgentAvatar name={author.name} blob={blobOf(author)} size={16} />}
            {author?.name ?? note.author_agent ?? t("memory.byAgent")}
          </span>
        )}
        <span className="memory__when">{shortWhen(note.updated_at)}</span>
        <span className="memory__spacer" />
        {!editing && (
          <IconButton
            size="sm"
            label={t("memory.edit")}
            icon={<Icons.Pencil size={14} />}
            onClick={() => setEditing(true)}
          />
        )}
        <IconButton
          size="sm"
          label={t("memory.remove")}
          icon={<Icons.Trash2 size={14} />}
          onClick={() => void remove()}
        />
      </div>
    </li>
  );
}
