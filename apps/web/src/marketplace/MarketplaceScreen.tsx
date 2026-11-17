import type { CatalogEntry, Result } from "@apx/protocol";
import { Icons, NavItem } from "@apx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CHANNEL_KIND_IDS, CHANNEL_KINDS } from "../channels/kinds.ts";
import { loadChannels, useChannels } from "../data/channels.ts";
import { client } from "../data/client.ts";
import { loadMarks } from "../data/models.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { useExtensionsInstalled } from "../resources/extensionInstall.ts";
import { buildItems, filterItems, type Integration, type Item, isMine } from "../resources/extensionItems.ts";
import { describe } from "../resources/IncludedIntegration.tsx";
import { attempt } from "../resources/InstalledExtension.tsx";
import { useResources } from "../resources/useResources.ts";
import { go, MARKET_SECTIONS, type MarketSection, useNav } from "../shell/nav.ts";
import type { CatalogsState } from "./Catalogs.tsx";
import { ItemIcon } from "./ConnectHead.tsx";
import { ItemPage } from "./ItemPage.tsx";
import { MarketBrowse } from "./MarketBrowse.tsx";
import "../styles/screens.css";
import "../styles/marketplace.css";

// The Marketplace, a place of its own: Extensions, Agents and Skills on the left with the owner's own extensions
// under them (each with its state), the section or an item's page on the right.

export type CatalogState = { entries: CatalogEntry[]; catalog?: Result<"extensions.catalog">["catalog"] } | undefined;

const SECTION_ICON = { extensions: Icons.Store, agents: Icons.Bot, skills: Icons.Sparkles } as const;

/** Which items a section shows. */
const inSection = (section: MarketSection, i: Item) =>
  section === "extensions" ? true : section === "agents" ? i.brings.includes("agents") : i.brings.includes("skills");

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
  useEffect(() => {
    if (installedTick) void loadExtensions();
  }, [installedTick, loadExtensions]);

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
  const found = filterItems(items, query, "");
  const current = open ? items.find((i) => i.key === open) : undefined;
  const mine = items.filter(isMine);

  return (
    <div className="mkt">
      <nav className="mkt__side" aria-label={t("mkt.title")}>
        <h1 className="mkt__title">{t("mkt.title")}</h1>
        {MARKET_SECTIONS.map((s) => {
          const Icon = SECTION_ICON[s];
          return (
            <NavItem
              key={s}
              icon={<Icon size={16} />}
              label={t(`mkt.section.${s}` as MessageKey)}
              count={query ? found.filter((i) => inSection(s, i)).length : undefined}
              active={section === s && !open}
              onClick={() => go.marketplace(s)}
            />
          );
        })}
        <div className="mkt__yours">
          <span className="mkt__label">{t("mkt.yours")}</span>
          {mine.length ? (
            mine.map((i) => (
              <NavItem
                key={i.key}
                icon={<ItemIcon item={i} size={20} />}
                label={i.name}
                attention={i.state === "attention" || i.state === "off" || Boolean(i.update)}
                active={open === i.key}
                onClick={() => go.marketplace(section, i.key)}
              />
            ))
          ) : (
            <p className="mkt__note">{t("mkt.yoursEmpty")}</p>
          )}
        </div>
      </nav>
      <div className="mkt__main">
        {current ? (
          <ItemPage item={current} onBack={() => go.marketplace(section)} onChanged={reload} />
        ) : (
          <MarketBrowse
            section={section}
            items={found.filter((i) => inSection(section, i))}
            query={query}
            onQuery={setQuery}
            catalog={catalog}
            catalogs={catalogs}
            onCatalogs={catalogsChanged}
            onOpen={(i) => go.marketplace(section, i.key)}
          />
        )}
      </div>
    </div>
  );
}
