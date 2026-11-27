import type { McpServerStatus } from "@apx/protocol";
import { Button, Card, ConfirmDialog, IconButton, Icons, MarkdownView, Menu, type MenuEntry } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { isChannelKind } from "../channels/kinds.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { setMcp, signInMcp } from "../data/resources.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { openExtensionInstall } from "../resources/extensionInstall.ts";
import type { Item } from "../resources/extensionItems.ts";
import { ConnectForm, describe } from "../resources/IncludedIntegration.tsx";
import { attempt } from "../resources/InstalledExtension.tsx";
import { McpDialog } from "../resources/McpDialog.tsx";
import { go } from "../shell/nav.ts";
import { listText } from "./about.ts";
import { addItem, addSource, type Problem } from "./adding.ts";
import { ItemIcon } from "./ConnectHead.tsx";
import { ConnectionCard } from "./ConnectionCard.tsx";
import { connectionOf } from "./connectionState.ts";
import { ItemBrings } from "./ItemBrings.tsx";
import { ItemFacts } from "./ItemFacts.tsx";
import { ItemLabel } from "./ItemLabel.tsx";
import { ItemRow } from "./ItemRow.tsx";
import { hasExtensionSettings, ItemSettings } from "./ItemSettings.tsx";
import { fromText, listingIn, nextStep, type Step, stepLabel } from "./itemText.ts";
import { useAsset } from "./useAsset.ts";

// An extension's page: its icon, name, label and who makes it, with one button that follows its state (Add → Connect,
// or Pair for a device → Connected ✓) and everything else in ⋯; what to ask it, about it, what it brings (the same
// before and after adding it) and the facts beside it. Add happens here and the page stays, now with Connect.

type Dialog = "connect" | "settings" | "edit" | undefined;

