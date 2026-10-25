import type { Memory, MemorySettings } from "@apx/protocol";
import { Button, EmptyState, Icons, Input, SegmentedControl, SettingRow, Switch } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { MemoryAutomation } from "./MemoryAutomation.tsx";
import { ModelRefPicker } from "./models/ModelRefPicker.tsx";
import { SectionHead, SubHead } from "./SectionHead.tsx";
import { ServicesSection } from "./ServicesSection.tsx";

type State = MemorySettings & { indexed: number; total: number; embedder?: string | undefined };

const MODES: MemorySettings["mode"][] = ["notes", "semantic", "off"];

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Memory: how notes are found (by words, also by meaning, or none) and how long chats are kept small. */
export function MemorySection() {
  const t = useT();
  const [s, setS] = useState<State>();
  const desired = useRef<State | undefined>(undefined);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const revision = useRef(0);
  const [indexing, setIndexing] = useState(false);
  // "Chosen" with no model yet: the picker shows before anything is saved.
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    try {
      await saving.current.catch(() => undefined);
      const at = revision.current;
      const next = await client.call("memory.settings", {});
      if (at === revision.current) {
        desired.current = next;
        setS(next);
      }
    } catch (e) {
      notify(t("error.memory", { error: errText(e) }));
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<MemorySettings>) => {
    const base = desired.current;
    if (!base) return;
    const next = { ...base, ...patch };
    desired.current = next;
    setS(next);
    const at = ++revision.current;
    const { indexed: _i, total: _t, embedder: _e, ...settings } = next;
    const queued = saving.current.catch(() => undefined).then(() => client.call("memory.set_settings", settings));
    saving.current = queued;
    try {
      await queued;
      if (at === revision.current) await load();
    } catch (e) {
      notify(t("error.memory", { error: errText(e) }));
      if (at === revision.current) await load();
    }
  };
  const reindex = async () => {
    setIndexing(true);
    try {
      await client.call("memory.reindex", {});
    } catch (e) {
      notify(t("error.memory", { error: errText(e) }));
    }
    setIndexing(false);
    await load();
  };

  if (!s) return <SectionHead title={t("config.memory")} lead={t("mem.lead")} />;
  const aux = picking || (s.aux_model && s.aux_model !== "off") ? "pick" : s.aux_model === "off" ? "off" : "auto";
  return (
    <>
      <SectionHead title={t("config.memory")} lead={t("mem.lead")} />
      <fieldset className="radiocards">
        <legend className="sr-only">{t("config.memory")}</legend>
        {MODES.map((m) => (
          <label key={m} className={s.mode === m ? "radiocard is-on" : "radiocard"}>
            <input
              type="radio"
              name="memory-mode"
              className="radiocard__dot"
              checked={s.mode === m}
              onChange={() => void save({ mode: m })}
            />
            <span>
              <span className="radiocard__title">{t(`mem.mode.${m}`)}</span>
              <span className="radiocard__text">{t(`mem.mode.${m}.hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {s.mode === "semantic" && (
        <>
          <SubHead>{t("mem.engines")}</SubHead>
          <p className="config__lead">{t("mem.enginesLead")}</p>
          <ServicesSection kind="embedding" embedded />
          <div className="tgtoken">
            <span className="pform__hint">{t("mem.indexed", { n: s.indexed, total: s.total })}</span>
            <Button size="sm" variant="secondary" loading={indexing} onClick={() => void reindex()}>
              {t("mem.reindex")}
            </Button>
          </div>
        </>
      )}

      {s.mode !== "off" && <SearchTest />}

      <MemoryAutomation settings={s} save={save} />

      <SubHead>{t("mem.skills")}</SubHead>
      <SettingRow
        title={t("mem.skillPicker")}
        description={`${t("mem.skillPickerHint")} ${
          s.embedder ? t("mem.skillPickerEngine", { engine: s.embedder }) : t("mem.skillPickerNoEngine")
        }`}
      >
        <Switch
          size="sm"
          checked={s.skill_picker}
          onCheckedChange={(on) => void save({ skill_picker: on })}
          aria-label={t("mem.skillPicker")}
        />
      </SettingRow>
      {s.skill_picker && !s.embedder && s.mode !== "semantic" && <ServicesSection kind="embedding" embedded />}

      <SubHead>{t("mem.longChats")}</SubHead>
      <SettingRow title={t("mem.autoCompact")} description={t("mem.autoCompactHint")}>
        <Switch
          size="sm"
          checked={s.auto_compact}
          onCheckedChange={(on) => void save({ auto_compact: on })}
          aria-label={t("mem.autoCompact")}
        />
      </SettingRow>
      <SettingRow title={t("mem.aux")} description={t(`mem.auxHint.${aux}`)}>
        <div className="tgtoken">
          <SegmentedControl
            size="sm"
            label={t("mem.aux")}
            value={aux}
            onValueChange={(v) => {
              setPicking(v === "pick");
              if (v === "auto") void save({ aux_model: undefined });
              else if (v === "off") void save({ aux_model: "off" });
            }}
            options={[
              { value: "auto", label: t("mem.aux.auto") },
              { value: "pick", label: t("mem.aux.pick") },
              { value: "off", label: t("mem.aux.off") },
            ]}
          />
          {aux === "pick" && (
            <ModelRefPicker
              label={t("mem.aux")}
              value={s.aux_model && s.aux_model !== "off" ? s.aux_model : undefined}
              placeholder={t("mem.aux.pickOne")}
              onChange={(ref) => void save({ aux_model: ref })}
            />
          )}
        </div>
      </SettingRow>
    </>
  );
}

/** Types a question the way an agent would get it and shows which notes would come with it. */
function SearchTest() {
  const t = useT();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Memory[]>();
  const run = async () => {
    try {
      setFound((await client.call("memory.list", { query: q, limit: 8 })).memories);
    } catch (e) {
      notify(t("error.memory", { error: errText(e) }));
    }
  };
  return (
    <>
      <SubHead>{t("mem.test")}</SubHead>
      <div className="tgtoken">
        <Input
          aria-label={t("mem.test")}
          placeholder={t("mem.testPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && q.trim() && void run()}
        />
        <Button size="sm" disabled={!q.trim()} onClick={() => void run()}>
          {t("mem.search")}
        </Button>
      </div>
      {found &&
        (found.length ? (
          <ul className="res__list">
            {found.map((m) => (
              <li key={m.id} className="res__row">
                <Icons.Brain size={14} className="res__icon" />
                <div className="res__main">
                  <div className="res__desc">{m.text}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState variant="dashed" size="sm" icon={<Icons.Brain />}>
            {t("memory.noMatch")}
          </EmptyState>
        ))}
    </>
  );
}
