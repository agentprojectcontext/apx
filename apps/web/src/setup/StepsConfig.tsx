import type { CatalogEngine } from "@apx/protocol";
import {
  Badge,
  Button,
  EngineIcon,
  IconButton,
  Icons,
  Input,
  ProjectTile,
  Select,
  type SelectOption,
  Spinner,
  Switch,
} from "@apx/ui";
import { useEffect, useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import type { ChannelKind } from "../channels/kinds.ts";
import { QrCode } from "../common/QrCode.tsx";
import { RefSelect } from "../config/models/RefSelect.tsx";
import { loadChannels, saveChannel, useChannels } from "../data/channels.ts";
import { loadEngines } from "../data/engines.ts";
import { loadCatalog, splitRef, useModels } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { loadProviders, saveProvider, useProviders } from "../data/providers.ts";
import { useSetup } from "../data/setup.ts";
import { type DataState, useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import type { Draft, StepProps } from "./draft.ts";
import { StepHead } from "./StepsIntro.tsx";

type Engine = {
  id: string;
  label: string;
  kind: "cli" | "key" | "local";
  ready: boolean;
  installed: boolean;
  /** The command that signs a CLI in. */
  login?: string;
};
const LOGIN: Record<string, string> = { claude: "claude", codex: "codex login" };

/** The engines this Mac has and the model APIs: sign in or paste a key, then put them in order. */
export function EnginesStep({ draft: d, set }: StepProps) {
  const t = useT();
  const cli = useData((s) => s.engines);
  const providers = useProviders((s) => s.list);
  const catalog = useModels((s) => s.catalog);
  useEffect(() => {
    void loadProviders();
    void loadEngines(true);
    void loadCatalog();
  }, []);
  const engines: Engine[] = [
    ...cli
      .filter((e) => e.id !== "native")
      .map((e) => ({
        id: e.id,
        label: e.label,
        kind: "cli" as const,
        ready: e.installed && e.logged_in,
        installed: e.installed,
        ...(LOGIN[e.id] ? { login: LOGIN[e.id] } : {}),
      })),
    ...providers.map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.needs_key ? ("key" as const) : ("local" as const),
      ready: p.enabled && p.key_set,
      installed: true,
    })),
  ];
  // A chain entry is an engine alone (its own default model) or one of its models ("gemini/gemini-3.6-flash").
  const uses = (id: string) => d.chain.some((r) => splitRef(r).engine === id);
  const toggle = (id: string, on: boolean) =>
    set({ chain: on ? [...d.chain, id] : d.chain.filter((r) => splitRef(r).engine !== id) });
  const replace = (i: number, ref: string) =>
    set({ chain: d.chain.map((r, j) => (j === i ? ref : r)).filter((r, j, all) => all.indexOf(r) === j) });
  const drop = (i: number) => set({ chain: d.chain.filter((_, j) => j !== i) });
  const up = (i: number) => {
    if (i < 1) return;
    const c = [...d.chain];
    [c[i - 1], c[i]] = [c[i] as string, c[i - 1] as string];
    set({ chain: c });
  };
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
      <div className="wiz__engines">
        {engines.map((e) => (
          <EngineCard key={e.id} engine={e} on={uses(e.id)} onToggle={(on) => toggle(e.id, on)} />
        ))}
      </div>
      <div className="wiz__card wiz__chain">
        <div className="wiz__chainhead">
          <b>{t("setup.engines.chain")}</b>
          <span>{t("setup.engines.chainHint")}</span>
        </div>
        {d.chain.length === 0 && <p className="wiz__unset">{t("setup.engines.chainEmpty")}</p>}
        {d.chain.map((ref, i) => (
          <div key={ref} className="wiz__link">
            <span className="wiz__linkn">#{i + 1}</span>
            <EngineIcon engine={splitRef(ref).engine} size={14} />
            <RefSelect value={ref} onChange={(v) => v !== ref && replace(i, v)} />
            {i === 0 && <Badge tone="brand">{t("setup.engines.default")}</Badge>}
            <span className="wiz__spacer" />
            <IconButton
              size="sm"
              label={t("setup.engines.up")}
              icon={<Icons.ArrowUp size={13} />}
              disabled={i === 0}
              onClick={() => up(i)}
            />
            <IconButton
              size="sm"
              label={t("setup.engines.drop")}
              icon={<Icons.X size={13} />}
              onClick={() => drop(i)}
            />
          </div>
        ))}
      </div>
    </>
  );
}

