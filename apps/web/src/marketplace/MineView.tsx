import { EmptyState, Icons } from "@apx/ui";
import { useT } from "../i18n/index.ts";
import { groupMine, type Item } from "../resources/extensionItems.ts";
import { ItemRow } from "./ItemRow.tsx";
import { useLine } from "./MarketBrowse.tsx";

// Your extensions: first what waits on you (not connected yet, a new version, an error), then what is working.

export function MineView({ items, onOpen }: { items: Item[]; onOpen(i: Item): void }) {
  const t = useT();
  const line = useLine();
  const groups = groupMine(items);
  return (
    <div className="mkt-browse">
      <header className="mkt-browse__head">
        <h2>{t("mkt.yours")}</h2>
      </header>
      {groups.length ? (
        groups.map((g) => (
          <section key={g.id} className="mkt-section">
            <header className="mkt-section__head">
              <h3>{t(g.id === "attention" ? "mkt.group.attention" : "mkt.group.active")}</h3>
            </header>
            <div className="mkt-rows mkt-rows--one">
              {g.items.map((i) => (
                <ItemRow key={i.key} item={i} line={line(i)} onOpen={() => onOpen(i)} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <EmptyState variant="dashed" icon={<Icons.Puzzle />}>
          {t("mkt.yoursEmpty")}
        </EmptyState>
      )}
    </div>
  );
}
