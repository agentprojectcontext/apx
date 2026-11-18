import type { CatalogEntry, Result } from "@apx/protocol";
import { Icons, NavItem } from "@apx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CHANNEL_KIND_IDS, CHANNEL_KINDS } from "../channels/kinds.ts";
import { loadChannels, useChannels } from "../data/channels.ts";
import { client } from "../data/client.ts";
import { loadMarks } from "../data/models.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { useExtensionsInstalled } from "../resources/extensionInstall.ts";
import { buildItems, filterItems, type Integration, type Item, isMine, waits } from "../resources/extensionItems.ts";
import { describe } from "../resources/IncludedIntegration.tsx";
import { attempt } from "../resources/InstalledExtension.tsx";
import { useResources } from "../resources/useResources.ts";
import { go, type MarketSection, useNav } from "../shell/nav.ts";
import { AdvancedView } from "./AdvancedView.tsx";
import type { CatalogsState } from "./Catalogs.tsx";
import { ItemIcon } from "./ConnectHead.tsx";
import { ItemPage } from "./ItemPage.tsx";
import { waitReason } from "./itemText.ts";
import { MarketBrowse } from "./MarketBrowse.tsx";
import { MineView } from "./MineView.tsx";
import "../styles/screens.css";
import "../styles/marketplace.css";

// The Marketplace: on the left Explore, your extensions (what waits on you, then what works) and Advanced at the
// bottom; on the right the place chosen or an extension's page. On a phone the places are a row of tabs on top.

export type CatalogState = { entries: CatalogEntry[]; catalog?: Result<"extensions.catalog">["catalog"] } | undefined;

const PLACE_ICON = { extensions: Icons.Puzzle, mine: Icons.CircleCheck, advanced: Icons.Wrench } as const;
const PLACE_LABEL = { extensions: "mkt.explore", mine: "mkt.yours", advanced: "mkt.advanced" } as const;

