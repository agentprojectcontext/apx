import type { CatalogEntry, ExtensionInfo, ExtensionListing, McpServerStatus } from "@apx/protocol";
import {
  Button,
  ConnectSignal,
  type ConnectSignalState,
  Dialog,
  Field,
  Icons,
  Input,
  Steps,
  SummaryCard,
  SummaryItem,
} from "@apx/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import "@apx/ui/summary.css";
import { client } from "../data/client.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { usePowerText } from "../resources/ExtensionSummary.tsx";
import { extensionsChanged } from "../resources/extensionInstall.ts";
import { go } from "../shell/nav.ts";
import { AboutCard } from "./AboutParts.tsx";
import { type About, aboutAddress, aboutExtension, type Origin, originOf } from "./about.ts";
import { nothingToConnect, type Problem, problemOf } from "./adding.ts";
import { ApxMark, ItemIcon } from "./ConnectHead.tsx";
import { connectExtension, connectionFailureKey } from "./connecting.ts";
import { SettingField } from "./ExtensionConfig.tsx";
import { connectionUpdateText, nameFor, settingCopyIn } from "./itemText.ts";
import { PairBody, usePairing } from "./PairStep.tsx";
import "../styles/install-box.css";
import { SignInElsewhere } from "../resources/SignInElsewhere.tsx";

// The one box for adding and connecting: from the catalog (directly), from elsewhere (under the source picker) or for
// one already added. On top, APX joined to the service (a device's app joined to APX); under it, the card of what it
// is; one button. Add copies its files and runs nothing; Connect (or Pair) is the owner's decision that it works, and
// what that approves is written above the button. Both happen here, one after the other.

type ExtSource =
  | { file: { name: string; data: string } }
  | { url: string }
  | { path: string }
  | { entry: { catalog: string; id: string } };

/** What the box starts from. */
export type BoxStart =
  /** A package to look at; `official`: chosen from APX's catalog, so its files must be the ones APX publishes. */
  | { kind: "source"; source: ExtSource; origin?: Origin; official?: boolean }
  /** One already added, to connect or pair (`look`: how its page shows it, for its icon). */
  | {
      kind: "installed";
      id: string;
      look?: { listing?: ExtensionListing | undefined; entry?: CatalogEntry | undefined };
    }
  /** An MCP server the owner gives by its address. */
  | { kind: "address"; url: string };

type Phase = "review" | "connect" | "done";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const SETTLE_MS = 3 * 60_000;

/** Waiting on something the box does not drive (a sign-in in the browser), checked every couple of seconds. */
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A typed value, trimmed; empty text is none. */
const filled = (v: string | number | boolean | undefined) => (typeof v === "string" ? v.trim() || undefined : v);

/** What a newer version changes, framed: from which to which, what it adds or drops, and what happens to it. */
function UpdateNote({
  from,
  to,
  adds,
  drops,
  changed,
  stays,
  reconnect,
}: {
  from: string;
  to: string;
  adds: string[];
  drops: string[];
  changed: string[];
  stays: boolean;
  reconnect: boolean;
}) {
  const t = useT();
  return (
    <SummaryCard variant="outline">
      <SummaryItem icon={<Icons.ArrowUp size={13} />} title={t("box.update.title", { from, to })}>
        {adds.length > 0 && <span className="mkt-box__line">{t("box.update.adds", { list: adds.join(" · ") })}</span>}
        {drops.length > 0 && (
          <span className="mkt-box__line">{t("box.update.drops", { list: drops.join(" · ") })}</span>
        )}
        {changed.length > 0 && (
          <span className="mkt-box__line">{t("box.update.changed", { list: changed.join(" · ") })}</span>
        )}
        {reconnect ? (
          <span className="mkt-box__line">{t("box.update.reconnect")}</span>
        ) : (
          <>
            {!adds.length && !drops.length && !changed.length && (
              <span className="mkt-box__line">{t("box.update.nothingNew")}</span>
            )}
            <span className="mkt-box__line">{t(stays ? "box.update.stays" : "box.update.waits")}</span>
          </>
        )}
        <span className="mkt-box__line">
          {t(reconnect ? "box.update.keepsReconnect" : "box.update.keeps", { from })}
        </span>
      </SummaryItem>
    </SummaryCard>
  );
}

