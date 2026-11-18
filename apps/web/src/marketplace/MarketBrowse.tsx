import { Button, EmptyState, Icons, Menu, SearchField, SegmentedControl } from "@apx/ui";
import { useState } from "react";
import { isChannelKind } from "../channels/kinds.ts";
import { type MessageKey, useLanguage, useT } from "../i18n/index.ts";
import { openExtensionInstall } from "../resources/extensionInstall.ts";
import { groupByCategory, type Item } from "../resources/extensionItems.ts";
import { go } from "../shell/nav.ts";
import { ItemRow } from "./ItemRow.tsx";
import { listingIn, newest } from "./itemText.ts";
import type { CatalogState } from "./MarketplaceScreen.tsx";

// Explore: search and filters on top, then what is new and every category in compact rows of two columns. A row opens
// the extension's page; its one button adds it (or connects one included with APX).

const FIRST = 6;

/** What a filter keeps: one that connects to something, brings skills, ready-made agents or a device's app. */
const FILTERS = {
  connections: (i: Item) => i.brings.includes("accounts") || i.brings.includes("tools"),
  skills: (i: Item) => i.brings.includes("skills"),
  agents: (i: Item) => i.brings.includes("agents"),
  devices: (i: Item) => i.brings.includes("devices"),
} as const;
export type Filter = keyof typeof FILTERS;

/** Its one line in the language on screen. */
export function useLine(): (i: Item) => string {
  const lang = useLanguage();
  return (i) => {
    const l = listingIn(i.listing, lang);
    return l?.tagline ?? i.tagline ?? l?.summary ?? i.description;
  };
}

/** Its button from a list: add it from its catalog, start a channel, or open its page to connect it. */
export function rowAction(i: Item, open: () => void): (() => void) | undefined {
  if (i.state !== "available") return undefined;
  const kind = i.channel;
  if (kind) return () => isChannelKind(kind) && go.newChannel(kind);
  const entry = i.entry?.catalog ? { catalog: i.entry.catalog, id: i.id } : undefined;
  if (entry) return () => openExtensionInstall({ entry, catalog: true });
  const url = !i.integration && i.url;
  if (url) return () => openExtensionInstall({ url, catalog: true, official: i.provenance === "official" });
  return open;
}

function Section({ title, items, onOpen }: { title: string; items: Item[]; onOpen(i: Item): void }) {
  const t = useT();
  const line = useLine();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <section className="mkt-section">
      <header className="mkt-section__head">
        <h3>{title}</h3>
        {items.length > FIRST && (
          <Button
            size="sm"
            variant="ghost"
            trailingIcon={all ? undefined : <Icons.ArrowRight size={14} />}
            onClick={() => setAll(!all)}
          >
            {t(all ? "mkt.seeLess" : "mkt.seeAll")}
          </Button>
        )}
      </header>
      <div className="mkt-rows">
        {shown.map((i) => (
          <ItemRow key={i.key} item={i} line={line(i)} onOpen={() => onOpen(i)} onAct={rowAction(i, () => onOpen(i))} />
        ))}
      </div>
    </section>
  );
}

export function MarketBrowse({
  items,
  query,
  onQuery,
  catalog,
  catalogNames,
  onOpen,
  total,
}: {
  /** Everything it can offer: included, APX's catalog and added catalogs (the owner's own built ones are not here). */
  items: Item[];
  /** How many it offers before the search narrows them. */
  total: number;
  query: string;
  onQuery(q: string): void;
  catalog: CatalogState;
  /** The added catalogs' names, by id. */
  catalogNames: Map<string, string>;
  onOpen(i: Item): void;
}) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>();
  // The chosen one stays, even when a search leaves it empty: it is how the owner takes it off.
  const filters = (Object.keys(FILTERS) as Filter[]).filter((f) => f === filter || items.some(FILTERS[f]));
  const shown = filter ? items.filter(FILTERS[filter]) : items;
  const fresh = query || filter ? [] : newest(shown, Date.now());
  const groups = groupByCategory(shown);
  const titleOf = (id: string) =>
    id.startsWith("added:")
      ? t("mkt.fromCatalog", { name: catalogNames.get(id.slice(6)) ?? id.slice(6) })
      : t(`mkt.cat.${id}` as MessageKey);
  return (
    <div className="mkt-browse">
      <div className="mkt-browse__bar">
        <SearchField
          size="sm"
          className="mkt-browse__search"
          placeholder={t("mkt.search")}
          aria-label={t("mkt.search")}
          value={query}
          onChange={({ currentTarget: { value } }) => onQuery(value)}
        />
        <Menu
          align="end"
          trigger={
            <Button size="sm" variant="secondary" leadingIcon={<Icons.Plus size={14} />}>
              {t("mkt.addMenu")}
            </Button>
          }
          items={[
            {
              label: t("mkt.addAddress"),
              description: t("mkt.addAddressHint"),
              onSelect: () => openExtensionInstall({ mode: "url" }),
            },
            {
              label: t("mkt.addFile"),
              description: t("mkt.addFileHint"),
              onSelect: () => openExtensionInstall({ mode: "file" }),
            },
          ]}
        />
      </div>
      {(filters.length > 1 || filter) && (
        <SegmentedControl
          size="sm"
          className="mkt-filters"
          label={t("mkt.filterLabel")}
          value={filter ?? "all"}
          onValueChange={(v) => setFilter(v === "all" ? undefined : (v as Filter))}
          options={["all", ...filters].map((f) => ({
            value: f,
            label: (
              <>
                {t(`mkt.filter.${f}` as MessageKey)}
                <span className="mkt-filters__n">
                  {f === "all" ? items.length : items.filter(FILTERS[f as Filter]).length}
                </span>
              </>
            ),
          }))}
        />
      )}
      {shown.length > 0 && (
        <p className="mkt-browse__count" role="status">
          {shown.length === total
            ? t(total === 1 ? "mkt.countOne" : "mkt.countAll", { n: total })
            : t("mkt.countOf", { n: shown.length, total })}
        </p>
      )}
      {(!catalog || catalog.catalog) && (
        <p className="mkt-browse__status">
          {!catalog
            ? t("extx.catalogLoading")
            : catalog.catalog === "needs_update"
              ? t("extx.catalogNeedsUpdate")
              : t("extx.catalogUnreachable")}
        </p>
      )}
      {fresh.length > 0 && <Section title={t("mkt.new")} items={fresh} onOpen={onOpen} />}
      {groups.length ? (
        groups.map((g) => <Section key={g.id} title={titleOf(g.id)} items={g.items} onOpen={onOpen} />)
      ) : (
        <EmptyState variant="dashed" icon={<Icons.Search />}>
          {t("extx.emptyHint")}
        </EmptyState>
      )}
    </div>
  );
}
