import type { Person, TaskKind, TaskPriority } from "@apx/protocol";
import { ChannelIcon, DatePicker, Icons, SegmentedControl, Select } from "@apx/ui";
import { useEffect } from "react";
import { SearchSelect } from "../common/pickers/SearchSelect.tsx";
import { loadChannels, useChannels } from "../data/channels.ts";
import { currentLocale, type MessageKey, useT } from "../i18n/index.ts";
import { duePresets, REMINDERS, type Reminder } from "./when.ts";

export const KINDS: readonly TaskKind[] = ["task", "commitment", "errand"];
export const PRIORITIES: readonly TaskPriority[] = ["urgent", "high", "normal", "low"];

const KIND_KEY: Record<TaskKind, MessageKey> = {
  task: "tasks.type.task",
  commitment: "tasks.type.commitment",
  errand: "tasks.type.errand",
};
export const PRIORITY_KEY: Record<TaskPriority, MessageKey> = {
  urgent: "tasks.priority.urgent",
  high: "tasks.priority.high",
  normal: "tasks.priority.normal",
  low: "tasks.priority.low",
};
const REMINDER_KEY: Record<Reminder, MessageKey> = {
  due: "tasks.remind.due",
  hour: "tasks.remind.hour",
  day: "tasks.remind.day",
  custom: "tasks.remind.custom",
};

export function kindLabel(kind: TaskKind, t: ReturnType<typeof useT>) {
  return t(KIND_KEY[kind]);
}

/** A task, a commitment with someone, or an errand for the way. */
export function KindControl({ value, onChange }: { value: TaskKind; onChange: (k: TaskKind) => void }) {
  const t = useT();
  return (
    <SegmentedControl
      size="sm"
      label={t("tasks.type")}
      value={value}
      onValueChange={(v) => onChange(v as TaskKind)}
      options={KINDS.map((k) => ({ value: k, label: t(KIND_KEY[k]) }))}
    />
  );
}

/** A colored dot per priority (urgent red … low gray). */
export function PriorityDot({ priority }: { priority: TaskPriority }) {
  return <span className={`prio-dot is-${priority}`} aria-hidden="true" />;
}

export function PrioritySelect({
  value,
  onChange,
  size,
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
  size?: "sm" | "md";
}) {
  const t = useT();
  return (
    <Select
      label={t("tasks.priority")}
      size={size ?? "md"}
      value={value}
      onValueChange={(v) => v && onChange(v as TaskPriority)}
      options={PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_KEY[p]), icon: <PriorityDot priority={p} /> }))}
    />
  );
}

/** The contact on the other side of a commitment (never the owner or a blocked person). */
export function PersonSelect({
  value,
  onChange,
  size,
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  size?: "sm" | "md";
}) {
  const t = useT();
  const persons = useChannels((s) => s.persons);
  const ready = useChannels((s) => s.ready);
  useEffect(() => {
    if (!ready) void loadChannels();
  }, [ready]);
  const channels = useChannels((s) => s.channels);
  const contacts = persons.filter((p) => p.role !== "owner" && p.role !== "blocked");
  /** The kinds of channel a contact is on (an address names its channel; one per kind today). */
  const kindsOf = (p: Person) => [
    ...new Set(p.addresses.map((a) => channels.find((c) => c.id === a.channel)?.type ?? a.channel)),
  ];
  return (
    <SearchSelect
      label={t("commitments.person.label")}
      searchPlaceholder={t("pickers.searchContact")}
      emptyLabel={t("pickers.noMatch")}
      size={size ?? "md"}
      value={value ?? null}
      placeholder={contacts.length ? t("commitments.pickPerson") : t("commitments.noContacts")}
      disabled={!contacts.length}
      options={contacts.map((p) => {
        const kinds = kindsOf(p);
        return {
          value: p.id,
          label: p.name,
          icon: <Icons.User size={14} />,
          ...(p.nickname && p.nickname !== p.name ? { hint: p.nickname } : {}),
          ...(kinds.length
            ? {
                trailing: kinds.map((k) => <ChannelIcon key={k} channel={k} size={13} label={k} />),
                keywords: kinds.join(" "),
              }
            : {}),
        };
      })}
      onValueChange={(v) => onChange(v ?? undefined)}
    />
  );
}

/** Who owes it: the owner promised it, or the person did. */
export function OwedByControl({
  value,
  onChange,
}: {
  value: "owner" | "person";
  onChange: (v: "owner" | "person") => void;
}) {
  const t = useT();
  return (
    <SegmentedControl
      size="sm"
      label={t("commitments.who")}
      value={value}
      onValueChange={(v) => onChange(v as "owner" | "person")}
      options={[
        { value: "owner", label: t("commitments.owner") },
        { value: "person", label: t("commitments.person") },
      ]}
    />
  );
}

/** Translated labels of the shared date pickers. */
export function useDateLabels() {
  const t = useT();
  return {
    placeholder: t("date.none"),
    clear: t("date.clear"),
    prevMonth: t("date.prevMonth"),
    nextMonth: t("date.nextMonth"),
    time: t("date.time"),
  };
}

/** The due date: a day (09:00) or a day and time, with today / tomorrow / next Monday. */
export function DueField({
  value,
  onChange,
  size,
  label,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  size?: "sm" | "md";
  /** Its name and, with no date, its text (a commitment's "New date"). */
  label?: string;
}) {
  const t = useT();
  const labels = useDateLabels();
  const names = { today: t("date.today"), tomorrow: t("date.tomorrow"), monday: t("date.nextMonday") };
  return (
    <DatePicker
      label={label ?? t("commitments.due")}
      size={size ?? "md"}
      value={value}
      onValueChange={onChange}
      withTime
      locale={currentLocale()}
      labels={label ? { ...labels, placeholder: label } : labels}
      presets={duePresets().map((p) => ({ label: names[p.key], value: p.value }))}
    />
  );
}

/** When to remind: when due, an hour or a day before, or another moment (its own picker). */
export function ReminderField({
  due,
  choice,
  custom,
  onChange,
  size,
}: {
  due: string | undefined;
  choice: Reminder;
  custom: string | undefined;
  onChange: (choice: Reminder, custom: string | undefined) => void;
  size?: "sm" | "md";
}) {
  const t = useT();
  const labels = useDateLabels();
  const choices = due ? REMINDERS : (["custom"] as const);
  return (
    <div className="taskform__remind">
      {due && (
        <Select
          label={t("tasks.reminder")}
          size={size ?? "md"}
          value={choice}
          onValueChange={(v) => v && onChange(v as Reminder, custom)}
          options={choices.map((c) => ({ value: c, label: t(REMINDER_KEY[c]), icon: <Icons.Bell size={14} /> }))}
        />
      )}
      {(choice === "custom" || !due) && (
        <DatePicker
          label={t("tasks.reminder")}
          size={size ?? "md"}
          value={custom}
          onValueChange={(v) => onChange("custom", v)}
          withTime
          locale={currentLocale()}
          labels={{ ...labels, placeholder: t("tasks.remind.none") }}
        />
      )}
    </div>
  );
}
