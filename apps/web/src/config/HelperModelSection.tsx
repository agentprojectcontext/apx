import type { MemorySettings, ModelRef } from "@apx/protocol";
import { Badge, Icons, SegmentedControl, SettingRow } from "@apx/ui";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { loadCatalog } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { type HelperMode, helperValue, readHelper } from "./helperModel.ts";
import { ModelRefList } from "./models/ModelRefList.tsx";
import { SectionHead, SubHead } from "./SectionHead.tsx";

/** Every background job the helper model runs, in the words the owner reads them. */
const JOBS: { key: MessageKey; icon: ReactNode }[] = [
  { key: "helperModel.job.titles", icon: <Icons.MessageSquare size={14} /> },
  { key: "helperModel.job.memory", icon: <Icons.Brain size={14} /> },
  { key: "helperModel.job.judge", icon: <Icons.Mail size={14} /> },
  { key: "helperModel.job.images", icon: <Icons.Image size={14} /> },
  { key: "helperModel.job.groups", icon: <Icons.Users size={14} /> },
  { key: "helperModel.job.drafts", icon: <Icons.Pencil size={14} /> },
  { key: "helperModel.job.review", icon: <Icons.Sparkles size={14} /> },
  { key: "helperModel.job.backup", icon: <Icons.Megaphone size={14} /> },
];

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The helper model: the small one that runs APX's background work, as an ordered chain (first, then its backups). */
export function HelperModelSection() {
  const t = useT();
  const [s, setS] = useState<MemorySettings>();
  // "Chosen" with no model yet: the list shows before anything is saved.
  const [picking, setPicking] = useState(false);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const revision = useRef(0);

  const load = useCallback(async () => {
    try {
      await saving.current.catch(() => undefined);
      const at = revision.current;
      const { indexed: _i, total: _t, embedder: _e, ...settings } = await client.call("memory.settings", {});
      if (at === revision.current) setS(settings);
    } catch (e) {
      notify(t("error.memory", { error: errText(e) }));
    }
  }, [t]);
  useEffect(() => {
    void loadCatalog();
    void load();
  }, [load]);

  const save = async (aux: string | undefined) => {
    if (!s) return;
    const { aux_model: _was, ...rest } = s;
    const next: MemorySettings = aux ? { ...rest, aux_model: aux } : rest;
    setS(next);
    const at = ++revision.current;
    const queued = saving.current.catch(() => undefined).then(() => client.call("memory.set_settings", next));
    saving.current = queued;
    try {
      await queued;
    } catch (e) {
      notify(t("error.memory", { error: errText(e) }));
      if (at === revision.current) await load();
    }
  };

  const saved = readHelper(s?.aux_model);
  const mode: HelperMode = picking ? "pick" : saved.mode;
  return (
    <>
      <SectionHead title={t("config.helperModel")} lead={t("helperModel.lead")} />
      <SubHead>{t("helperModel.does")}</SubHead>
      <ul className="helper__jobs">
        {JOBS.map((j) => (
          <li key={j.key} className="helper__job">
            <span className="helper__icon">{j.icon}</span>
            {t(j.key)}
          </li>
        ))}
      </ul>
      {s && (
        <>
          <SubHead>{t("helperModel.which")}</SubHead>
          <SettingRow title={t("config.helperModel")} description={t(`helperModel.hint.${mode}`)}>
            <SegmentedControl
              size="sm"
              label={t("config.helperModel")}
              value={mode}
              onValueChange={(v) => {
                setPicking(v === "pick");
                if (v === "auto") void save(undefined);
                else if (v === "off") void save("off");
              }}
              options={[
                { value: "auto", label: t("helperModel.mode.auto") },
                { value: "pick", label: t("helperModel.mode.pick") },
                { value: "off", label: t("helperModel.mode.off") },
              ]}
            />
          </SettingRow>
          {mode === "pick" && (
            <div className="router__block">
              <ModelRefList
                refs={saved.refs}
                onChange={(refs: ModelRef[]) => void save(helperValue(refs))}
                addLabel={t(saved.refs.length ? "helperModel.addBackup" : "helperModel.pickOne")}
                removeLabel={t("helperModel.remove")}
                max={5}
                badge={(i) => (
                  <Badge tone={i === 0 ? "brand" : "neutral"} dot={i === 0}>
                    {t(i === 0 ? "helperModel.first" : "helperModel.backup")}
                  </Badge>
                )}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
