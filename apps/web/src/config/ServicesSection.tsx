import type { ImageDefaults, ServiceInfo, ServiceKind, ServiceTest } from "@apx/protocol";
import { Badge, Button, EmptyState, IconButton, Icons, Input, SettingRow, Switch, Textarea } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { mediaUrl } from "../data/media.ts";
import { notify } from "../data/notices.ts";
import { refreshSpeech } from "../data/speech.ts";
import { useT } from "../i18n/index.ts";
import { LocalTranscription } from "./LocalTranscription.tsx";
import { SectionHead, SubHead } from "./SectionHead.tsx";
import { ServiceDialog } from "./ServiceDialog.tsx";
import { checkText, settingsOf, testService } from "./serviceCheck.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Images or Voices: the owner's services in the order they are tried, a test, and (images) the shared defaults. One
 * that does not answer says why. `onChange` hears the list each time it is read again (after an edit, too).
 */
export function ServicesSection({
  kind,
  embedded = false,
  onChange,
}: {
  kind: ServiceKind;
  embedded?: boolean;
  onChange?: (services: ServiceInfo[]) => void;
}) {
  const t = useT();
  const [services, setServices] = useState<ServiceInfo[]>();
  // Why each one that does not answer does not (asked again with "Test connection").
  const [why, setWhy] = useState<Record<string, ServiceTest>>({});
  const [defaults, setDefaults] = useState<ImageDefaults>();
  const [editing, setEditing] = useState<ServiceInfo | "new">();
  const [transcriptionKey, setTranscriptionKey] = useState(0);
  const refreshTranscription = useCallback(() => setTranscriptionKey((k) => k + 1), []);
  const changed = useRef(onChange);
  changed.current = onChange;

  /** Asks one service now: why it does not answer, or that it does again. */
  const retest = useCallback(async (s: ServiceInfo) => {
    const r = await testService(settingsOf(s), s.id);
    setWhy((w) => ({ ...w, [s.id]: r }));
    setServices((list) => list?.map((x) => (x.id === s.id ? { ...x, status: r.ok ? "reachable" : "unreachable" } : x)));
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await client.call("services.list", { kind });
      setServices(r.services);
      setDefaults(r.image_defaults);
      changed.current?.(r.services);
      for (const s of r.services) if (s.status === "unreachable") void retest(s);
      // The chat's read-aloud buttons follow whether a voice is set up.
      if (kind === "speech") void refreshSpeech();
    } catch (e) {
      setServices([]);
      notify(t("error.services", { error: errText(e) }));
    }
  }, [kind, t, retest]);
  useEffect(() => {
    void load();
  }, [load]);

  const call = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (e) {
      notify(t("error.services", { error: errText(e) }));
    }
    await load();
  };
  const move = (i: number, by: -1 | 1) => {
    if (!services) return;
    const ids = services.map((s) => s.id);
    const [id] = ids.splice(i, 1);
    if (!id) return;
    ids.splice(i + by, 0, id);
    void call(() => client.call("services.order", { kind, ids }));
  };
  const toggle = (s: ServiceInfo, on: boolean) => {
    const { id, key_set: _k, status: _s, ...settings } = s;
    void call(() => client.call("services.set", { id, service: { ...settings, enabled: on } }));
  };

  return (
    <>
      {!embedded && (
        <SectionHead
          title={t(kind === "image" ? "config.images" : "config.voices")}
          lead={t(kind === "image" ? "svc.image.lead" : "svc.speech.lead")}
          actions={
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Icons.RefreshCw size={14} />}
              onClick={() => void load()}
            >
              {t("common.refresh")}
            </Button>
          }
        />
      )}
      {services && !services.length ? (
        <EmptyState
          variant="dashed"
          size="sm"
          icon={kind === "image" ? <Icons.Image /> : kind === "speech" ? <Icons.Mic /> : <Icons.Brain />}
        >
          {t(`svc.${kind}.empty`)}
        </EmptyState>
      ) : (
        <ul className="res__list">
          {services?.map((s, i) => (
            <li key={s.id} className={s.enabled ? "res__row" : "res__row is-off"}>
              <div className="svc__order">
                <IconButton
                  size="sm"
                  label={t("svc.up")}
                  icon={<Icons.ChevronUp size={12} />}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                />
                <IconButton
                  size="sm"
                  label={t("svc.down")}
                  icon={<Icons.ChevronDown size={12} />}
                  disabled={i === services.length - 1}
                  onClick={() => move(i, 1)}
                />
              </div>
              <div className="res__main">
                <div className="res__name">
                  {s.label} <span className="svc__dialect">{s.dialect}</span>
                </div>
                <div className="res__desc res__mono">
                  {s.dialect === "codex-images" ? t("svc.codexWhere") : s.base_url}
                  {s.model ? ` · ${s.model}` : ""}
                </div>
                {s.status === "unreachable" && why[s.id] && !why[s.id]?.ok && (
                  <div className="res__desc svc__why" role="status">
                    {checkText(t, why[s.id] as ServiceTest)}
                  </div>
                )}
              </div>
              <Badge tone={s.status === "reachable" ? "brand" : s.status === "unreachable" ? "danger" : "neutral"} dot>
                {t(`svc.status.${s.status}`)}
              </Badge>
              <Switch size="sm" checked={s.enabled} onCheckedChange={(on) => toggle(s, on)} label={t("providers.on")} />
              <IconButton
                size="sm"
                label={t("svc.check")}
                icon={<Icons.RefreshCw size={14} />}
                disabled={!s.enabled}
                onClick={() => void retest(s)}
              />
              <IconButton
                size="sm"
                label={t("providers.edit")}
                icon={<Icons.Pencil size={14} />}
                onClick={() => setEditing(s)}
              />
              <IconButton
                size="sm"
                label={t("providers.remove")}
                icon={<Icons.Trash2 size={14} />}
                onClick={() => void call(() => client.call("services.set", { id: s.id, service: null }))}
              />
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button size="sm" variant="secondary" leadingIcon={<Icons.Plus size={14} />} onClick={() => setEditing("new")}>
          {t("svc.add")}
        </Button>
      </div>

      {!embedded && (kind === "image" ? <ImageTest /> : kind === "speech" ? <SpeechTest /> : null)}
      {!embedded && kind === "speech" && (
        <>
          <SubHead>{t("svc.transcription")}</SubHead>
          <p className="config__lead">{t("svc.transcription.lead")}</p>
          <LocalTranscription onInstalled={refreshTranscription} />
          <ServicesSection key={transcriptionKey} kind="transcription" embedded />
        </>
      )}
      {!embedded && kind === "image" && defaults && <Defaults value={defaults} onSaved={setDefaults} />}

      {editing && (
        <ServiceDialog
          kind={kind}
          initial={editing === "new" ? undefined : editing}
          taken={services?.map((s) => s.id) ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void load();
          }}
        />
      )}
    </>
  );
}

function ImageTest() {
  const t = useT();
  const [prompt, setPrompt] = useState(t("svc.image.samplePrompt"));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ src: string; by: string }>();
  const run = async () => {
    setBusy(true);
    try {
      const r = await client.call("media.image", { prompt });
      const first = r.media[0];
      if (first) setResult({ src: await mediaUrl(first.id), by: [r.service, r.model].filter(Boolean).join(" · ") });
    } catch (e) {
      notify(t("error.services", { error: errText(e) }));
    }
    setBusy(false);
  };
  return (
    <>
      <SubHead>{t("svc.test")}</SubHead>
      <div className="svc__test">
        <Textarea
          aria-label={t("svc.prompt")}
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
        />
        <div>
          <Button
            size="sm"
            loading={busy}
            disabled={!prompt.trim()}
            leadingIcon={<Icons.Sparkles size={14} />}
            onClick={() => void run()}
          >
            {t("svc.generate")}
          </Button>
        </div>
        {result && (
          <figure className="svc__result">
            <img src={result.src} alt={prompt} />
            <figcaption>{result.by}</figcaption>
          </figure>
        )}
      </div>
    </>
  );
}

function SpeechTest() {
  const t = useT();
  const [text, setText] = useState(t("svc.speech.sample"));
  const [busy, setBusy] = useState(false);
  const [by, setBy] = useState<string>();
  const run = async () => {
    setBusy(true);
    try {
      const r = await client.call("media.speak", { text });
      setBy(r.service);
      void new Audio(await mediaUrl(r.media.id)).play();
    } catch (e) {
      notify(t("error.services", { error: errText(e) }));
    }
    setBusy(false);
  };
  return (
    <>
      <SubHead>{t("svc.test")}</SubHead>
      <div className="svc__test">
        <Textarea aria-label={t("svc.say")} rows={2} value={text} onChange={(e) => setText(e.currentTarget.value)} />
        <div className="tgtoken">
          <Button
            size="sm"
            loading={busy}
            disabled={!text.trim()}
            leadingIcon={<Icons.Volume2 size={14} />}
            onClick={() => void run()}
          >
            {t("svc.say")}
          </Button>
          {by && <span className="pform__hint">{t("svc.spokenBy", { name: by })}</span>}
        </div>
      </div>
    </>
  );
}

function Defaults({ value, onSaved }: { value: ImageDefaults; onSaved(d: ImageDefaults): void }) {
  const t = useT();
  const [d, setD] = useState(value);
  const num = (k: keyof ImageDefaults) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD({ ...d, [k]: Number(e.currentTarget.value) || 0 });
  const save = async () => {
    try {
      onSaved(await client.call("services.defaults", d));
    } catch (e) {
      notify(t("error.services", { error: errText(e) }));
    }
  };
  return (
    <>
      <SubHead>{t("svc.defaults")}</SubHead>
      <p className="config__lead">{t("svc.defaultsLead")}</p>
      <SettingRow title={t("svc.size")}>
        <div className="tgtoken">
          <Input aria-label={t("svc.width")} type="number" value={String(d.width)} onChange={num("width")} />
          <span>×</span>
          <Input aria-label={t("svc.height")} type="number" value={String(d.height)} onChange={num("height")} />
        </div>
      </SettingRow>
      <SettingRow title={t("svc.steps")}>
        <Input aria-label={t("svc.steps")} type="number" value={String(d.steps)} onChange={num("steps")} />
      </SettingRow>
      <SettingRow title={t("svc.cfg")}>
        <Input aria-label={t("svc.cfg")} type="number" value={String(d.cfg_scale)} onChange={num("cfg_scale")} />
      </SettingRow>
      <SettingRow title={t("svc.count")}>
        <Input aria-label={t("svc.count")} type="number" value={String(d.count)} onChange={num("count")} />
      </SettingRow>
      <SettingRow title={t("svc.negative")} description={t("svc.negativeHint")}>
        <Input
          aria-label={t("svc.negative")}
          value={d.negative_prompt}
          onChange={(e) => setD({ ...d, negative_prompt: e.currentTarget.value })}
        />
      </SettingRow>
      <div>
        <Button size="sm" onClick={() => void save()}>
          {t("common.save")}
        </Button>
      </div>
    </>
  );
}
