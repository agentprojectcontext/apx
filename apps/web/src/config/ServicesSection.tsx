import type { ImageDefaults, ServiceInfo, ServiceKind, ServiceTest } from "@apx/protocol";
import { Badge, Button, EmptyState, IconButton, Icons, Input, Select, SettingRow, Switch, Textarea } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { mediaUrl } from "../data/media.ts";
import { notify } from "../data/notices.ts";
import { refreshSpeech } from "../data/speech.ts";
import { useVoice } from "../data/voice.ts";
import { useT } from "../i18n/index.ts";
import { SaveBar } from "./SaveBar.tsx";
import { SectionHead, SubHead } from "./SectionHead.tsx";
import { ServiceDialog } from "./ServiceDialog.tsx";
import { checkText, settingsOf, testService } from "./serviceCheck.ts";
import { VoiceRow } from "./VoiceRow.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Images or Voices: the owner's services in the order they are tried, a test, and (images) the shared defaults. One
 * that does not answer says why. `onChange` hears the list each time it is read again (after an edit, too). Voices and
 * transcription start with APX's own voice: in its place in the order once it runs, on top (fixed) until then. `bare`:
 * inside a section that has its own heading.
 */
export function ServicesSection({
  kind,
  embedded = false,
  bare = false,
  onChange,
}: {
  kind: ServiceKind;
  embedded?: boolean;
  bare?: boolean;
  onChange?: (services: ServiceInfo[]) => void;
}) {
  const t = useT();
  const [services, setServices] = useState<ServiceInfo[]>();
  const voice = useVoice();
  const ours = kind === "speech" || kind === "transcription" ? voice : undefined;
  // APX's voice is listed by the core only while it runs; until then its row stays on top.
  const oursListed = Boolean(services?.some((s) => s.dialect === "apx-voice"));
  const oursOn = Boolean(ours?.installed && ours.enabled);
  // Why each one that does not answer does not (asked again with "Test connection").
  const [why, setWhy] = useState<Record<string, ServiceTest>>({});
  const [defaults, setDefaults] = useState<ImageDefaults>();
  const [editing, setEditing] = useState<ServiceInfo | "new">();
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
      for (const s of r.services) if (s.status === "unreachable" && s.dialect !== "apx-voice") void retest(s);
      // The chat's read-aloud buttons follow whether a voice is set up.
      if (kind === "speech") void refreshSpeech();
    } catch (e) {
      setServices([]);
      notify(t("error.services", { error: errText(e) }));
    }
  }, [kind, t, retest]);
  // Read again when APX's voice starts or stops running: its row comes and goes from the order.
  useEffect(() => {
    void oursOn;
    void load();
  }, [load, oursOn]);

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
      {!embedded && !bare && (
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
      {services && !services.length && !ours ? (
        <EmptyState
          variant="dashed"
          size="sm"
          icon={kind === "image" ? <Icons.Image /> : kind === "speech" ? <Icons.Mic /> : <Icons.Brain />}
        >
          {t(`svc.${kind}.empty`)}
        </EmptyState>
      ) : (
        <ul className="res__list">
          {ours && !oursListed && services && (
            <li className="res__row voicerow">
              <Order />
              <VoiceRow kind={kind === "speech" ? "speech" : "transcription"} status={ours} />
            </li>
          )}
          {services?.map((s, i) => (
            <li
              key={s.id}
              className={`res__row${s.enabled && !signedOut(s) ? "" : " is-off"}${ours && s.dialect === "apx-voice" ? " voicerow" : ""}`}
            >
              <Order
                up={i > 0 ? () => move(i, -1) : undefined}
                down={i < services.length - 1 ? () => move(i, 1) : undefined}
              />
              {ours && s.dialect === "apx-voice" ? (
                <VoiceRow kind={kind === "speech" ? "speech" : "transcription"} status={ours} />
              ) : (
                <ServiceRow
                  s={s}
                  why={why[s.id]}
                  onToggle={(on) => toggle(s, on)}
                  onCheck={() => void retest(s)}
                  onEdit={() => setEditing(s)}
                  onRemove={() => void call(() => client.call("services.set", { id: s.id, service: null }))}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button size="sm" variant="secondary" leadingIcon={<Icons.Plus size={14} />} onClick={() => setEditing("new")}>
          {t("svc.add")}
        </Button>
      </div>

      {!embedded &&
        (kind === "image" ? <ImageTest /> : kind === "speech" && services ? <SpeechTest services={services} /> : null)}
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

/** Moves a row up or down the order; without either, the row stays where it is. */
function Order({ up, down }: { up?: () => void; down?: () => void }) {
  const t = useT();
  return (
    <div className="svc__order">
      <IconButton size="sm" label={t("svc.up")} icon={<Icons.ChevronUp size={12} />} disabled={!up} onClick={up} />
      <IconButton
        size="sm"
        label={t("svc.down")}
        icon={<Icons.ChevronDown size={12} />}
        disabled={!down}
        onClick={down}
      />
    </div>
  );
}

/** Codex's image service while Codex is not signed in on this machine: it cannot draw, so it cannot be turned on. */
const signedOut = (s: ServiceInfo) => s.dialect === "codex-images" && s.status === "unreachable";

/**
 * One of the owner's own services: where it is, whether it answers (and why not), on/off, check, edit, remove.
 * Codex's is APX's own: only on/off, and only while Codex is signed in.
 */
function ServiceRow(props: {
  s: ServiceInfo;
  why: ServiceTest | undefined;
  onToggle(on: boolean): void;
  onCheck(): void;
  onEdit(): void;
  onRemove(): void;
}) {
  const t = useT();
  const { s, why } = props;
  const codex = s.dialect === "codex-images";
  const out = signedOut(s);
  const status = out ? "signedOut" : s.enabled ? s.status : "unknown";
  return (
    <>
      <div className="res__main">
        <div className="res__name">
          {s.label} <span className="svc__dialect">{s.dialect}</span>
        </div>
        <div className="res__desc res__mono">
          {codex ? t("svc.codexWhere") : `${s.base_url}${s.model ? ` · ${s.model}` : ""}`}
        </div>
        {out ? (
          <div className="res__desc svc__why" role="status">
            {t("svc.codexSignIn")}
          </div>
        ) : (
          s.status === "unreachable" &&
          why &&
          !why.ok && (
            <div className="res__desc svc__why" role="status">
              {checkText(t, why)}
            </div>
          )
        )}
      </div>
      <Badge tone={status === "reachable" ? "brand" : status === "unreachable" ? "danger" : "neutral"} dot>
        {t(`svc.status.${status}`)}
      </Badge>
      <Switch
        size="sm"
        checked={s.enabled && !out}
        disabled={out}
        onCheckedChange={props.onToggle}
        label={t("providers.on")}
      />
      <IconButton
        size="sm"
        label={t("svc.check")}
        icon={<Icons.RefreshCw size={14} />}
        disabled={!s.enabled && !codex}
        onClick={props.onCheck}
      />
      {!codex && (
        <>
          <IconButton size="sm" label={t("providers.edit")} icon={<Icons.Pencil size={14} />} onClick={props.onEdit} />
          <IconButton
            size="sm"
            label={t("providers.remove")}
            icon={<Icons.Trash2 size={14} />}
            onClick={props.onRemove}
          />
        </>
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

/** Says a text with the first voice that answers, as agents would, or with the one picked. */
function SpeechTest({ services }: { services: ServiceInfo[] }) {
  const t = useT();
  const [text, setText] = useState(t("svc.speech.sample"));
  const [busy, setBusy] = useState(false);
  const [by, setBy] = useState<string>();
  const voices = services.filter((s) => s.enabled);
  const [with_, setWith] = useState("first");
  const run = async () => {
    setBusy(true);
    try {
      const r = await client.call("media.speak", { text, ...(with_ !== "first" ? { service: with_ } : {}) });
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
          {voices.length > 1 && (
            <Select
              size="sm"
              label={t("svc.testWith")}
              value={with_}
              onValueChange={(v) => setWith(v ?? "first")}
              options={[
                { value: "first", label: t("svc.firstVoice", { name: voices[0]?.label ?? "" }) },
                ...voices.slice(1).map((s) => ({ value: s.id, label: s.label })),
              ]}
            />
          )}
          <Button
            size="sm"
            loading={busy}
            disabled={!text.trim()}
            leadingIcon={<Icons.Volume2 size={14} />}
            onClick={() => void run()}
          >
            {voices.length === 1 ? t("svc.sayWith", { name: voices[0]?.label ?? "" }) : t("svc.say")}
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
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const num = (k: keyof ImageDefaults) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD({ ...d, [k]: Number(e.currentTarget.value) || 0 });
  const save = async () => {
    setSaving(true);
    setFailed(false);
    try {
      const saved = await client.call("services.defaults", d);
      setD(saved);
      onSaved(saved);
    } catch (e) {
      setFailed(true);
      notify(t("error.services", { error: errText(e) }));
    } finally {
      setSaving(false);
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
      <SaveBar
        dirty={JSON.stringify(d) !== JSON.stringify(value)}
        saving={saving}
        failed={failed}
        onDiscard={() => {
          setD(value);
          setFailed(false);
        }}
        onSave={() => void save()}
      />
    </>
  );
}