function Shot({ id, file, caption }: { id: string; file: string; caption: string }) {
  const url = useAsset(id, file);
  return (
    <figure className="mkt-shot">
      {url ? <img src={url} alt={caption} loading="lazy" /> : <span className="mkt-shot__empty" />}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

export function ItemPage({
  item,
  twin,
  versions = [],
  servers,
  backLabel,
  onBack,
  onChanged,
  onAdded,
}: {
  item: Item;
  /** The one APX includes or publishes for the same service, when this comes from a catalog the owner added. */
  twin?: Item | undefined;
  /** The same service from catalogs the owner added, when this is APX's. */
  versions?: Item[];
  servers: McpServerStatus[];
  backLabel: string;
  onBack(): void;
  onChanged(): Promise<void>;
  /** Added from here: its page by its new key, now with Connect. */
  onAdded(id: string): void;
}) {
  const t = useT();
  const lang = useLanguage();
  const copy = listingIn(item.listing, lang);
  const [open, setOpen] = useState<Dialog>();
  const [busy, setBusy] = useState(false);
  const [disconnectFailed, setDisconnectFailed] = useState(false);
  // An action that removes or disconnects asks first.
  const [asking, setAsking] = useState<{ title: string; body: string; label: string; run(): Promise<unknown> }>();
  const e = item.ext;
  const i = item.integration;
  const step = nextStep(item);
  const [problem, setProblem] = useState<Problem>();
  const tagline = copy?.tagline ?? item.tagline ?? (i ? describe(i, t) : copy?.summary || item.description);
  const about = copy?.description ?? (copy?.summary && copy.summary !== tagline ? copy.summary : undefined);
  const by = [
    item.label === "included" ? t("mkt.comesWithApx") : fromText(item, t),
    item.version ? t("mkt.versionN", { version: item.version }) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await attempt(fn, t);
    setBusy(false);
    await onChanged();
  };
  /** Copies its files here; the page stays, added, with Connect as the next step. */
  const add = async () => {
    setBusy(true);
    setProblem(undefined);
    const r = await addItem(item);
    setBusy(false);
    if ("problem" in r) return setProblem(r.problem);
    await onChanged();
    onAdded(r.ext.id);
  };
  /** Connecting or pairing one already added happens in the add box. */
  const connectBox = () =>
    e && openExtensionInstall({ connect: e.id, look: { listing: item.listing, entry: item.entry } });
  const update = (url: string) =>
    openExtensionInstall({ url, catalog: true, official: item.entry?.provenance === "official" });
  const server = item.server;
  const channel = item.channel;
  const connection = connectionOf(e, servers);
  const connectionState = connection?.state;
  useEffect(() => {
    if (connectionState !== "connecting") return;
    const timer = setInterval(() => void onChanged(), 2_000);
    return () => clearInterval(timer);
  }, [connectionState, onChanged]);
  const hasSession = connection?.saved;
  const canDisconnect = connection?.canDisconnect;
  const missingDetails = step === "keys" || step === "settings";
  const needsSetup = missingDetails || step === "review";
  const disconnectLabel = t("int.disconnect");
  const askDisconnect = () => {
    if (!e) return;
    setAsking({
      title: t("mkt.disconnectTitle", { name: item.name }),
      body: t("mkt.connection.disconnectBody", { name: item.name }),
      label: disconnectLabel,
      run: async () => {
        setDisconnectFailed(false);
        try {
          await client.call("extensions.disconnect", { id: e.id });
        } catch {
          setDisconnectFailed(true);
        }
        await onChanged();
      },
    });
  };
  const connectionHint =
    connectionState === "connected"
      ? hasSession
        ? t("mkt.connection.signedIn")
        : t("mkt.connection.ready", { name: item.name })
      : connectionState === "disconnected"
        ? t("mkt.connection.signedOut", { name: item.name })
        : connectionState === "off" && hasSession
          ? t("mkt.connection.paused")
          : undefined;
  const act: Partial<Record<Step, () => void>> = {
    add: addSource(item) ? () => void add() : undefined,
    connect: e
      ? connectBox
      : i
        ? () => setOpen("connect")
        : channel && isChannelKind(channel)
          ? () => go.newChannel(channel)
          : undefined,
    review: connectBox,
    pair: connectBox,
    keys: connectBox,
    settings: () => setOpen("settings"),
    fix: () => setOpen(server && !e && !i ? "edit" : "settings"),
    "sign-in": () => {
      if (e) return connectBox();
      if (!server || i) return setOpen("settings");
      void signInMcp(server).then((s) => {
        if (s?.sign_in_url) window.open(s.sign_in_url, "_blank", "noopener");
        void onChanged();
      });
    },
    "turn-on": () => server?.definition && void run(() => setMcp(server.name, { ...server.definition, enabled: true })),
    channel: () => go.view("channels"),
    browser: () => go.config("browser"),
  };
  const primary: ReactNode =
    step === "done" || step === "coming" || step === "starting" ? (
      <Button variant="secondary" disabled leadingIcon={step === "done" ? <Icons.Check size={14} /> : undefined}>
        {stepLabel(item, step, t)}
      </Button>
    ) : (
      <Button
        loading={busy}
        leadingIcon={
          step === "add" ? <Icons.Plus size={14} /> : step === "pair" ? <Icons.Smartphone size={14} /> : undefined
        }
        onClick={() => act[step]?.()}
      >
        {stepLabel(item, step, t)}
      </Button>
    );

  const menu: MenuEntry[] = [];
  if (e) {
    if (step !== "settings" && hasExtensionSettings(e))
      menu.push({ label: t("mkt.settings"), icon: <Icons.Settings size={14} />, onSelect: () => setOpen("settings") });
    if (item.update && item.url) {
      const url = item.url;
      menu.push({
        label: t("mkt.updateTo", { version: item.update }),
        icon: <Icons.ArrowUp size={14} />,
        onSelect: () => update(url),
      });
    }
    if (e.update)
      menu.push({
        label: e.update.from === e.version ? t("ext.rollbackSame") : t("ext.rollback", { version: e.update.from }),
        icon: <Icons.RotateCcw size={14} />,
        onSelect: () => void run(() => client.call("extensions.rollback", { id: e.id })),
      });
    if (canDisconnect && (needsSetup || (connectionState !== "connected" && connectionState !== "saved")))
      menu.push({ label: disconnectLabel, icon: <Icons.LogOut size={14} />, onSelect: askDisconnect });
    if (e.enabled)
      menu.push({
        label: t("extx.turnOff"),
        icon: <Icons.Power size={14} />,
        onSelect: () => {
          const turnOff = () => run(() => client.call("extensions.enable", { id: e.id, enabled: false }));
          if (!hasSession) return void turnOff();
          setAsking({
            title: t("mkt.connection.turnOffTitle", { name: item.name }),
            body: t("mkt.connection.turnOffBody"),
            label: t("extx.turnOff"),
            run: turnOff,
          });
        },
      });
    menu.push(
      { type: "separator" },
      {
        label: t("mkt.remove"),
        icon: <Icons.Trash2 size={14} />,
        danger: true,
        onSelect: () =>
          setAsking({
            title: t("mkt.removeTitle", { name: item.name }),
            body: e.added_agents?.length
              ? t("mkt.removeBodyAgents", {
                  names: listText(
                    e.added_agents.map((a) => a.name),
                    t,
                  ),
                })
              : t("mkt.removeBody"),
            label: t("mkt.remove"),
            run: () =>
              run(async () => {
                const r = await client.call("extensions.remove", { id: e.id });
                if (r.kept.length) notify(t("mkt.removedKept", { names: listText(r.kept, t) }));
              }).then(() => onBack()),
          }),
      },
    );
  } else if (i && item.state !== "available" && item.state !== "coming") {
    menu.push(
      { label: t("mkt.settings"), icon: <Icons.Settings size={14} />, onSelect: () => setOpen("settings") },
      {
        label: t("int.disconnect"),
        icon: <Icons.Power size={14} />,
        onSelect: () =>
          setAsking({
            title: t("mkt.disconnectTitle", { name: item.name }),
            body: t("mkt.disconnectBody"),
            label: t("int.disconnect"),
            run: () => run(() => client.call("integrations.disconnect", { id: i.id })),
          }),
      },
    );
  } else if (item.channel && item.state !== "available") {
    menu.push({
      label: t("mkt.openChannels"),
      icon: <Icons.Settings size={14} />,
      onSelect: () => go.view("channels"),
    });
  } else if (server && !i && server.definition) {
    const def = server.definition;
    menu.push({ label: t("mkt.edit"), icon: <Icons.Pencil size={14} />, onSelect: () => setOpen("edit") });
    if (server.enabled)
      menu.push({
        label: t("extx.turnOff"),
        icon: <Icons.Power size={14} />,
        onSelect: () => void run(() => setMcp(server.name, { ...def, enabled: false })),
      });
    menu.push(
      { type: "separator" },
      {
        label: t("mkt.remove"),
        icon: <Icons.Trash2 size={14} />,
        danger: true,
        onSelect: () =>
          setAsking({
            title: t("mkt.removeTitle", { name: item.name }),
            body: t("mkt.removeBody"),
            label: t("mkt.remove"),
            run: () => run(() => setMcp(server.name, null)).then(() => onBack()),
          }),
      },
    );
  }

  const menuButton = menu.length > 0 && (
    <Menu
      align="end"
      items={menu}
      trigger={<IconButton label={t("mkt.more")} variant="outline" icon={<Icons.Ellipsis size={16} />} />}
    />
  );
  const connectionAction = needsSetup ? (
    primary
  ) : connectionState === "off" && e ? (
    <Button
      loading={busy}
      onClick={
        hasSession ? () => void run(() => client.call("extensions.enable", { id: e.id, enabled: true })) : connectBox
      }
    >
      {t(hasSession ? "mkt.connection.turnOn" : "mkt.step.connect")}
    </Button>
  ) : connectionState === "connected" || connectionState === "saved" ? (
    canDisconnect && (
      <Button variant="secondary" onClick={askDisconnect}>
        {disconnectLabel}
      </Button>
    )
  ) : connectionState === "error" || connectionState === "reconnect" || connectionState === "disconnected" ? (
    <Button loading={busy} onClick={connectBox}>
      {t(
        connectionState === "error"
          ? "box.retry"
          : connectionState === "reconnect"
            ? "mkt.connection.reconnectAction"
            : "mkt.step.connect",
      )}
    </Button>
  ) : connectionState === "connecting" ? (
    connection?.signIn?.sign_in_url && (
      <Button onClick={() => window.open(connection.signIn?.sign_in_url, "_blank", "noopener,noreferrer")}>
        {t("mkt.connection.continueSignIn")}
      </Button>
    )
  ) : (
    primary
  );

  // What waits on the owner, in one quiet panel: why it is not working yet, and a newer version.
  const waiting =
    item.attention &&
    item.state === "attention" &&
    (!connectionState || (!missingDetails && item.attention !== "sign-in")) &&
    connectionState !== "error"
      ? t(`extx.fix.${item.attention}`)
      : item.state === "off" && e && (!connectionState || item.attention === "update-waits")
        ? t(item.attention === "update-waits" ? "extx.fix.update-waits" : "mkt.notice.off")
        : undefined;
  const newer = item.update && item.url ? t("mkt.notice.update", { version: item.update }) : undefined;
  const notice =
    waiting || newer ? (
      // Its button right after what it says, not at the far end of the row.
      <div className="mkt-notice" role="status">
        <span>{[waiting, newer].filter(Boolean).join(" ")}</span>
        {newer && (
          <Button size="sm" variant="secondary" onClick={() => item.url && update(item.url)}>
            {t("extx.seeUpdate")}
          </Button>
        )}
      </div>
    ) : null;

  return (
    <div className="mkt-item">
      <Button
        size="sm"
        variant="ghost"
        className="mkt-page__back"
        leadingIcon={<Icons.ChevronLeft size={14} />}
        onClick={onBack}
      >
        {backLabel}
      </Button>
      <header className={connectionState ? "mkt-page__head mkt-page__head--connection" : "mkt-page__head"}>
        <ItemIcon item={item} size={56} />
        <div className="mkt-page__titles">
          <div className="mkt-page__name">
            <h2>{item.name}</h2>
            <ItemLabel label={item.label} compact={false} />
          </div>
          {by && <span className="mkt-page__by">{by}</span>}
          {tagline && <p className="mkt-page__tagline">{tagline}</p>}
        </div>
        {!connectionState && (
          <div className="mkt-page__act">
            {primary}
            {menuButton}
          </div>
        )}
      </header>
      {connectionState && (
        <ConnectionCard
          state={missingDetails ? "setup" : connectionState}
          hint={missingDetails ? (hasSession ? t("mkt.connection.paused") : undefined) : connectionHint}
          error={disconnectFailed ? t("mkt.connection.disconnectError") : undefined}
          onRetry={askDisconnect}
        >
          {connectionAction}
          {menuButton}
        </ConnectionCard>
      )}
      {notice}
      {problem && (
        <div className="mkt-notice is-problem" role="alert">
          <Icons.TriangleAlert size={15} />
          <span>{t(problem.key, { ...problem.vars, name: problem.vars?.name || item.name })}</span>
          {problem.retry && (
            <Button size="sm" variant="secondary" onClick={() => void add()}>
              {t("box.retry")}
            </Button>
          )}
        </div>
      )}
      {twin && (
        <div className="mkt-notice" role="status">
          <span>
            {t(twin.label === "included" ? "mkt.twin" : "mkt.twinOfficial", {
              name: twin.name,
              catalog: item.entry?.catalog_name ?? "",
            })}
          </span>
          <Button size="sm" variant="secondary" onClick={() => go.marketplace("extensions", twin.key)}>
            {t(twin.label === "included" ? "mkt.twinSee" : "mkt.twinSeeOfficial")}
          </Button>
        </div>
      )}
      <div className="mkt-page__cols">
        <div className="mkt-page__main">
          {item.listing && item.listing.screenshots.length > 0 && (
            <section className="mkt-shots" aria-label={t("mkt.screenshots")}>
              {item.listing.screenshots.map((f, n) => (
                <Shot key={f} id={item.id} file={f} caption={copy?.captions[n] ?? ""} />
              ))}
            </section>
          )}
          {about && (
            <section className="mkt-page__about">
              <MarkdownView source={about} size="sm" />
            </section>
          )}
          {copy && copy.prompts.length > 0 && (
            <Card variant="soft" padding="sm" className="mkt-try">
              <h4>{t("mkt.try")}</h4>
              {copy.prompts.map((p) => (
                <span key={p} className="mkt-try__row">
                  <Icons.MessageCircle size={14} />
                  {p}
                </span>
              ))}
            </Card>
          )}
          <ItemBrings item={item} servers={servers} connectionShown={Boolean(connectionState)} onChanged={onChanged} />
          {versions.length > 0 && (
            <section className="mkt-section">
              <header className="mkt-section__head">
                <h3>{t(versions.length === 1 ? "mkt.otherVersion" : "mkt.otherVersions")}</h3>
              </header>
              <div className="mkt-rows mkt-rows--one">
                {versions.map((v) => {
                  const see = () => go.marketplace("extensions", v.key);
                  return (
                    <ItemRow
                      key={v.key}
                      item={v}
                      line={t("mkt.otherVersionLine", { catalog: v.entry?.catalog_name ?? "" })}
                      onOpen={see}
                    />
                  );
                })}
              </div>
            </section>
          )}
        </div>
        <ItemFacts item={item} />
      </div>
      {open === "connect" && i && (
        <ConnectForm
          i={i}
          title={t("int.connectTitle", { name: i.label })}
          onClose={() => setOpen(undefined)}
          onDone={async () => {
            setOpen(undefined);
            await onChanged();
          }}
        />
      )}
      {asking && (
        <ConfirmDialog
          title={asking.title}
          description={asking.body}
          confirmLabel={asking.label}
          cancelLabel={t("common.cancel")}
          closeLabel={t("common.close")}
          onConfirm={asking.run}
          onClose={() => setAsking(undefined)}
        />
      )}
      {open === "settings" && <ItemSettings item={item} onClose={() => setOpen(undefined)} onChanged={onChanged} />}
      {open === "edit" && server && (
        <McpDialog
          server={server}
          onClose={() => setOpen(undefined)}
          onSaved={() => {
            setOpen(undefined);
            void onChanged();
          }}
        />
      )}
    </div>
  );
}
