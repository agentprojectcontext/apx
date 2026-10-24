import { Badge, Button, Dialog, Icons, Input, ProjectTile, Select, Spinner, Switch } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { QrCode } from "../common/QrCode.tsx";
import { RouterChain } from "../config/models/RouterChain.tsx";
import { ProvidersGrid } from "../config/ProvidersGrid.tsx";
import { loadChannels, saveChannel, useChannels } from "../data/channels.ts";
import { client } from "../data/client.ts";
import { loadCatalog, splitRef, useModels } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { useProviders } from "../data/providers.ts";
import { useSetup } from "../data/setup.ts";
import { type DataState, useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { kindOptions, NO_KIND } from "../project/projectKind.ts";
import { BotCard } from "./BotCard.tsx";
import { type Draft, type StepProps, withStarters } from "./draft.ts";
import { EmbedderCard } from "./EmbedderCard.tsx";
import { StepHead } from "./StepsIntro.tsx";

/** Provider management is shared with settings; the wizard saves its router on Continue. */
export function EnginesStep({ draft: d, set }: StepProps) {
  const t = useT();
  const providers = useProviders((s) => s.list);
  const loaded = useProviders((s) => s.load);
  useEffect(() => {
    void loadCatalog();
  }, []);
  const catalog = useModels((s) => s.catalog);
  // Providers seen with a key, and the ones that got theirs here: each brings its everyday model to the chain once.
  const keyed = useRef<Set<string>>(undefined);
  const pending = useRef<string[]>([]);
  useEffect(() => {
    if (loaded !== "ready") return;
    const ready = providers.filter((p) => p.enabled && p.key_set).map((p) => p.id);
    // On arrival only an empty chain is filled; afterwards, any provider that gets its key.
    const fresh = keyed.current ? ready.filter((id) => !keyed.current?.has(id)) : d.chain.length ? [] : ready;
    keyed.current = new Set(ready);
    pending.current = [...new Set([...pending.current, ...fresh])].filter((id) => ready.includes(id));
    const kept = d.chain.filter((ref) => ready.includes(splitRef(ref).engine));
    const { chain, waiting } = withStarters(kept, pending.current, catalog);
    pending.current = waiting;
    if (chain.join() !== d.chain.join()) set({ chain });
  }, [providers, loaded, catalog, d.chain, set]);
  return (
    <>
      <StepHead
        kicker="setup.engines.kicker"
        title={t("setup.engines.title")}
        end={t("setup.engines.titleGreen")}
        green
      >
        {t("setup.engines.body")}
      </StepHead>
      <ProvidersGrid compact />
      <div className="wiz__card wiz__chain">
        <RouterChain chain={d.chain} onChange={(chain) => set({ chain })} />
      </div>
    </>
  );
}

const MEMORY: Array<{ id: Draft["memory"]; title: MessageKey; body: MessageKey; icon: typeof Icons.Brain }> = [
  { id: "notes", title: "setup.memory.notes", body: "setup.memory.notesBody", icon: Icons.FileText },
  { id: "semantic", title: "setup.memory.semantic", body: "setup.memory.semanticBody", icon: Icons.Brain },
  { id: "off", title: "setup.memory.off", body: "setup.memory.offBody", icon: Icons.X },
];

export function MemoryStep({ draft: d, set }: StepProps) {
  const t = useT();
  const [embedder, setEmbedder] = useState<string | null>();
  useEffect(() => {
    void client
      .call("memory.settings", {})
      .then((s) => setEmbedder(s.embedder ?? null))
      .catch(() => setEmbedder(null));
  }, []);
  return (
    <>
      <StepHead kicker="setup.memory.kicker" title={t("setup.memory.title")} end={t("setup.memory.titleGreen")} green>
        {t("setup.memory.body")}
      </StepHead>
      <div className="wiz__options">
        {MEMORY.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={d.memory === m.id}
            className={`wiz__option${d.memory === m.id ? " is-on" : ""}`}
            onClick={() => set({ memory: m.id })}
          >
            <span className="wiz__choicetitle">
              <m.icon size={16} />
              {t(m.title)}
            </span>
            <span className="wiz__choicebody">{t(m.body)}</span>
          </button>
        ))}
      </div>
      {d.memory === "semantic" ? (
        <EmbedderCard />
      ) : (
        embedder && <p className="wiz__hintline">{t("setup.memory.engine", { engine: embedder })}</p>
      )}
      <div className="wiz__card wiz__toggle">
        <span className="wiz__rowmain">
          <span className="wiz__rowname">{t("setup.memory.skills")}</span>
          <span className="wiz__rowbody">{t("setup.memory.skillsBody")}</span>
        </span>
        <Switch
          size="sm"
          aria-label={t("setup.memory.skills")}
          checked={d.skillPicker}
          onCheckedChange={(skillPicker) => set({ skillPicker })}
        />
      </div>
      <div className="wiz__card wiz__toggle">
        <span className="wiz__rowmain">
          <span className="wiz__rowname">{t("setup.memory.compact")}</span>
          <span className="wiz__rowbody">{t("setup.memory.compactBody")}</span>
        </span>
        <Switch
          size="sm"
          aria-label={t("setup.memory.compact")}
          checked={d.compact && d.memory !== "off"}
          disabled={d.memory === "off"}
          onCheckedChange={(compact) => set({ compact })}
        />
      </div>
    </>
  );
}