export function InstallBox({
  start,
  top,
  title,
  description,
  onClose,
}: {
  start: BoxStart | undefined;
  /** The source picker, when it adds from elsewhere. */
  top?: ReactNode;
  title?: string;
  description?: string;
  onClose(): void;
}) {
  const t = useT();
  const lang = useLanguage();
  const power = usePowerText();
  const updateText = (update: NonNullable<ExtensionInfo["update"]>, extension: ExtensionInfo) =>
    connectionUpdateText(update, extension.settings, power, {
      addedLabel: (entry) => {
        const setting = entry.kind === "secret" && extension.settings.find((field) => field.name === entry.name);
        return power(setting ? { ...entry, detail: settingCopyIn(setting, lang).label } : entry);
      },
      singleConnection:
        extension.mcp.length === 1 && extension.mcp[0]
          ? { extensionId: extension.id, registeredId: extension.mcp[0], name: extension.name }
          : undefined,
    });
  const [seen, setSeen] = useState<ExtensionInfo>();
  const [ext, setExt] = useState<ExtensionInfo>();
  const [own, setOwn] = useState<string>();
  const [phase, setPhase] = useState<Phase>("review");
  const [link, setLink] = useState<ConnectSignalState>("idle");
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(false);
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [tools, setTools] = useState<string[]>();
  const [signInUrl, setSignInUrl] = useState<string>();
  const [signInServer, setSignInServer] = useState<string>();
  const alive = useRef(true);
  const pair = usePairing(ext);
  // Open to read what it is; folded to its head while the owner follows the pairing steps.
  const [cardOpen, setCardOpen] = useState(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // A new start (another source reviewed in the picker) begins again.
  useEffect(() => {
    setSeen(undefined);
    setExt(undefined);
    setOwn(undefined);
    setPhase("review");
    setLink("idle");
    setProblem(undefined);
    setValues({});
    setTools(undefined);
    setSignInUrl(undefined);
    // Whole to decide on adding it; folded for anything done to one already there (an update, connecting, pairing).
    setCardOpen(start?.kind !== "installed");
    if (!start) return;
    if (start.kind === "address") return;
    setLooking(true);
    const job =
      start.kind === "installed"
        ? Promise.all([client.call("extensions.list", {}), client.call("mcp.list", {})]).then(([r, m]) => {
            const e = r.extensions.find((x) => x.id === start.id);
            if (!e) throw new Error(start.id);
            setExt(e);
            // The tools its servers already gave, when they ran before.
            const known = m.servers.filter((s) => s.scope === "global" && e.mcp.includes(s.name));
            if (known.some((s) => s.tool_names.length)) setTools(known.flatMap((s) => s.tool_names));
            setPhase("connect");
          })
        : client.call("extensions.inspect", start.source).then(async (e) => {
            setSeen(e);
            if (e.update) setCardOpen(false);
            // A newer version of one the owner has: the tools its servers already gave.
            if (e.update) {
              const m = await client.call("mcp.list", {});
              const known = m.servers.filter((x) => x.scope === "global" && e.mcp.includes(x.name));
              if (known.some((x) => x.tool_names.length)) setTools(known.flatMap((x) => x.tool_names));
            }
            // Chosen from APX's catalog, these must be APX's files: other ones are not added from here.
            if (start.official && e.provenance !== "official" && !e.catalog)
              setProblem({ key: "box.err.mismatch", vars: { name: e.name, version: e.version } });
          });
    void job
      .catch((e) => {
        setLink("broken");
        setProblem(problemOf(e, "", undefined));
      })
      .finally(() => setLooking(false));
  }, [start]);

  // Past adding it, the action is what matters: the card folds to its head.
  useEffect(() => {
    if (phase !== "review") setCardOpen(false);
  }, [phase]);

  // The pairing finished (or the owner said they typed the code): it works.
  useEffect(() => {
    if (pair.state === "paired") {
      setLink("connected");
      setPhase("done");
    } else if (pair.state === "failed") {
      setLink("broken");
      setProblem({ key: "box.err.pair", detail: pair.error, retry: true });
    }
  }, [pair.state, pair.error]);

  const shown = ext ?? seen;
  // As its page labels it: a folder on this computer is the owner's own.
  const label =
    start?.kind === "address"
      ? "own"
      : shown?.provenance === "official"
        ? "official"
        : (start?.kind === "source" ? start.origin : shown ? originOf(shown.source) : undefined)?.kind === "folder"
          ? "own"
          : "third";
  const ownName = start?.kind === "address" ? (own ?? nameFor(start.url, [])) : "";
  const a: About | undefined =
    start?.kind === "address"
      ? aboutAddress(start.url, ownName, tools)
      : shown
        ? aboutExtension(shown, lang, {
            label,
            origin: start?.kind === "source" ? start.origin : undefined,
            tools,
            look: start?.kind === "installed" ? start.look : undefined,
          })
        : undefined;
  const pairs = Boolean(ext?.companion ?? seen?.companion);
  const verb = pairs ? "mkt.step.pair" : "mkt.step.connect";
  // A newer version of one the owner has: no Add and Connect trail, and its state on top is the one it has now.
  const update = seen?.update;
  const twoSteps =
    !update && !(start?.kind === "source" && seen && nothingToConnect(seen)) && start?.kind !== "installed";
  const shownLink: ConnectSignalState = phase === "review" && update?.keeps_on && link === "idle" ? "connected" : link;

  /** Starts each server as agents will use it: its tools once ready; a sign-in page waits for the owner. */
  const startServers = async (names: string[]): Promise<string[]> => {
    const found: string[] = [];
    for (const server of names) {
      let s: McpServerStatus | undefined;
      try {
        s = (await client.call("mcp.signIn", { scope: "global", server })).server;
      } catch {}
      const until = Date.now() + SETTLE_MS;
      let lastStatus: McpServerStatus["status"] | undefined;
      while (alive.current && (!s || s.status === "starting" || s.status === "needs-sign-in") && Date.now() < until) {
        if (s?.status && s.status !== lastStatus) {
          lastStatus = s.status;
          extensionsChanged();
        }
        if (s?.sign_in_url) {
          setSignInUrl(s.sign_in_url);
          setSignInServer(server);
        }
        await pause(2000);
        s = (await client.call("mcp.list", {})).servers.find((x) => x.scope === "global" && x.name === server);
      }
      if (s?.status === "needs-sign-in") throw new Error(t("box.err.signInNotDone"));
      if (s?.status !== "ready") throw new Error(t("box.err.noAnswer"));
      setSignInUrl(undefined);
      found.push(...s.tool_names);
    }
    return found;
  };

  const startExtension = (extension: ExtensionInfo) =>
    connectExtension(extension, {
      enable: (id, enabled, options) => client.call("extensions.enable", { id, enabled, ...options }),
      start: startServers,
      changed: (updated) => {
        setExt(updated);
        extensionsChanged();
      },
    });

  const recoverConnection = async (error: unknown, extension: ExtensionInfo, hasFields: boolean) => {
    setLink("broken");
    let confirmed = false;
    try {
      const actual = (await client.call("extensions.list", {})).extensions.find((entry) => entry.id === extension.id);
      if (actual) {
        setExt(actual);
        confirmed = true;
      }
    } catch {}
    extensionsChanged();
    const key = confirmed ? connectionFailureKey(error, hasFields) : "box.err.rollback";
    setProblem({
      key,
      vars: { name: extension.name },
      ...(key === "box.err.checkFields" ? {} : { detail: errText(error) }),
      retry: true,
    });
  };

  const add = async () => {
    if (!start) return;
    setBusy(true);
    setProblem(undefined);
    try {
      if (start.kind === "address") {
        // The owner's own connector, with this server inside (D-249): added and turned on in one go.
        const added = await client.call("extensions.install", { server: { name: ownName, url: start.url } });
        setOwn(ownName);
        setPhase("connect");
        setLink("connecting");
        setExt(added);
        try {
          setTools((await startExtension(added)).tools);
        } catch (error) {
          await recoverConnection(error, added, false);
          return;
        }
        setLink("connected");
        setPhase("done");
        return;
      }
      if (start.kind !== "source" || !seen) return;
      const done = await client.call("extensions.install", { ...start.source, hash: seen.hash });
      extensionsChanged();
      setExt(done);
      if (done.enabled) {
        // An update that asks for nothing more stays as it was.
        setLink("connected");
        setPhase("done");
      } else if (nothingToConnect(done)) {
        setExt(await client.call("extensions.enable", { id: done.id, enabled: true }));
        extensionsChanged();
        setLink("connected");
        setPhase("done");
      } else {
        // Added: its page, now with Connect, is where the owner takes the next step (DECISIONS.md#d-255).
        onClose();
        go.marketplace(label === "own" ? "mine" : "extensions", `ext:${done.id}`);
      }
    } catch (e) {
      if (start.kind === "address") {
        setLink("broken");
        setProblem({ key: "box.err.address", vars: { name: ownName }, detail: errText(e), retry: true });
      } else setProblem(problemOf(e, seen?.name ?? t("box.thisOne"), seen?.version));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    if (start?.kind === "address") return void add();
    if (!ext) return;
    setBusy(true);
    setProblem(undefined);
    setLink("connecting");
    try {
      for (const s of ext.secrets) {
        const v = filled(values[s.name]);
        if (typeof v === "string") await client.call("extensions.set_secret", { id: ext.id, name: s.name, value: v });
      }
      const settings = Object.fromEntries(
        ext.settings.flatMap((s) => {
          const v = filled(values[s.name]);
          return v === undefined ? [] : [[s.name, v]];
        }),
      );
      if (Object.keys(settings).length) await client.call("extensions.settings", { id: ext.id, values: settings });
      if (ext.companion) {
        const on = ext.enabled ? ext : await client.call("extensions.enable", { id: ext.id, enabled: true });
        setExt(on);
        extensionsChanged();
        await pair.start();
        return;
      }
      setTools((await startExtension(ext)).tools);
      setValues({});
      setLink("connected");
      setPhase("done");
    } catch (e) {
      await recoverConnection(e, ext, fields.length > 0);
    } finally {
      setBusy(false);
    }
  };

  // Keep this attempt's fields editable even if saving succeeded but the connection failed.
  const fields = ext
    ? [
        ...ext.secrets
          .filter((s) => Object.hasOwn(values, s.name) || !s.set)
          .map((s) => ({ kind: "secret" as const, s })),
        ...ext.settings
          .filter(
            (s) => Object.hasOwn(values, s.name) || (!s.set && s.value === undefined && (s.required || s.sensitive)),
          )
          .map((s) => ({ kind: "setting" as const, s })),
      ]
    : [];
  const ready = fields.every(({ kind, s }) =>
    kind === "secret" || s.required ? filled(values[s.name]) !== undefined : true,
  );

  // It signs in on the service's own page (OAuth): Connect opens it in the browser.
  const signsIn = !pairs && a?.connection === "oauth";
  const agree = !a
    ? undefined
    : pairs
      ? undefined
      : a.runsCode
        ? a.hosts.length
          ? t("box.agree.runsTo", { host: a.hosts.join(", ") })
          : t("box.agree.runs")
        : a.hosts.length
          ? t("box.agree.talks", { host: a.hosts.join(", ") })
          : a.ownerHost
            ? t("box.agree.yourAddress")
            : undefined;

  const signalLabel =
    link === "connected"
      ? t(pairs ? "box.state.paired" : "box.state.connected")
      : link === "connecting"
        ? t(pairs ? "box.state.waitingDevice" : signInUrl ? "box.state.signIn" : "box.state.connecting")
        : link === "broken"
          ? t(problem?.key === "box.err.download" ? "box.state.offline" : "box.state.broken")
          : phase === "review"
            ? update
              ? t("box.state.youHave", { version: update.from })
              : t("box.state.notYet")
            : t(pairs ? "box.state.notPaired" : "box.state.notConnected");

  const heading =
    phase === "review" && title
      ? title
      : !a
        ? t("box.title.looking")
        : phase === "review"
          ? t(seen?.update ? "box.title.update" : "box.title.add", { name: a.name })
          : phase === "done"
            ? update
              ? t("box.title.updated", { name: a.name, version: a.version ?? "" })
              : t("box.title.done", { name: a.name })
            : t(pairs ? "box.title.pair" : "box.title.connect", { name: a.name });

  const openPage = () => {
    onClose();
    go.marketplace(own ? "mine" : "extensions", `ext:${ext?.id ?? seen?.id ?? ""}`);
  };

  const retry = () => {
    if (phase === "connect") return void connect();
    if (problem?.key === "box.err.mismatch" || !seen) {
      // Look again: a broken download or changed files may be right the second time.
      const s = start;
      if (s?.kind === "source")
        void client
          .call("extensions.inspect", s.source)
          .then((e) => {
            setSeen(e);
            setLink("idle");
            setProblem(
              s.official && e.provenance !== "official" && !e.catalog
                ? { key: "box.err.mismatch", vars: { name: e.name, version: e.version } }
                : undefined,
            );
          })
          .catch((e) => setProblem(problemOf(e, "", undefined)));
      return;
    }
    void add();
  };

  const blocked = problem && (problem.key === "box.err.mismatch" || problem.key.startsWith("box.err.newer"));
  let footer: ReactNode;
  if (phase === "done")
    footer = (
      <>
        <Button variant="secondary" onClick={openPage}>
          {t("box.see", { name: a?.name ?? "" })}
        </Button>
        <Button onClick={onClose}>{t("box.done")}</Button>
      </>
    );
  else if (phase === "review")
    footer = (
      <>
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        {problem?.retry ? (
          <Button onClick={retry}>{t("box.retry")}</Button>
        ) : (
          <Button
            disabled={!a || Boolean(blocked) || looking}
            loading={busy}
            leadingIcon={update ? <Icons.ArrowUp size={14} /> : <Icons.Plus size={14} />}
            onClick={() => void add()}
          >
            {t(update ? "extInstall.update" : "mkt.step.add")}
          </Button>
        )}
      </>
    );
  else
    footer = (
      <>
        <Button variant="secondary" onClick={onClose}>
          {t("box.later")}
        </Button>
        {problem?.key === "box.err.rollback" ? (
          <Button onClick={openPage}>{t("box.viewStatus")}</Button>
        ) : (
          !(pairs && pair.state === "waiting") && (
            <Button
              disabled={!ready || !ext}
              loading={busy || (link === "connecting" && !pairs)}
              onClick={() => void connect()}
            >
              {problem?.retry ? t("box.retry") : t(verb)}
            </Button>
          )
        )}
        {pairs && pair.code && pair.state === "waiting" && <Button onClick={pair.confirm}>{t("box.pairTyped")}</Button>}
      </>
    );

  const steps = [t("mkt.step.add"), t(verb)];
  const current = phase === "review" ? 0 : phase === "connect" ? 1 : 2;

  return (
    <Dialog
      open
      size="md"
      title={heading}
      description={phase === "review" ? description : undefined}
      closeLabel={t("common.close")}
      onOpenChange={(o) => !o && !busy && onClose()}
      footer={footer}
      className="mkt-box"
    >
      <div className="mkt-box__body">
        {phase === "review" && top}
        {a && (
          <ConnectSignal
            from={pairs ? <ItemIcon item={a} size={36} /> : <ApxMark />}
            to={pairs ? <ApxMark /> : <ItemIcon item={a} size={36} />}
            state={shownLink}
            label={signalLabel}
          />
        )}
        {a && twoSteps && <Steps steps={steps} current={current} />}
        {looking && !a && <p className="install__note">{t("box.looking")}</p>}
        {problem && (
          <div className={`mkt-box__problem${blocked ? " is-soft" : ""}`} role="alert">
            <Icons.TriangleAlert size={15} />
            <span>
              {t(problem.key, { ...problem.vars, name: problem.vars?.name || t("box.thisOne") })}
              {problem.detail && (
                <details className="mkt-details">
                  <summary>
                    <Icons.ChevronRight size={12} aria-hidden="true" />
                    {t("box.details")}
                  </summary>
                  <code>{problem.detail}</code>
                </details>
              )}
            </span>
          </div>
        )}
        {a && phase === "review" && seen && update && (
          <UpdateNote
            from={update.from}
            to={seen.version}
            {...updateText(update, seen)}
            stays={Boolean(update.keeps_on)}
          />
        )}
        {phase === "connect" && ext && !ext.enabled && ext.update && ext.update.adds.length > 0 && (
          <UpdateNote from={ext.update.from} to={ext.version} {...updateText(ext.update, ext)} stays={false} />
        )}
        {phase === "connect" &&
          ext &&
          (fields.length > 0 || ext.companion || signInUrl || link === "connecting" || agree || signsIn) && (
            // What to do now, framed like an update's changes: keys, the pairing steps, a sign-in, what it approves.
            <SummaryCard variant="outline" className="mkt-box__connect">
              {fields.map(({ kind, s }) =>
                kind === "secret" ? (
                  <Field
                    key={s.name}
                    label={settingCopyIn(s, lang).label}
                    hint={
                      "url" in s && s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {t("box.whereKey")}
                        </a>
                      ) : undefined
                    }
                  >
                    {(id) => (
                      <Input
                        id={id}
                        type="password"
                        autoComplete="off"
                        value={String(values[s.name] ?? "")}
                        onChange={({ currentTarget: { value } }) => setValues((v) => ({ ...v, [s.name]: value }))}
                      />
                    )}
                  </Field>
                ) : (
                  <SettingField
                    key={s.name}
                    s={s}
                    value={values[s.name]}
                    onChange={(v) => setValues((x) => ({ ...x, [s.name]: v }))}
                  />
                ),
              )}
              {ext.companion && <PairBody ext={ext} pair={pair} />}
              {signInUrl && (
                <p className="mkt-box__wait">
                  {t("box.signInWaiting", { name: ext.name })}{" "}
                  <a href={signInUrl} target="_blank" rel="noreferrer">
                    {t("box.signInOpen")} <Icons.ExternalLink size={12} />
                  </a>
                </p>
              )}
              {signInUrl && signInServer && (
                <SignInElsewhere server={{ scope: "global", name: signInServer }} onDone={() => undefined} />
              )}
              {link === "connecting" && !signInUrl && !pairs && <p className="mkt-box__wait">{t("box.starting")}</p>}
              {/* What opens before it does: the service's own sign-in page, then back here. */}
              {signsIn && link === "idle" && (
                <p className="mkt-box__wait">{t("box.signInWillOpen", { name: ext.name })}</p>
              )}
              {agree && link !== "connecting" && <p className="mkt-box__agree">{agree}</p>}
            </SummaryCard>
          )}
        {phase === "done" && a && (
          <p className="mkt-box__ok">
            <Icons.Check size={15} />
            <span>
              {update ? t("box.doneUpdated") : t(pairs ? "box.donePaired" : "box.doneConnected", { name: a.name })}
            </span>
          </p>
        )}
        {/* What it is comes last once there is something to do: open to add it, folded to its head otherwise. */}
        {a && (
          <AboutCard
            a={a}
            open={cardOpen}
            onToggle={() => setCardOpen((o) => !o)}
            compact={phase !== "review"}
            aside={
              phase !== "review" && !update && label !== "own" && !(start?.kind === "installed") ? (
                <span className="mkt-box__added">
                  <Icons.Check size={13} />
                  {t("box.added")}
                </span>
              ) : undefined
            }
          />
        )}
      </div>
    </Dialog>
  );
}