export function MarketplaceScreen() {
  const t = useT();
  const section = useNav((s) => s.marketSection);
  const open = useNav((s) => s.marketItem);
  const projects = useData((s) => s.projects);
  const channels = useChannels((s) => s.channels);
  const res = useResources(
    undefined,
    projects.filter((p) => p.path && p.registered !== false).map((p) => p.id),
  );
  const [integrations, setIntegrations] = useState<Integration[]>();
  const [catalog, setCatalog] = useState<CatalogState>();
  const [catalogs, setCatalogs] = useState<CatalogsState>();
  const [query, setQuery] = useState("");
  const installedTick = useExtensionsInstalled();
  const { loadExtensions, loadServers } = res;

  const loadIntegrations = useCallback(async () => {
    const r = await attempt(() => client.call("integrations.list", {}), t);
    setIntegrations(r?.integrations ?? []);
  }, [t]);
  const loadCatalog = useCallback(async () => {
    const r = await attempt(() => client.call("extensions.catalog", {}), t);
    setCatalog(r ?? { entries: [], catalog: "unreachable" });
  }, [t]);
  const loadCatalogs = useCallback(async () => {
    const r = await attempt(() => client.call("extensions.catalogs", {}), t);
    if (r) setCatalogs(r);
  }, [t]);
  const reload = useCallback(async () => {
    await Promise.all([loadIntegrations(), loadExtensions(), loadServers(), loadChannels()]);
  }, [loadIntegrations, loadExtensions, loadServers]);
  /** After a catalog was added, read again or removed: its list and what the Marketplace offers. */
  const catalogsChanged = useCallback(async () => {
    await Promise.all([loadCatalogs(), loadCatalog()]);
  }, [loadCatalogs, loadCatalog]);
  useEffect(() => {
    loadMarks();
    void loadIntegrations();
    void loadCatalog();
    void loadCatalogs();
    void loadChannels();
  }, [loadIntegrations, loadCatalog, loadCatalogs]);
  // Changed anywhere (this panel, another window, the terminal, an agent): what it has and what the catalogs offer.
  useEffect(() => {
    if (!installedTick) return;
    void loadExtensions();
    void loadServers();
    void loadCatalogs();
    void loadCatalog();
  }, [installedTick, loadExtensions, loadServers, loadCatalogs, loadCatalog]);

  const servers = res.data.servers ?? [];
  const items = useMemo(
    () =>
      buildItems({
        integrations: (integrations ?? []).map((i) => ({ ...i, description: describe(i, t) })),
        channels: CHANNEL_KIND_IDS.filter((k) => !CHANNEL_KINDS[k].soon).map((k) => ({
          kind: k,
          name: t(CHANNEL_KINDS[k].name),
          description: t(CHANNEL_KINDS[k].text),
          connected: channels.some((c) => c.type === k),
        })),
        browser: { name: t("mkt.browserName"), description: t("mkt.browserText") },
        catalog: catalog?.entries ?? [],
        installed: res.data.extensions ?? [],
        servers: res.data.servers ?? [],
      }),
    [integrations, channels, catalog, res.data.extensions, res.data.servers, t],
  );
  // Explore offers what can be added or connected; the owner's own built ones (a folder, a server) stay in theirs.
  const offered = filterItems(
    items.filter((i) => i.label !== "own"),
    query,
    "",
  );
  // A link may name an extension by its id alone: the installed one first, else what offers it.
  const current = open ? (items.find((i) => i.key === open) ?? items.find((i) => i.id === open)) : undefined;
  const mine = items.filter(isMine);
  const waiting = mine.filter(waits);
  const working = mine.filter((i) => !waits(i));
  const names = new Map((catalogs?.catalogs ?? []).map((c) => [c.id, c.name]));
  const place = (s: MarketSection) => (
    <NavItem
      key={s}
      icon={(() => {
        const Icon = PLACE_ICON[s];
        return <Icon size={16} />;
      })()}
      label={t(PLACE_LABEL[s])}
      count={s === "mine" && waiting.length ? waiting.length : undefined}
      attention={s === "mine" && waiting.length > 0}
      active={section === s && !current}
      onClick={() => go.marketplace(s)}
    />
  );
  const own = (i: Item) => (
    <NavItem
      key={i.key}
      icon={<ItemIcon item={i} size={20} />}
      label={i.name}
      trailing={waits(i) ? <span className="mkt-dot mkt-dot--wait" title={waitReason(i, t)} /> : undefined}
      active={open === i.key}
      onClick={() => go.marketplace(section, i.key)}
    />
  );

  return (
    <div className="mkt">
      <nav className="mkt__side" aria-label={t("mkt.title")}>
        <h1 className="mkt__title">{t("mkt.title")}</h1>
        {place("extensions")}
        {place("mine")}
        {mine.length > 0 && (
          <div className="mkt__yours">
            {waiting.length > 0 && <span className="mkt__label">{t("mkt.group.attention")}</span>}
            {waiting.map(own)}
            {working.length > 0 && <span className="mkt__label">{t("mkt.group.active")}</span>}
            {working.map(own)}
          </div>
        )}
        <div className="mkt__bottom">{place("advanced")}</div>
      </nav>
      <div className="mkt__main">
        {current ? (
          <ItemPage
            item={current}
            servers={servers}
            backLabel={t(PLACE_LABEL[section])}
            onBack={() => go.marketplace(section)}
            onChanged={reload}
          />
        ) : section === "mine" ? (
          <MineView items={items} onOpen={(i) => go.marketplace(section, i.key)} />
        ) : section === "advanced" ? (
          <AdvancedView catalogs={catalogs} onCatalogs={catalogsChanged} onServers={loadServers} />
        ) : (
          <MarketBrowse
            items={offered}
            total={items.filter((i) => i.label !== "own").length}
            query={query}
            onQuery={setQuery}
            catalog={catalog}
            catalogNames={names}
            onOpen={(i) => go.marketplace(section, i.key)}
          />
        )}
      </div>
    </div>
  );
}
