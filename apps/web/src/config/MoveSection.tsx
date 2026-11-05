import type { InstancePlan, InstancePlanItem } from "@apx/protocol";
import { Button, Checkbox, Icons, SettingRow, Skeleton, Tag } from "@apx/ui";
import { type ReactNode, useRef, useState } from "react";
import "../styles/move.css";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { isKey, type MessageKey, type T, useLanguage, usePack, useT } from "../i18n/index.ts";
import { LOCALES } from "../i18n/messages.ts";
import { go } from "../shell/nav.ts";
import { SectionHead } from "./SectionHead.tsx";

const SECTIONS: InstancePlanItem["section"][] = [
  "agents",
  "projects",
  "routines",
  "tables",
  "flows",
  "memory",
  "channels",
  "mcps",
  "providers",
  "settings",
  "skills",
  "chats",
];
const ACTIONS = ["add", "update", "same", "skip"] as const;
const changes = (plan: InstancePlan) => plan.items.filter((i) => i.action === "add" || i.action === "update").length;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Why the core refused a file, in the owner's words; its own message otherwise. */
function refusal(t: T, e: unknown): string {
  const reason = (e as { detail?: { reason?: unknown } }).detail?.reason;
  const key = `move.refused.${String(reason)}`;
  return typeof reason === "string" && isKey(key) ? t(key) : errText(e);
}

/** A preference is named by what it is; the rest keep the name they have (an agent's, a Flow's). */
function label(t: T, i: InstancePlanItem): string {
  if (i.section !== "settings") return i.label;
  const key = `move.setting.${i.id}`;
  return isKey(key) ? t(key) : t("move.setting.other");
}

/** Settings › Move or back up: a copy of this setup to download, and bringing one in after seeing what it changes. */
export function MoveSection() {
  return usePack("move") ? <Move /> : <Skeleton height={240} shape="block" />;
}

function Move() {
  const t = useT();
  const [chats, setChats] = useState(false);
  const [rows, setRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<unknown>();
  const [plan, setPlan] = useState<InstancePlan & { applied?: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  const download = async () => {
    setSaving(true);
    try {
      const r = await client.call("instance.export", { chats, rows });
      const url = URL.createObjectURL(new Blob([JSON.stringify(r.file, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(t("move.export.done", { name: r.name }), "info");
    } catch (e) {
      notify(t("move.export.failed", { error: refusal(t, e) }));
    } finally {
      setSaving(false);
    }
  };

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(undefined);
    setPlan(undefined);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await f.text());
      } catch {
        throw Object.assign(new Error(t("move.refused.unreadable")), { detail: { reason: "unreadable" } });
      }
      setPlan(await client.call("instance.preview_import", { file: parsed }));
      setFile(parsed);
    } catch (e) {
      setError(refusal(t, e));
    } finally {
      setBusy(false);
    }
  };

  const bringIn = async () => {
    setBusy(true);
    try {
      const done = await client.call("instance.import", { file });
      setPlan(done);
      setFile(undefined);
      notify(t("move.import.done", { n: done.applied }), "info");
    } catch (e) {
      notify(t("move.import.failed", { error: refusal(t, e) }));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPlan(undefined);
    setFile(undefined);
    setError(undefined);
  };

  return (
    <>
      <SectionHead title={t("config.move")} lead={t("move.lead")} />
      <SettingRow title={t("move.export.title")} description={t("move.export.hint")}>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.Download size={14} />}
          loading={saving}
          onClick={() => void download()}
        >
          {t("move.export.cta")}
        </Button>
      </SettingRow>
      <div className="move__options">
        <Checkbox
          label={t("move.export.chats")}
          description={t("move.export.chatsHint")}
          checked={chats}
          onCheckedChange={setChats}
        />
        <Checkbox
          label={t("move.export.rows")}
          description={t("move.export.rowsHint")}
          checked={rows}
          onCheckedChange={setRows}
        />
      </div>
      <SettingRow title={t("move.import.title")} description={t("move.import.hint")}>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.Upload size={14} />}
          loading={busy && !plan}
          onClick={() => input.current?.click()}
        >
          {t("move.import.choose")}
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          aria-label={t("move.import.choose")}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            void choose(f);
          }}
        />
      </SettingRow>
      {error && (
        <p className="move__error" role="alert">
          {error}
        </p>
      )}
      {plan && (
        <Preview
          plan={plan}
          done={plan.applied !== undefined}
          busy={busy}
          onImport={() => void bringIn()}
          onCancel={reset}
        />
      )}
    </>
  );
}