function EngineCard({ engine: e, on, onToggle }: { engine: Engine; on: boolean; onToggle(on: boolean): void }) {
  const t = useT();
  const providers = useProviders((s) => s.list);
  const [key, setKey] = useState<string>();
  const [busy, setBusy] = useState(false);
  const saveKey = async () => {
    const p = providers.find((x) => x.id === e.id);
    if (!p || !key?.trim()) return;
    setBusy(true);
    const ok = await saveProvider(
      {
        id: p.id,
        label: p.label,
        preset: p.preset ?? p.id,
        transport: p.transport,
        base_url: p.base_url,
        needs_key: p.needs_key,
        models: p.models,
        enabled: true,
      },
      key.trim(),
    );
    setBusy(false);
    if (ok) {
      setKey(undefined);
      onToggle(true);
    }
  };
  const kind: Record<Engine["kind"], MessageKey> = {
    cli: "setup.engines.subscription",
    key: "setup.engines.apiKey",
    local: "setup.engines.local",
  };
  return (
    <div className={`wiz__engine${on ? " is-on" : ""}`}>
      <div className="wiz__enginehead">
        <EngineIcon engine={e.id} tile size={34} />
        <span className="wiz__enginetitles">
          <b>{e.label}</b>
          <span>{e.installed ? t(kind[e.kind]) : t("setup.engines.notInstalled")}</span>
        </span>
        {on && (
          <Badge tone="brand" dot>
            {t("setup.engines.active")}
          </Badge>
        )}
      </div>
      {e.ready ? (
        <Button size="sm" variant={on ? "ghost" : "secondary"} onClick={() => onToggle(!on)}>
          {on ? t("setup.engines.remove") : t("setup.engines.useIt")}
        </Button>
      ) : e.kind === "cli" ? (
        e.installed && (
          <div className="wiz__signin">
            <span>{t("setup.engines.signInHint", { command: e.login ?? e.label })}</span>
            <Button size="sm" variant="secondary" onClick={() => void loadEngines(true)}>
              {t("setup.engines.signedIn")}
            </Button>
          </div>
        )
      ) : key === undefined ? (
        <Button size="sm" variant="secondary" onClick={() => setKey("")}>
          {t("setup.engines.addKey")}
        </Button>
      ) : (
        <div className="wiz__keyrow">
          <Input
            type="password"
            autoFocus
            autoComplete="off"
            placeholder="sk-…"
            value={key}
            onChange={(ev) => setKey(ev.currentTarget.value)}
            onKeyDown={(ev) => ev.key === "Enter" && void saveKey()}
          />
          <Button size="sm" loading={busy} disabled={!key.trim()} onClick={() => void saveKey()}>
            {t("setup.engines.save")}
          </Button>
        </div>
      )}
    </div>
  );
}

const MEMORY: Array<{ id: Draft["memory"]; title: MessageKey; body: MessageKey; icon: typeof Icons.Brain }> = [
  { id: "notes", title: "setup.memory.notes", body: "setup.memory.notesBody", icon: Icons.FileText },
  { id: "semantic", title: "setup.memory.semantic", body: "setup.memory.semanticBody", icon: Icons.Brain },
  { id: "off", title: "setup.memory.off", body: "setup.memory.offBody", icon: Icons.X },
];

export function MemoryStep({ draft: d, set }: StepProps) {
  const t = useT();
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

const SOON: Array<{ kind: ChannelKind; line: MessageKey; body: MessageKey }> = [
  { kind: "slack", line: "setup.channels.slack", body: "setup.channels.slackBody" },
  { kind: "discord", line: "setup.channels.discord", body: "setup.channels.discordBody" },
];

/** Telegram (a token and it is up) and WhatsApp (a QR from the phone) work now; the rest are coming. */
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
        {SOON.map((c) => (
          <div key={c.kind} className="wiz__engine is-soon">
            <div className="wiz__enginehead">
              <KindTile kind={c.kind} size={34} />
              <span className="wiz__enginetitles">
                <b className="is-mono">{c.kind.toUpperCase()}</b>
                <span>{t(c.line)}</span>
              </span>
              <Badge>{t("setup.channels.soon")}</Badge>
            </div>
            <p className="wiz__enginebody">{t(c.body)}</p>
          </div>
        ))}
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
      { agent_id: boss.id, enabled: true, strangers: "pair", concurrency: "queue", owner_thread: "home" },
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
      concurrency: "queue",
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
      ) : wa?.qr ? (
        <div className="wiz__qr">
          <QrCode value={wa.qr} label={t("wa.scan")} size={180} />
          <span className="wiz__hintline">{t("wa.step2")}</span>
        </div>
      ) : wa?.status === "starting" ? (
        <span className="wiz__hintline">
          <Spinner size={12} /> {t("wa.connecting")}
        </span>
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
      { id: "folder", title: "setup.project.folder", body: "setup.project.folderBody", icon: Icons.Folder },
      { id: "later", title: "setup.project.later", body: "setup.project.laterBody", icon: Icons.Clock },
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
        <ProjectTile tone="brand" initial="D" size={30} />
        <span className="wiz__rowmain">
          <span className="wiz__rowname">Default</span>
          <span className="wiz__rowbody">{t("setup.project.default")}</span>
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

export function DoneStep({ name }: { name: string }) {
  const t = useT();
  const home = useSetup((s) => s.status?.v1?.home);
  const terminal = useSetup((s) => s.status?.terminal);
  const command = "apx2 status";
  // With v1 still installed, `apx` is v1's: two commands make it this one (the owner runs them).
  const takeOver =
    home && terminal ? `pnpm remove -g @agentprojectcontext/apx\npnpm --dir "${terminal}" link --global` : "";
  const copy = () => void navigator.clipboard.writeText(command).catch(() => {});
  return (
    <div className="wiz__done">
      <h1 className="wiz__hero is-done">
        {name} <span className="is-green">{t("setup.done.ready")}</span>
      </h1>
      <p className="wiz__body">{t("setup.done.body", { home: home ? `${home}/v2` : "~/.apx/v2" })}</p>
      <span className="wiz__command">
        <span className="is-muted">$</span> {command}
        <button type="button" onClick={copy}>
          {t("setup.done.copy")}
        </button>
      </span>
      {takeOver && (
        <div className="wiz__card wiz__takeover">
          <b>{t("setup.done.takeOver")}</b>
          <span>{t("setup.done.takeOverBody")}</span>
          <pre>{takeOver}</pre>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.Copy size={14} />}
            onClick={() => void navigator.clipboard.writeText(takeOver).catch(() => {})}
          >
            {t("setup.done.copy")}
          </Button>
        </div>
      )}
    </div>
  );
}