/** Telegram (a token and it is up), WhatsApp (a QR from the phone), Discord and Slack (their bot's token). */
export function ChannelsStep({ name }: { name: string }) {
  const t = useT();
  return (
    <>
      <StepHead
        kicker="setup.channels.kicker"
        title={t("setup.channels.title")}
        end={t("setup.channels.titleGreen")}
        green
      >
        {t("setup.channels.body", { name })}
      </StepHead>
      <div className="wiz__engines">
        <TelegramCard />
        <WhatsAppCard />
        <BotCard kind="discord" line="setup.channels.discord" body="setup.channels.discordBody" />
        <BotCard kind="slack" line="setup.channels.slack" body="setup.channels.slackBody" />
      </div>
    </>
  );
}

const secretaryOf = (agents: DataState["agents"]) => Object.values(agents).find((a) => a.kind === "secretary");

function TelegramCard() {
  const t = useT();
  const agents = useData((s) => s.agents);
  const telegram = useChannels((s) => s.channels.find((c) => c.id === "telegram"));
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    const boss = secretaryOf(agents);
    if (!boss) return;
    setBusy(true);
    const ok = await saveChannel(
      "telegram",
      { agent_id: boss.id, enabled: true, strangers: "pair", concurrency: "steer", owner_thread: "home" },
      token.trim(),
    );
    setBusy(false);
    if (ok) {
      setToken("");
      notify(t("tg.tokenSaved"), "info");
    }
  };
  return (
    <div className={`wiz__engine${telegram?.token_set ? " is-on" : ""}`}>
      <div className="wiz__enginehead">
        <KindTile kind="telegram" size={34} />
        <span className="wiz__enginetitles">
          <b className="is-mono">TELEGRAM</b>
          <span>{t("setup.channels.telegram")}</span>
        </span>
        {telegram?.token_set && (
          <Badge tone="brand" dot>
            {telegram.account ?? t("setup.channels.connected")}
          </Badge>
        )}
      </div>
      <p className="wiz__enginebody">{t("setup.channels.telegramBody")}</p>
      {!telegram?.token_set && (
        <>
          <div className="wiz__keyrow">
            <Input
              type="password"
              autoComplete="off"
              aria-label={t("setup.channels.token")}
              placeholder="123456789:AA…"
              value={token}
              onChange={(e) => setToken(e.currentTarget.value)}
            />
            <Button
              size="sm"
              loading={busy}
              disabled={!/^\d+:[\w-]{20,}$/.test(token.trim())}
              onClick={() => void connect()}
            >
              {t("setup.channels.connect")}
            </Button>
          </div>
          <span className="wiz__hintline">{t("setup.channels.tokenHint")}</span>
        </>
      )}
    </div>
  );
}

