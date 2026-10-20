import type { Localized, ProfileField, Routine } from "@apx/protocol";
import { Button, Dialog, Icons, Input, SegmentedControl, Select, SettingRow, Skeleton, Tag } from "@apx/ui";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import {
  loadProfiles,
  localized,
  removeProfile,
  restoreProfileRoutine,
  setProfile,
  useProfiles,
  type ProfileValue as Value,
} from "../data/profiles.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

type Days = "1-5" | "*" | "0,6";
const DAYS: Days[] = ["1-5", "*", "0,6"];

/** "30 8 * * 1-5" → 08:30 on weekdays; a cron of another shape is edited as it is. */
function parseCron(cron: string): { time: string; days: Days } | undefined {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|0,6)$/.exec(cron.trim());
  if (!m) return undefined;
  return { time: `${m[2]?.padStart(2, "0")}:${m[1]?.padStart(2, "0")}`, days: m[3] as Days };
}
const toCron = (time: string, days: Days) => {
  const [h = "0", min = "0"] = time.split(":");
  return `${Number(min)} ${Number(h)} * * ${days}`;
};

/**
 * What the super-agent is for: the profile picker, the active profile's settings and its routines. A profile gives it a
 * role in its prompt, routines on its own schedule and the settings both read; APX ships some, more install from a
 * folder. None: it only answers. Shown in Settings › Super-agent and in the super-agent's editor.
 */
