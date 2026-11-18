import type { McpServerStatus } from "@apx/protocol";
import { Button, IconButton, Icons, MarkdownView, Menu, type MenuEntry } from "@apx/ui";
import { type ReactNode, useState } from "react";
import { client } from "../data/client.ts";
import { setMcp, signInMcp } from "../data/resources.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { openExtensionInstall } from "../resources/extensionInstall.ts";
import type { Item } from "../resources/extensionItems.ts";
import { ConnectForm, describe } from "../resources/IncludedIntegration.tsx";
import { attempt } from "../resources/InstalledExtension.tsx";
import { McpDialog } from "../resources/McpDialog.tsx";
import { go } from "../shell/nav.ts";
import { CompanionDialog } from "./CompanionDialog.tsx";
import { ItemIcon } from "./ConnectHead.tsx";
import { ItemFacts } from "./ItemFacts.tsx";
import { ItemLabel } from "./ItemLabel.tsx";
import { ItemParts } from "./ItemParts.tsx";
import { ItemSettings } from "./ItemSettings.tsx";
import { fromText, listingIn, nextStep, type Step, stepLabel } from "./itemText.ts";
import { KeysDialog } from "./KeysDialog.tsx";
import { rowAction } from "./MarketBrowse.tsx";
import { TurnOnDialog } from "./TurnOnDialog.tsx";
import { useAsset } from "./useAsset.ts";

// An extension's page: its icon, name, label and who makes it, with one button that follows its state (Add → Connect,
// or Pair for a device → Connected ✓) and everything else in ⋯; what to ask it, about it, what it brings (rows that
// open) and the facts at its foot.