/** WhatsApp, linked from here: a QR to scan with the phone, then where to link the owner's own phone. */
function WhatsAppCard() {
  const t = useT();
  const agents = useData((s) => s.agents);
  const wa = useChannels((s) => s.channels.find((c) => c.id === "whatsapp"));
  const [selfOwner, setSelfOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const running = wa?.status === "running";
  // While linking the QR changes every few seconds: read it often.
  useEffect(() => {
    if (!wa || running) return;
    const id = setInterval(() => void loadChannels(), 1500);
    return () => clearInterval(id);
  }, [wa, running]);
  const link = async () => {
    const boss = secretaryOf(agents);
    if (!boss) return;
    setBusy(true);
    await saveChannel("whatsapp", {
      agent_id: boss.id,
      enabled: true,
      strangers: "ask",
      concurrency: "steer",
      owner_thread: "home",
      self_owner: wa?.self_owner ?? selfOwner,
    });
    setBusy(false);
  };
  return (
    <div className={`wiz__engine${running ? " is-on" : ""}`}>
      <div className="wiz__enginehead">
        <KindTile kind="whatsapp" size={34} />
        <span className="wiz__enginetitles">
          <b className="is-mono">WHATSAPP</b>
          <span>{t("setup.channels.whatsapp")}</span>
        </span>
        {running && (
          <Badge tone="brand" dot>
            {wa.account ?? t("setup.channels.connected")}
          </Badge>
        )}
      </div>
      <p className="wiz__enginebody">{t("setup.channels.whatsappBody")}</p>
      {running ? (
        !wa.self_owner && <span className="wiz__hintline">{t("setup.channels.waPhone")}</span>
      ) : wa?.qr || wa?.status === "starting" ? (
        <div>
          <Button size="sm" leadingIcon={<Icons.QrCode size={14} />} onClick={() => setScanning(true)}>
            {t("setup.channels.waScan")}
          </Button>
        </div>
      ) : (
        <>
          {wa?.error && <span className="wiz__hintline is-error">{wa.error}</span>}
          <div className="wiz__inline">
            <Switch size="sm" checked={selfOwner} onCheckedChange={setSelfOwner} aria-label={t("ch.selfOwner")} />
            <span>{t("ch.selfOwner")}</span>
          </div>
          <div>
            <Button size="sm" loading={busy} leadingIcon={<Icons.QrCode size={14} />} onClick={() => void link()}>
              {wa ? t("wa.relink") : t("wa.link")}
            </Button>
          </div>
        </>
      )}
      {scanning && !running && (
        <Dialog
          open
          onOpenChange={(o) => !o && setScanning(false)}
          title={t("setup.channels.waScan")}
          description={t("wa.step2")}
        >
          <div className="wiz__qr">
            {wa?.qr ? (
              <QrCode value={wa.qr} label={t("wa.scan")} size={220} />
            ) : (
              <span className="wiz__hintline">
                <Spinner size={12} /> {t("wa.connecting")}
              </span>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** Default is there; a folder becomes a project (or later). */
export function ProjectStep({ draft: d, set }: StepProps) {
  const t = useT();
  const pick = async () => {
    const dir = await window.apxDesktop?.pickFolder?.();
    if (dir) set({ path: dir });
  };
  const choices: Array<{ id: Draft["projectChoice"]; title: MessageKey; body: MessageKey; icon: typeof Icons.Folder }> =
    [
      { id: "folder", title: "setup.project.folder", body: "setup.project.folderBody", icon: Icons.FolderOpen },
      { id: "later", title: "setup.project.later", body: "setup.project.laterBody", icon: Icons.Archive },
    ];
  return (
    <>
      <StepHead
        kicker="setup.project.kicker"
        title={t("setup.project.title")}
        end={t("setup.project.titleGreen")}
        green
      >
        {t("setup.project.body")}
      </StepHead>
      <div className="wiz__card wiz__default">
        <ProjectTile tone="brand" initial={(d.baseName.trim()[0] ?? "D").toUpperCase()} size={30} />
        <span className="wiz__rowmain">
          <span className="wiz__rowbody">{t("setup.project.default")}</span>
          <span className="wiz__basefields">
            <Input
              aria-label={t("setup.project.baseName")}
              value={d.baseName}
              maxLength={80}
              onChange={(e) => set({ baseName: e.currentTarget.value })}
            />
            <Select
              label={t("project.settings.kind")}
              value={d.baseKind || NO_KIND}
              onValueChange={(v) => set({ baseKind: !v || v === NO_KIND ? "" : v })}
              options={kindOptions(t)}
            />
          </span>
          <span className="wiz__rowbody">{t("setup.project.baseHint")}</span>
        </span>
        <Icons.Lock size={14} />
      </div>
      <div className="wiz__options is-two">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={d.projectChoice === c.id}
            className={`wiz__option${d.projectChoice === c.id ? " is-on" : ""}`}
            onClick={() => set({ projectChoice: c.id })}
          >
            <span className="wiz__choicetitle">
              <c.icon size={16} />
              {t(c.title)}
            </span>
            <span className="wiz__choicebody">{t(c.body)}</span>
          </button>
        ))}
      </div>
      {d.projectChoice === "folder" && (
        <div className="wiz__keyrow wiz__pathrow">
          <Input
            className="is-mono"
            placeholder={t("setup.project.pathPlaceholder")}
            value={d.path}
            onChange={(e) => set({ path: e.currentTarget.value })}
          />
          {window.apxDesktop?.pickFolder && (
            <Button variant="secondary" leadingIcon={<Icons.FolderOpen size={14} />} onClick={() => void pick()}>
              {t("setup.project.pick")}
            </Button>
          )}
        </div>
      )}
      {d.projectChoice === "folder" && d.path.trim() && (
        <span className="wiz__hintline">{t("setup.project.plain")}</span>
      )}
    </>
  );
}

/** How long "ready" shows before the app opens by itself. */
const DONE_MS = 2400;

/**
 * The crew is ready: a moment to read it, then the app opens by itself. With v1's `apx` on this machine the owner
 * first says whether `apx` becomes this one (a real choice, so it waits for it).
 */
export function DoneStep({ name, onFinish }: { name: string; onFinish: () => void }) {
  const t = useT();
  const home = useSetup((s) => s.status?.v1?.home);
  const terminal = useSetup((s) => s.status?.terminal);
  const [cli, setCli] = useState<{ busy?: boolean; ok?: boolean; skip?: boolean; detail?: string }>({});
  const asks = Boolean(home && terminal) && !cli.ok && !cli.skip;
  const finish = useRef(onFinish);
  finish.current = onFinish;
  useEffect(() => {
    if (asks) return;
    const timer = window.setTimeout(() => finish.current(), DONE_MS);
    return () => window.clearTimeout(timer);
  }, [asks]);
  const takeOver = async () => {
    setCli({ busy: true });
    try {
      setCli(await client.call("setup.take_over_cli", {}));
    } catch (e) {
      setCli({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div className="wiz__done">
      <h1 className="wiz__hero is-done">
        {name} <span className="is-green">{t("setup.done.ready")}</span>
      </h1>
      <p className="wiz__body">{t("setup.done.body", { home: home ? `${home}/v2` : "~/.apx/v2" })}</p>
      {/* With v1 installed, `apx` is v1's: one click makes it this one. */}
      {home && terminal && (
        <div className="wiz__card wiz__takeover">
          <b>{t("setup.done.takeOver")}</b>
          <span>{t("setup.done.takeOverBody")}</span>
          {cli.ok ? (
            <span className="wiz__hintline">
              <Icons.Check size={12} /> {t("setup.done.takeOverDone")}
            </span>
          ) : (
            !cli.skip && (
              <span className="wiz__inline">
                <Button size="sm" variant="secondary" loading={cli.busy} onClick={() => void takeOver()}>
                  {t("setup.done.takeOverDo")}
                </Button>
                <Button size="sm" variant="ghost" disabled={cli.busy} onClick={() => setCli({ skip: true })}>
                  {t("setup.done.takeOverSkip")}
                </Button>
              </span>
            )
          )}
          {cli.ok === false && <span className="wiz__hintline is-error">{cli.detail}</span>}
        </div>
      )}
      {!asks && (
        <span className="wiz__opening" role="status">
          <span className="wiz__openingbar" style={{ animationDuration: `${DONE_MS}ms` }} />
          {t("setup.done.opening", { name })}
        </span>
      )}
    </div>
  );
}
