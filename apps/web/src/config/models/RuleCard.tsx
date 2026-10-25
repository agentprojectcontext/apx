import type { RouterRule } from "@apx/protocol";
import { IconButton, Icons, Input, SegmentedControl } from "@apx/ui";
import { type ReactNode, useState } from "react";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { ModelRefPicker } from "./ModelRefPicker.tsx";

type When = RouterRule["when"];

/** What starts a turn, as the core names it. Protocol values, not model names. */
const TRIGGERS = ["user", "a2a", "a2a_result", "surface", "channel", "routine", "system"] as const;
const TRIGGER_KEY: Record<(typeof TRIGGERS)[number], MessageKey> = {
  user: "router.trigger.user",
  a2a: "router.trigger.a2a",
  a2a_result: "router.trigger.a2a_result",
  surface: "router.trigger.surface",
  channel: "router.trigger.channel",
  routine: "router.trigger.routine",
  system: "router.trigger.system",
};
const KINDS = ["secretary", "agent"] as const;
const KIND_KEY: Record<(typeof KINDS)[number], MessageKey> = {
  secretary: "router.kind.secretary",
  agent: "router.kind.agent",
};

/** Drops empty conditions so a cleared field means "any", as the core reads it. */
export function cleanWhen(w: When): When {
  const out: When = {};
  for (const [k, v] of Object.entries(w) as [keyof When, When[keyof When]][]) {
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    Object.assign(out, { [k]: v });
  }
  return out;
}

const toggle = <T extends string>(list: readonly T[] | undefined, v: T): T[] =>
  list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v];

const num = (s: string): number | undefined => {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export type RuleCardProps = {
  rule: RouterRule;
  index: number;
  count: number;
  onChange: (rule: RouterRule) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
};

/** One router rule: every condition set must hold, then the turn uses `model`. */
export function RuleCard({ rule, index, count, onChange, onMove, onRemove }: RuleCardProps) {
  const t = useT();
  const w = rule.when;
  const set = (patch: Partial<When>) => onChange({ ...rule, when: cleanWhen({ ...w, ...patch }) });
  const empty = Object.keys(cleanWhen(w)).length === 0;
  return (
    <li className="rule">
      <div className="rule__head">
        <span className="rule__n">{index + 1}</span>
        <Input
          size="sm"
          className="rule__note"
          placeholder={t("router.note")}
          aria-label={t("router.note")}
          maxLength={200}
          value={rule.note ?? ""}
          onChange={(e) => onChange({ ...rule, note: e.currentTarget.value || undefined })}
        />
        <IconButton
          size="sm"
          label={t("router.moveUp")}
          icon={<Icons.ArrowUp size={14} />}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        />
        <IconButton
          size="sm"
          label={t("router.moveDown")}
          icon={<Icons.ArrowDown size={14} />}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        />
        <IconButton size="sm" label={t("router.removeRule")} icon={<Icons.Trash2 size={14} />} onClick={onRemove} />
      </div>
      <div className="rule__grid">
        <Field label={t("router.hasImage")}>
          <SegmentedControl
            size="sm"
            label={t("router.hasImage")}
            value={w.has_image === undefined ? "any" : w.has_image ? "yes" : "no"}
            onValueChange={(v) => set({ has_image: v === "any" ? undefined : v === "yes" })}
            options={[
              { value: "any", label: t("router.any") },
              { value: "yes", label: t("router.yes") },
              { value: "no", label: t("router.no") },
            ]}
          />
        </Field>
        <Field label={t("router.messageChars")}>
          <NumberBox label={t("router.min")} value={w.min_chars} onChange={(min_chars) => set({ min_chars })} />
          <span className="rule__dash">–</span>
          <NumberBox label={t("router.max")} value={w.max_chars} onChange={(max_chars) => set({ max_chars })} />
        </Field>
        <Field label={t("router.contextChars")}>
          <NumberBox
            label={t("router.min")}
            value={w.min_context_chars}
            onChange={(min_context_chars) => set({ min_context_chars })}
          />
        </Field>
        <Field label={t("router.triggers")}>
          {TRIGGERS.map((tr) => (
            <Chip
              key={tr}
              on={Boolean(w.triggers?.includes(tr))}
              title={tr}
              onClick={() => set({ triggers: toggle(w.triggers, tr) })}
            >
              {t(TRIGGER_KEY[tr])}
            </Chip>
          ))}
        </Field>
        <Field label={t("router.agentKinds")}>
          {KINDS.map((k) => (
            <Chip
              key={k}
              on={Boolean(w.agent_kinds?.includes(k))}
              onClick={() => set({ agent_kinds: toggle(w.agent_kinds, k) })}
            >
              {t(KIND_KEY[k])}
            </Chip>
          ))}
        </Field>
        <Field label={t("router.channels")}>
          <ListBox label={t("router.channels")} value={w.channels} onChange={(channels) => set({ channels })} />
        </Field>
        <Field label={t("router.keywords")}>
          <ListBox label={t("router.keywords")} value={w.keywords} onChange={(keywords) => set({ keywords })} />
        </Field>
      </div>
      <div className="rule__then">
        <span className="rule__thenlabel">{empty ? t("router.alwaysUse") : t("router.thenUse")}</span>
        <ModelRefPicker
          label={t("router.ruleModel")}
          value={rule.model}
          onChange={(model) => onChange({ ...rule, model })}
        />
      </div>
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rule__field">
      <span className="rule__label">{label}</span>
      <span className="rule__control">{children}</span>
    </div>
  );
}

function Chip(props: { on: boolean; title?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={props.on ? "togglechip is-on" : "togglechip"}
      aria-pressed={props.on}
      title={props.title}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function NumberBox(props: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <Input
      size="sm"
      type="number"
      min={0}
      className="rule__num"
      placeholder={props.label}
      aria-label={props.label}
      value={props.value === undefined ? "" : String(props.value)}
      onChange={(e) => props.onChange(num(e.currentTarget.value))}
    />
  );
}

/** Comma-separated words. Keeps what is typed and reports the parsed list. */
function ListBox(props: { label: string; value: string[] | undefined; onChange: (v: string[]) => void }) {
  const t = useT();
  const joined = (props.value ?? []).join(", ");
  const [text, setText] = useState(joined);
  const parse = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  // Follow outside changes (revert) without fighting the user's commas while typing.
  const shown = parse(text).join(", ") === joined ? text : joined;
  return (
    <Input
      size="sm"
      className="rule__list"
      placeholder={t("router.commaList")}
      aria-label={props.label}
      value={shown}
      onChange={(e) => {
        setText(e.currentTarget.value);
        props.onChange(parse(e.currentTarget.value));
      }}
    />
  );
}