type Dialog = "connect" | "keys" | "pair" | "turn-on" | "settings" | "edit" | undefined;

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
  servers,
  backLabel,
  onBack,
  onChanged,
}: {
  item: Item;
  servers: McpServerStatus[];
  backLabel: string;
  onBack(): void;
  onChanged(): Promise<void>;
}) {
  const t = useT();
  const lang = useLanguage();
  const copy = listingIn(item.listing, lang);
  const [open, setOpen] = useState<Dialog>();
  const [busy, setBusy] = useState(false);
  const e = item.ext;
  const i = item.integration;
  const step = nextStep(item);
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
  /** After it was turned on: its keys or its pairing, when it needs them. */
  const afterOn = async () => {
    await onChanged();
    setOpen(e?.secrets.some((s) => !s.set) ? "keys" : e?.companion ? "pair" : undefined);
  };
  const server = item.server;
  const act: Partial<Record<Step, () => void>> = {
    add: rowAction(item, () => undefined),
    connect: e ? () => setOpen("turn-on") : i ? () => setOpen("connect") : rowAction(item, () => undefined),
    review: () => setOpen("turn-on"),
    pair: () => setOpen("pair"),
    keys: () => setOpen("keys"),
    settings: () => setOpen("settings"),
    fix: () => setOpen(server && !e && !i ? "edit" : "settings"),
    "sign-in": () => {
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
    step === "done" || step === "coming" ? (
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
    menu.push({ label: t("mkt.settings"), icon: <Icons.Settings size={14} />, onSelect: () => setOpen("settings") });
    if (item.update && item.url) {
      const url = item.url;
      menu.push({
        label: t("mkt.updateTo", { version: item.update }),
        icon: <Icons.ArrowUp size={14} />,
        onSelect: () => openExtensionInstall({ url }),
      });
    }
    if (e.update)
      menu.push({
        label: e.update.from === e.version ? t("ext.rollbackSame") : t("ext.rollback", { version: e.update.from }),
        icon: <Icons.RotateCcw size={14} />,
        onSelect: () => void run(() => client.call("extensions.rollback", { id: e.id })),
      });
    if (e.enabled)
      menu.push({
        label: t("extx.turnOff"),
        icon: <Icons.Power size={14} />,
        onSelect: () => void run(() => client.call("extensions.enable", { id: e.id, enabled: false })),
      });
    menu.push(
      { type: "separator" },
      {
        label: t("mkt.remove"),
        icon: <Icons.Trash2 size={14} />,
        danger: true,
        onSelect: () => void run(() => client.call("extensions.remove", { id: e.id })).then(() => onBack()),
      },
    );
  } else if (i && item.state !== "available" && item.state !== "coming") {
    menu.push(
      { label: t("mkt.settings"), icon: <Icons.Settings size={14} />, onSelect: () => setOpen("settings") },
      {
        label: t("int.disconnect"),
        icon: <Icons.Power size={14} />,
        onSelect: () => void run(() => client.call("integrations.disconnect", { id: i.id })),
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
        onSelect: () => void run(() => setMcp(server.name, null)).then(() => onBack()),
      },
    );
  }

  const update =
    item.update && item.url ? (
      <div className="mkt-notice mkt-notice--update">
        <Icons.ArrowUp size={16} />
        <span className="mkt-notice__text">{t("mkt.notice.update", { version: item.update })}</span>
        <Button size="sm" variant="secondary" onClick={() => item.url && openExtensionInstall({ url: item.url })}>
          {t("extx.seeUpdate")}
        </Button>
      </div>
    ) : null;
  const notice =
    item.attention && item.state === "attention" ? (
      <div className="mkt-notice mkt-notice--warn">
        <Icons.TriangleAlert size={16} />
        <span className="mkt-notice__text">{t(`extx.fix.${item.attention}`)}</span>
      </div>
    ) : item.state === "off" && e ? (
      <div className="mkt-notice mkt-notice--warn">
        <Icons.Power size={16} />
        <span className="mkt-notice__text">
          {t(item.attention === "update-waits" ? "extx.fix.update-waits" : "mkt.notice.off")}
        </span>
      </div>
    ) : null;

  return (
    <div className="mkt-page">
      <Button
        size="sm"
        variant="ghost"
        className="mkt-page__back"
        leadingIcon={<Icons.ChevronLeft size={14} />}
        onClick={onBack}
      >
        {backLabel}
      </Button>
      <header className="mkt-page__head">
        <ItemIcon item={item} size={56} />
        <div className="mkt-page__titles">
          <div className="mkt-page__name">
            <h2>{item.name}</h2>
            <ItemLabel label={item.label} />
          </div>
          {by && <span className="mkt-page__by">{by}</span>}
          {tagline && <p className="mkt-page__tagline">{tagline}</p>}
        </div>
        <div className="mkt-page__act">
          {primary}
          {menu.length > 0 && (
            <Menu
              align="end"
              items={menu}
              trigger={<IconButton label={t("mkt.more")} variant="outline" icon={<Icons.Ellipsis size={16} />} />}
            />
          )}
        </div>
      </header>
      {notice}
      {update}
      {item.listing && item.listing.screenshots.length > 0 && (
        <section className="mkt-shots" aria-label={t("mkt.screenshots")}>
          {item.listing.screenshots.map((f, n) => (
            <Shot key={f} id={item.id} file={f} caption={copy?.captions[n] ?? ""} />
          ))}
        </section>
      )}
      {copy && copy.prompts.length > 0 && (
        <section className="mkt-try">
          <h4>{t("mkt.try")}</h4>
          {copy.prompts.map((p) => (
            <span key={p} className="mkt-try__row">
              <Icons.MessageCircle size={14} />
              {p}
            </span>
          ))}
        </section>
      )}
      {about && (
        <section className="mkt-page__about">
          <MarkdownView source={about} size="sm" />
        </section>
      )}
      <ItemParts item={item} servers={servers} />
      <ItemFacts item={item} />
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
      {open === "turn-on" && e && <TurnOnDialog e={e} onClose={() => setOpen(undefined)} onOn={afterOn} />}
      {open === "pair" && e?.companion && <CompanionDialog item={item} ext={e} onClose={() => setOpen(undefined)} />}
      {open === "keys" && e && (
        <KeysDialog
          item={item}
          ext={e}
          onClose={() => setOpen(undefined)}
          onDone={async () => {
            setOpen(undefined);
            await onChanged();
            if (e.companion) setOpen("pair");
          }}
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
