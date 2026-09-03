import { useEffect, useState } from "react";
import useSWR from "swr";
import { Tasks } from "../../lib/api";
import { Agents } from "../../lib/api/agents";
import { X } from "lucide-react";
import { Button, Dialog, Field, Input, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { useTaskColumns } from "./useTaskColumns";
import { columnLabel } from "./columns";
import { t } from "../../i18n";
import type { TaskCategory, TaskEntry, TaskLocation } from "../../types/daemon";
import { TASK_CATEGORY_ORDER, categoryIsLocatable, categoryLabel } from "./taskStatus";

/**
 * The one form for a task — creating and editing.
 *
 * A task used to be born from a single-line input and could never be changed
 * afterwards: a typo in the title, a date that moved, the wrong agent, all of
 * it was permanent unless you went back to the CLI. Same dialog for both jobs
 * so what you can set is exactly what you can later fix.
 */
/**
 * "-41.13, -71.31" → a pair, or null.
 *
 * One field rather than two: coordinates are copied out of Maps as a pair and
 * pasted as a pair, and splitting them into two inputs makes the commonest
 * gesture — paste — into two edits and a chance to swap them.
 */
function parseCoords(value: string): { latitude: number; longitude: number } | null {
  const [a, b] = value.split(/[,\s]+/).filter(Boolean);
  const latitude = Number(a);
  const longitude = Number(b);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** Fold a draft into the list: trimmed, no duplicates, no empties. */
function commitTag(list: string[], draft: string): string[] {
  const tag = draft.trim().replace(/^#/, "");
  if (!tag || list.includes(tag)) return list;
  return [...list, tag];
}

export function TaskFormDialog({
  open,
  onClose,
  fixedPid,
  projects,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Project the screen is pinned to. Omitted on the cross-project screen. */
  fixedPid?: string;
  /** Pickable projects — only used when there is no fixedPid. */
  projects?: { id: string | number; name?: string | null; path?: string }[];
  /** Present = edit that task; absent = create a new one. */
  editing?: { pid: string; task: TaskEntry } | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState<string>("pending");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  // What KIND of task, and where. A `trip` is what the mobility geofence
  // considers — without these fields there was no way to create one from the
  // panel at all, so the errand reminders had nothing to remind about.
  const [category, setCategory] = useState<TaskCategory>("general");
  const [place, setPlace] = useState("");
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState("");
  const [radius, setRadius] = useState("");
  // What can be set has to be what exists — the project's own columns, not the
  // four the panel used to hardcode.
  const { statuses } = useTaskColumns(editing?.pid ?? fixedPid);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const pid = editing?.pid ?? fixedPid ?? target;
  const locatable = categoryIsLocatable(category);
  // Typed something that is not a coordinate pair: say so instead of dropping it
  // silently on save.
  const coordsInvalid = coords.trim().length > 0 && !parseCoords(coords);

  // Reset every time the dialog opens so a cancelled edit never leaks into the
  // next one.
  useEffect(() => {
    if (!open) return;
    const task = editing?.task;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setBody(task?.body ?? "");
    setDue(task?.due ? String(task.due).slice(0, 10) : "");
    setAgent(task?.agent ?? "");
    setStatus(task?.status ?? "pending");
    setTags(task?.tags ?? []);
    setTagDraft("");
    setCategory(task?.category ?? "general");
    setPlace(task?.location?.place ?? "");
    setAddress(task?.location?.address ?? "");
    setCoords(
      task?.location?.latitude != null && task?.location?.longitude != null
        ? `${task.location.latitude}, ${task.location.longitude}`
        : "",
    );
    setRadius(task?.location?.radius_m != null ? String(task.location.radius_m) : "");
    setTarget(fixedPid ?? String(projects?.[0]?.id ?? ""));
  }, [open, editing, fixedPid, projects]);

  // Agents belong to a project, so the picker can only be filled once one is
  // chosen. On the cross-project screen that is after the project select.
  const { data: agents } = useSWR(
    open && pid ? `/api/projects/${pid}/agents` : null,
    () => Agents.list(pid),
  );

  const save = async () => {
    if (!title.trim() || !pid) return;
    setBusy(true);
    try {
      // The draft is committed on save too: typing a tag and hitting Save
       // without pressing Enter first used to drop it silently, which is most
       // of why tags never got filled in.
      const allTags = commitTag(tags, tagDraft);
      // A half-filled place is worse than none — the store drops it either way
      // (normalizeTaskLocation), so send the pieces and let it decide.
      const pin = parseCoords(coords);
      const radiusM = Number(radius);
      const location: TaskLocation | null = locatable
        ? {
            ...(place.trim() ? { place: place.trim() } : {}),
            ...(address.trim() ? { address: address.trim() } : {}),
            ...(pin ?? {}),
            ...(Number.isFinite(radiusM) && radiusM > 0 ? { radius_m: radiusM } : {}),
          }
        : null;
      const fields = {
        title: title.trim(),
        description: description.trim() || null,
        body: body.trim() || null,
        due: due || null,
        agent: agent || null,
        tags: allTags,
        category,
        // Switching a trip back to a plain task clears its place rather than
        // leaving a pin on something that is no longer an errand.
        location: location && Object.keys(location).length ? location : null,
      };
      if (editing) {
        await Tasks.patch(pid, editing.task.id, fields);
        // Status is its own event (it is a workflow move, not a field edit) —
        // only send it when it actually changed.
        if (editing.task.state === "open" && status !== (editing.task.status ?? "pending")) {
          await Tasks.status(pid, editing.task.id, status);
        }
        toast.success(t("common.saved"));
      } else {
        await Tasks.add(pid, { ...fields, source: "web" });
        toast.success(t("project.tasks.created"));
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("project.tasks.create_error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? t("tasks.edit_title") : t("project.global_tasks.add_title")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            data-testid="task-add"
            loading={busy}
            disabled={!title.trim() || !pid}
            onClick={save}
          >
            {editing ? t("common.save") : t("project.global_tasks.add")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("project.global_tasks.field_title")}>
          <Input
            data-testid="task-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("project.tasks.add_placeholder")}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          />
        </Field>

        {/* Two fields, not one. The description is what the owner has to do;
            the prompt is what an agent receives if it runs the task. They were
            the same box for a while, labelled "Prompt", and it quietly turned
            the to-do list into a queue of jobs nobody read. */}
        <Field label={t("tasks.field_description")} hint={t("tasks.description_hint")}>
          <Textarea
            data-testid="task-description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("tasks.description_ph")}
          />
        </Field>

        <Field label={t("tasks.field_prompt")} hint={t("tasks.prompt_hint")}>
          <Textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("tasks.prompt_ph")}
            className="text-xs"
          />
        </Field>

        {/* Required on the cross-project screen: there is no "here" to default
            to, and guessing files the task where nobody looked. */}
        {!fixedPid && !editing && (
          <Field label={t("project.global_tasks.field_project")}>
            <UiSelect
              value={String(target)}
              onChange={setTarget}
              options={(projects ?? []).map((p) => ({ value: String(p.id), label: p.name || p.path || String(p.id) }))}
            />
          </Field>
        )}

        {/* WHAT KIND of task. `trip` is the one the mobility geofence watches,
            and it could not be created from the panel — only from the CLI —
            which is why the errand reminders had nothing to remind about. */}
        <Field label={t("tasks.field_category")}>
          <UiSelect
            data-testid="task-category-select"
            value={category}
            onChange={(v) => setCategory(v as TaskCategory)}
            options={TASK_CATEGORY_ORDER.map((c) => ({ value: c, label: categoryLabel(c) }))}
          />
        </Field>

        {locatable && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-[10px] text-muted-fg">{t("tasks.location_hint")}</p>
            <Field label={t("tasks.location_place")}>
              <Input
                data-testid="task-place"
                value={place}
                placeholder={t("tasks.location_place_ph")}
                onChange={(e) => setPlace(e.target.value)}
              />
            </Field>
            <Field label={t("tasks.location_address")}>
              <Input
                data-testid="task-address"
                value={address}
                placeholder={t("tasks.location_address_ph")}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("tasks.location_at")} hint={coordsInvalid ? t("tasks.location_at_invalid") : undefined}>
                <Input
                  data-testid="task-coords"
                  value={coords}
                  placeholder="-41.1335, -71.3103"
                  aria-invalid={coordsInvalid || undefined}
                  onChange={(e) => setCoords(e.target.value)}
                />
              </Field>
              <Field label={t("tasks.location_radius")}>
                <Input
                  type="number"
                  data-testid="task-radius"
                  value={radius}
                  placeholder={t("tasks.location_radius_ph")}
                  onChange={(e) => setRadius(e.target.value)}
                />
              </Field>
            </div>
          </div>
        )}

        {/* Tags were settable from the CLI and the API but NOT here, so the
            filter that reads them had almost nothing to filter. */}
        <Field label={t("tasks.field_tags")} hint={t("tasks.tags_hint")}>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-transparent px-2 py-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px]"
              >
                {tag}
                <button
                  type="button"
                  aria-label={t("tasks.tag_remove", { tag })}
                  data-testid={`task-tag-remove-${tag}`}
                  className="text-muted-fg hover:text-fg"
                  onClick={() => setTags((prev) => prev.filter((x) => x !== tag))}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <input
              value={tagDraft}
              data-testid="task-tags-input"
              placeholder={tags.length ? "" : t("tasks.tags_ph")}
              className="min-w-[6rem] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-fg"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter and comma both commit — people type tags both ways, and
                // Enter must not reach the dialog and submit the whole form.
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  e.stopPropagation();
                  setTags((prev) => commitTag(prev, tagDraft));
                  setTagDraft("");
                } else if (e.key === "Backspace" && !tagDraft) {
                  setTags((prev) => prev.slice(0, -1));
                }
              }}
            />
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("tasks.field_agent")}>
            <UiSelect
              value={agent}
              onChange={setAgent}
              disabled={!pid}
              options={[
                { value: "", label: t("tasks.agent_none") },
                ...(agents ?? []).map((a) => ({ value: a.slug, label: a.name || a.slug })),
              ]}
            />
          </Field>
          <Field label={t("project.global_tasks.field_due")}>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>

        {editing?.task.state === "open" && (
          <Field label={t("tasks.field_status")}>
            <UiSelect
              value={status}
              onChange={setStatus}
              options={statuses.map((c) => ({ value: c.id, label: columnLabel(c) }))}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