function Preview({
  plan,
  done,
  busy,
  onImport,
  onCancel,
}: {
  plan: InstancePlan;
  done: boolean;
  busy: boolean;
  onImport: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const date = new Date(plan.created_at).toLocaleDateString(LOCALES[lang], { dateStyle: "medium" });
  const off = plan.items.filter((i) => i.off && i.action !== "same");
  const waiting = plan.items.filter((i) => i.reason === "folder_missing");
  const left = plan.items.filter((i) => i.action === "skip");
  const n = changes(plan);
  return (
    <section className="move__preview" data-testid="move-preview" aria-live="polite">
      <div className="move__head">
        <h3 className="move__title">
          {done ? t("move.import.doneTitle") : t("move.import.from", { version: plan.apx_version, date })}
        </h3>
      </div>
      <ul className="move__summary">
        {SECTIONS.map((section) => {
          const items = plan.items.filter((i) => i.section === section);
          if (!items.length) return null;
          const counts = ACTIONS.flatMap((a) => {
            const k = items.filter((i) => i.action === a).length;
            return k ? [t(`move.import.${a}${k === 1 ? "One" : ""}` as MessageKey, { n: k })] : [];
          });
          return (
            <li key={section} className="move__row">
              <span className="move__name">{t(`move.section.${section}` as MessageKey)}</span>
              <span className="move__counts">{counts.join(" · ")}</span>
            </li>
          );
        })}
      </ul>
      {off.length > 0 && (
        <Group
          title={t("move.import.off")}
          hint={t("move.import.offHint")}
          items={off}
          icon={<Icons.Power size={13} />}
        />
      )}
      {waiting.length > 0 && (
        <Group
          title={t("move.import.waiting")}
          hint={t("move.import.waitingHint")}
          items={waiting}
          icon={<Icons.Folder size={13} />}
          bare
        />
      )}
      {left.length > 0 && <Group title={t("move.import.left")} items={left} icon={<Icons.Minus size={13} />} />}
      {plan.secrets.length > 0 && (
        <div className="move__group">
          <h4 className="move__grouptitle">
            <Icons.KeyRound size={13} />
            {t("move.import.secrets")}
          </h4>
          <p className="move__hint">{t("move.import.secretsHint")}</p>
          <div className="move__tags">
            {plan.secrets.map((s) => (
              <Tag key={s}>{s}</Tag>
            ))}
          </div>
          <div>
            <Button
              size="sm"
              variant="ghost"
              trailingIcon={<Icons.ArrowRight size={14} />}
              onClick={() => {
                go.config(null);
                go.resources("variables", true);
              }}
            >
              {t("move.import.secretsCta")}
            </Button>
          </div>
        </div>
      )}
      {!done && (
        <div className="move__actions">
          {n === 0 && <span className="move__hint">{t("move.import.nothing")}</span>}
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" variant="primary" disabled={n === 0} loading={busy} onClick={onImport}>
            {n === 1 ? t("move.import.ctaOne") : t("move.import.cta", { n })}
          </Button>
        </div>
      )}
    </section>
  );
}

function Group({
  title,
  hint,
  items,
  icon,
  bare,
}: {
  title: string;
  hint?: string;
  items: InstancePlanItem[];
  icon: ReactNode;
  /** Only the names: the title already says why. */
  bare?: boolean;
}) {
  const t = useT();
  return (
    <div className="move__group">
      <h4 className="move__grouptitle">
        {icon}
        {title}
      </h4>
      {hint && <p className="move__hint">{hint}</p>}
      <ul className="move__items">
        {items.map((i) => (
          <li key={`${i.section}:${i.id}`} className="move__item">
            <span className="move__itemname">{label(t, i)}</span>
            {!bare && <Tag>{t(`move.section.${i.section}` as MessageKey)}</Tag>}
            {i.reason && !bare && <span className="move__why">{t(`move.reason.${i.reason}` as MessageKey)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
