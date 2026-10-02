import type { Task } from "@apx/protocol";
import { Badge, Button, Icons, Input, Menu, SegmentedControl } from "@apx/ui";
import { useEffect, useState } from "react";
import { aheadLabel, shortWhen } from "../common/format.ts";
import { loadChannels, useChannels } from "../data/channels.ts";
import { useT } from "../i18n/index.ts";

/** Who and when, on a card: "Ana owes you · due Fri 09:00" (red once overdue). */
export function CommitmentMeta({ task }: { task: Task }) {
  const t = useT();
  const overdue = task.state === "open" && task.due_at && task.due_at < new Date().toISOString();
  return (
    <>
      {task.person_name && (
        <Badge tone="violet">
          {task.owed_by === "person"
            ? t("commitments.theyOwe", { name: task.person_name })
            : t("commitments.youOwe", { name: task.person_name })}
        </Badge>
      )}
      {task.due_at && (
        <Badge tone={overdue ? "danger" : "neutral"}>
          <Icons.Calendar size={11} />
          {overdue ? shortWhen(task.due_at) : aheadLabel(task.due_at)}
        </Badge>
      )}
    </>
  );
}

export type CommitmentDraft = { person?: string | undefined; owed_by: "owner" | "person"; due?: string | undefined };

/** `<input type="date">` value (local day) of a moment. */
export const dayOf = (iso: string | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Person, who owes it and the due day: what makes a task a commitment. */
export function CommitmentFields({
  value,
  onChange,
}: {
  value: CommitmentDraft;
  onChange: (v: CommitmentDraft) => void;
}) {
  const t = useT();
  const persons = useChannels((s) => s.persons);
  const ready = useChannels((s) => s.ready);
  useEffect(() => {
    if (!ready) void loadChannels();
  }, [ready]);
  const contacts = persons.filter((p) => p.role !== "owner" && p.role !== "blocked");
  const current = contacts.find((p) => p.id === value.person);
  return (
    <div className="tgtoken commitment">
      <Menu
        trigger={
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Icons.User size={14} />}
            trailingIcon={<Icons.ChevronDown size={14} />}
          >
            {current?.name ?? t("commitments.noPerson")}
          </Button>
        }
        items={[
          { label: t("commitments.noPerson"), onSelect: () => onChange({ ...value, person: undefined }) },
          ...(contacts.length ? [{ type: "separator" as const }] : []),
          ...contacts.map((p) => ({ label: p.name, onSelect: () => onChange({ ...value, person: p.id }) })),
        ]}
      />
      {value.person && (
        <SegmentedControl
          size="sm"
          label={t("commitments.who")}
          value={value.owed_by}
          onValueChange={(v) => onChange({ ...value, owed_by: v as "owner" | "person" })}
          options={[
            { value: "owner", label: t("commitments.owner") },
            { value: "person", label: t("commitments.person") },
          ]}
        />
      )}
      <DueInput value={value.due} onCommit={(due) => onChange({ ...value, due })} />
    </div>
  );
}

/** A day picker that commits once the owner leaves it (or presses Enter), never on every typed digit. */
function DueInput({ value, onCommit }: { value: string | undefined; onCommit: (day: string | undefined) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const commit = () => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(draft) && draft >= "2000" ? draft : undefined;
    if (day !== value && (day || !draft)) onCommit(day);
    else setDraft(value ?? "");
  };
  return (
    <Input
      type="date"
      aria-label={t("commitments.due")}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}