/** `actions`: links shown under its routines. */
export function ProfilePicker({ actions }: { actions?: ReactNode }) {
  const t = useT();
  const lang = useLanguage();
  const text = useCallback((l: Localized | undefined) => localized(l, lang), [lang]);
  const state = useProfiles((s) => s.profiles);
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    void loadProfiles();
  }, []);
  if (!state) return <Skeleton shape="block" height={160} />;
  const current = state.profiles.find((p) => p.id === state.active.id);
  const save = (patch: Record<string, Value>) =>
    current && void setProfile(current.id, { ...state.active.values, ...patch });

  return (
    <>
      <p className="config__lead">{t("prof.lead")}</p>
      <fieldset className="radiocards">
        <legend className="sr-only">{t("config.profile")}</legend>
        <label className={!current ? "radiocard is-on" : "radiocard"}>
          <input
            type="radio"
            name="profile"
            className="radiocard__dot"
            checked={!current}
            onChange={() => void setProfile(null, {})}
          />
          <span>
            <span className="radiocard__title">{t("prof.none")}</span>
            <span className="radiocard__text">{t("prof.noneHint")}</span>
          </span>
        </label>
        {state.profiles.map((p) => (
          <label key={p.id} className={current?.id === p.id ? "radiocard is-on" : "radiocard"}>
            <input
              type="radio"
              name="profile"
              className="radiocard__dot"
              checked={current?.id === p.id}
              onChange={() => void setProfile(p.id, {})}
            />
            <span className="prof__card">
              <span className="radiocard__title">
                {text(p.name)} {p.source === "owner" && <Tag>{t("prof.installed")}</Tag>}
              </span>
              <span className="radiocard__text">{text(p.description)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="tgtoken">
        <span className="pform__hint">{t("prof.storeSoon")}</span>
        <Button size="sm" variant="ghost" leadingIcon={<Icons.Plus size={14} />} onClick={() => setInstalling(true)}>
          {t("prof.install")}
        </Button>
      </div>

      {current && (
        <>
          <SubHead>{t("prof.settings", { name: text(current.name) })}</SubHead>
          {current.settings.map((f) => (
            <SettingRow key={f.key} title={text(f.label)} description={text(f.help)}>
              <FieldInput
                field={f}
                value={state.active.values[f.key] ?? f.default}
                text={text}
                onSave={(v) => save({ [f.key]: v })}
              />
            </SettingRow>
          ))}

          {current.routines.length > 0 && <SubHead>{t("prof.routines")}</SubHead>}
          {state.routines.map((r) => (
            <RoutineLine
              key={r.id}
              routine={r}
              changed={state.changed.includes(r.id)}
              onRestore={() => void restoreProfileRoutine(r.id)}
            />
          ))}
          {current.source === "owner" && (
            <div className="tgtoken">
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Icons.Trash2 size={14} />}
                onClick={() => void removeProfile(current.id)}
              >
                {t("prof.remove", { name: text(current.name) })}
              </Button>
            </div>
          )}
        </>
      )}
      {actions}
      {installing && (
        <InstallDialog
          onClose={() => setInstalling(false)}
          onInstalled={() => {
            setInstalling(false);
            void loadProfiles();
          }}
        />
      )}
    </>
  );
}

/** A profile routine: on or off, and Restore only when its prompt is no longer the shipped one, confirmed in place. */
function RoutineLine({ routine: r, changed, onRestore }: { routine: Routine; changed: boolean; onRestore(): void }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  return (
    <div className="tgtoken">
      <span className="res__name">{r.name}</span>
      <span className="pform__hint">
        {r.enabled ? t("routines.on") : t("routines.off")}
        {changed && ` · ${t("prof.edited")}`}
      </span>
      {changed &&
        (asking ? (
          <span className="prof__ask">
            <span className="pform__hint">{t("prof.restoreAsk")}</span>
            <Button
              size="sm"
              onClick={() => {
                setAsking(false);
                onRestore();
              }}
            >
              {t("prof.restoreShort")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              {t("common.cancel")}
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Icons.RotateCcw size={14} />}
            onClick={() => setAsking(true)}
            aria-label={t("prof.restore", { name: r.name })}
          >
            {t("prof.restoreShort")}
          </Button>
        ))}
    </div>
  );
}

/** One setting, drawn by its kind: a time and days, a number, a line of text or a command, or a choice. */
function FieldInput({
  field: f,
  value,
  text,
  onSave,
}: {
  field: ProfileField;
  value: Value;
  text: (l: Localized | undefined) => string;
  onSave(v: Value): void;
}) {
  const t = useT();
  const label = text(f.label);
  if (f.type === "schedule") {
    const c = parseCron(String(value));
    if (!c)
      return (
        <Input
          aria-label={label}
          className="sec__cron"
          defaultValue={String(value)}
          onBlur={(e) => e.currentTarget.value.trim() !== value && onSave(e.currentTarget.value.trim())}
        />
      );
    return (
      <div className="tgquiet">
        <Input
          aria-label={label}
          type="time"
          value={c.time}
          onChange={(e) => e.currentTarget.value && onSave(toCron(e.currentTarget.value, c.days))}
        />
        <Select
          label={t("prof.days")}
          value={c.days}
          onValueChange={(v) => v && onSave(toCron(c.time, v as Days))}
          options={DAYS.map((d) => ({ value: d, label: t(`prof.days.${d}`) }))}
        />
      </div>
    );
  }
  if (f.type === "number") {
    const min = f.min ?? 1;
    const max = f.max ?? 999;
    return (
      <span className="prof__num">
        <Input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          className="nudge__num"
          value={String(value)}
          onChange={(e) => onSave(Math.max(min, Math.min(max, Math.round(Number(e.currentTarget.value) || min))))}
        />
        {f.unit && <span className="pform__hint">{t(`prof.unit.${f.unit}`)}</span>}
      </span>
    );
  }
  if (f.type === "choice")
    return (
      <SegmentedControl
        size="sm"
        label={label}
        value={String(value)}
        onValueChange={(v) => onSave(v)}
        options={(f.options ?? []).map((o) => ({ value: o.value, label: text(o.label) }))}
      />
    );
  return (
    <Input
      aria-label={label}
      className="sec__cron"
      defaultValue={String(value)}
      onBlur={(e) => e.currentTarget.value !== value && onSave(e.currentTarget.value)}
    />
  );
}

/** A profile from a folder on this machine (one with an apx-profile.json). */
function InstallDialog({ onClose, onInstalled }: { onClose(): void; onInstalled(): void }) {
  const t = useT();
  const [path, setPath] = useState("");
  const [error, setError] = useState<string>();
  const install = () =>
    void client
      .call("profiles.install", { path: path.trim() })
      .then(onInstalled)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("prof.install")}
      description={t("prof.installHint")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!path.trim()} onClick={install}>
            {t("prof.installDo")}
          </Button>
        </>
      }
    >
      <Input
        aria-label={t("prof.folder")}
        placeholder="~/work/my-profile"
        value={path}
        onChange={(e) => setPath(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && path.trim() && install()}
      />
      {error && <p className="pform__hint is-error">{error}</p>}
    </Dialog>
  );
}
