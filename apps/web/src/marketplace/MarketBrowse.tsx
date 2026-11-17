import { Badge, Button, EmptyState, Icons, Menu, SearchField } from "@apx/ui";
import { useState } from "react";
import { isChannelKind } from "../channels/kinds.ts";
import { type MessageKey, useLanguage, useT } from "../i18n/index.ts";
import { ExtensionGuide } from "../resources/ExtensionGuide.tsx";
import { ProvenanceBadge } from "../resources/ExtensionSummary.tsx";
import { openExtensionInstall } from "../resources/extensionInstall.ts";
import { groupByCategory, type Item } from "../resources/extensionItems.ts";
import { go, type MarketSection } from "../shell/nav.ts";
import { ItemIcon } from "./ConnectHead.tsx";
import type { CatalogState } from "./MarketplaceScreen.tsx";

// A Marketplace section: its title and line, search, and its items by category (each with its count, the first few
// shown and "See all"). A card opens the item's page; its one button does the next step.

const FIRST = 6;

/** Its one action: install, connect, turn on, review or update; nothing once it is working. */
function action(i: Item): { label: MessageKey; run?: () => void } | undefined {
  if (i.update && i.url) {
    const url = i.url;
    return { label: "extx.act.update", run: () => openExtensionInstall({ url }) };
  }
  if (i.state === "available" && i.ext === undefined && !i.integration && !i.channel && i.url) {
    const url = i.url;
    return { label: "extx.act.install", run: () => openExtensionInstall({ url }) };
  }
  if (i.state === "available" && i.channel) {
    const kind = i.channel;
    return { label: "extx.act.connect", run: () => isChannelKind(kind) && go.newChannel(kind) };
  }
  if (i.state === "available") return { label: "extx.act.connect" };
  if (i.state === "off") return { label: "extx.act.turnOn" };
  if (i.state === "attention") return { label: "extx.act.review" };
  return undefined;
}

function Card({ item: i, onOpen }: { item: Item; onOpen(): void }) {
  const t = useT();
  const lang = useLanguage();
  const act = action(i);
  const line =
    (lang === "es" ? (i.listing?.es?.tagline ?? i.listing?.es?.summary) : undefined) ??
    i.tagline ??
    i.listing?.summary ??
    i.description;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a card holds its own button, which a <button> cannot contain
    <div
      className="mkt-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onOpen();
      }}
    >
      <ItemIcon item={i} size={36} />
      <span className="mkt-card__main">
        <span className="mkt-card__title">
          <b>{i.name}</b>
          {i.provenance === "included" ? (
            <Badge tone="neutral">{t("extx.badge.included")}</Badge>
          ) : (
            <ProvenanceBadge e={{ provenance: i.provenance }} />
          )}
          {i.update && <Badge tone="violet">{t("extx.updateBadge", { version: i.update })}</Badge>}
        </span>
        <span className="mkt-card__line">{line}</span>
        {i.needs.length > 0 && (
          <span className="mkt-card__tags">
            {i.needs.map((n) => (
              <span key={n}>{t(`extx.needs.${n}`)}</span>
            ))}
          </span>
        )}
      </span>
      <span className="mkt-card__act">
        {act ? (
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={
              i.state === "attention" ? (
                <Icons.TriangleAlert size={14} />
              ) : act.run ? undefined : (
                <Icons.Plus size={14} />
              )
            }
            onClick={(e) => {
              e.stopPropagation();
              if (act.run) act.run();
              else onOpen();
            }}
          >
            {t(act.label)}
          </Button>
        ) : (
          <span className="mkt-card__done">
            <Icons.Check size={14} />
            {t(i.origin === "own" || i.ext ? "mkt.added" : "mkt.connected")}
          </span>
        )}
      </span>
    </div>
  );
}

function GroupView({ id, items, onOpen }: { id: string; items: Item[]; onOpen(i: Item): void }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <section className="mkt-group">
      <header className="mkt-group__head">
        <h3>
          {t(`mkt.cat.${id}` as MessageKey)} <span className="mkt__count">{items.length}</span>
        </h3>
        {items.length > FIRST && (
          <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
            {t(all ? "mkt.seeLess" : "mkt.seeAll")}
          </Button>
        )}
      </header>
      <div className="mkt-grid">
        {shown.map((i) => (
          <Card key={i.key} item={i} onOpen={() => onOpen(i)} />
        ))}
      </div>
    </section>
  );
}

export function MarketBrowse({
  section,
  items,
  query,
  onQuery,
  catalog,
  onOpen,
}: {
  section: MarketSection;
  items: Item[];
  query: string;
  onQuery(q: string): void;
  catalog: CatalogState;
  onOpen(i: Item): void;
}) {
  const t = useT();
  const groups = groupByCategory(items);
  return (
    <div className="mkt-browse">
      <header className="mkt-browse__head">
        <h2>{t(`mkt.section.${section}` as MessageKey)}</h2>
        <p>{t(`mkt.lead.${section}` as MessageKey)}</p>
      </header>
      <div className="mkt-browse__bar">
        <SearchField
          size="sm"
          className="mkt-browse__search"
          placeholder={t("mkt.search")}
          aria-label={t("mkt.search")}
          value={query}
          onChange={({ currentTarget: { value } }) => onQuery(value)}
        />
        {section === "extensions" && (
          <Menu
            align="end"
            trigger={
              <Button size="sm" variant="secondary" leadingIcon={<Icons.Upload size={14} />}>
                {t("extx.add")}
              </Button>
            }
            items={(
              [
                ["file", "extx.add.file", "extx.add.fileHint"],
                ["url", "extx.add.url", "extx.add.urlHint"],
                ["folder", "extx.add.folder", "extx.add.folderHint"],
              ] as const
            ).map(([mode, label, hint]) => ({
              label: (
                <span className="extx__menuitem">
                  <span>{t(label)}</span>
                  <small>{t(hint)}</small>
                </span>
              ),
              onSelect: () => openExtensionInstall({ mode }),
            }))}
          />
        )}
      </div>
      {section === "extensions" && (!catalog || catalog.catalog) && (
        <p className="mkt-browse__status">
          {!catalog
            ? t("extx.catalogLoading")
            : catalog.catalog === "needs_update"
              ? t("extx.catalogNeedsUpdate")
              : t("extx.catalogUnreachable")}
        </p>
      )}
      {groups.length ? (
        groups.map((g) => <GroupView key={g.id} id={g.id} items={g.items} onOpen={onOpen} />)
      ) : (
        <EmptyState variant="dashed" icon={section === "agents" ? <Icons.Bot /> : <Icons.Search />}>
          {query ? t("extx.emptyHint") : section === "agents" ? t("mkt.agentsEmpty") : t("mkt.skillsEmpty")}
        </EmptyState>
      )}
      {section === "extensions" && (
        <>
          <p className="extx__drop">
            <Icons.Upload size={16} />
            {t("extx.dropHint")}
          </p>
          <ExtensionGuide />
        </>
      )}
    </div>
  );
}
